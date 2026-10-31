import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pgClient, tenants, users, customers } from '@friendly-crm/db';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RefundsService } from '../src/modules/orders/refunds.service';

/** Refunding a customer's advance (no order) against a real Postgres: migration 0021 made refunds.order_id optional. */
describe('Refunds of a customer advance against a real Postgres', () => {
  const service = new RefundsService();
  let ready = false;
  const T = randomUUID();
  const OTHER = randomUUID();
  const USER = randomUUID();
  const suffix = Date.now().toString().slice(-7);
  const inTenant = (id: string, fn: (tx: any) => Promise<any>) =>
    db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${id}, true)`);
      return fn(tx);
    });
  const makeCustomer = async (opening: string, n: number) => {
    const id = randomUUID();
    await inTenant(T, (tx) => tx.insert(customers).values({ id, tenantId: T, name: `Advance Refund ${n}`, phone: `+9194${suffix}${n}`.slice(0, 13), openingBalance: opening } as any));
    return id;
  };
  const opening = (id: string) => inTenant(T, async (tx) => (await tx.select({ o: customers.openingBalance }).from(customers).where(eq(customers.id, id)))[0].o);

  beforeAll(async () => {
    try {
      const cols = await db.execute(sql`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'refunds' AND column_name = 'order_id'`);
      ready = (cols as any)[0]?.is_nullable === 'YES';
    } catch {
      ready = false;
    }
    // CI has a migrated Postgres: a silent skip there would hide a missing migration
    if (!ready && process.env.CI) throw new Error('CI must have Postgres with migration 0021 applied');
    if (!ready) return;
    await db.insert(users).values({ id: USER, fullName: 'Advance Refund Tester', phone: `+9193${suffix}` } as any);
    for (const id of [T, OTHER]) {
      await db.insert(tenants).values({ id, name: `Adv Refund DB ${id.slice(0, 4)}`, slug: `adv-refund-db-${id}`, industryKey: 'printing', phone: `+9192${suffix}` } as any);
    }
  });

  afterAll(async () => {
    if (ready) {
      await db.delete(tenants).where(sql`${tenants.id} IN (${T}, ${OTHER})`);
      await db.delete(users).where(eq(users.id, USER));
    }
    await pgClient?.end?.({ timeout: 1 });
  });

  it('stores a refund with no order, brings the advance down, and lists it', async () => {
    if (!ready) return;
    const c = await makeCustomer('-5000.00', 1);
    const out = await service.recordAdvance(T, USER, c, { amount: 2000, mode: 'BANK_TRANSFER', referenceNo: 'UTR-ADV-1' });
    expect(out.refund).toMatchObject({ orderId: null, amount: '2000.00' });
    expect(out.advanceRemaining).toBe('3000.00');
    expect(await opening(c)).toBe('-3000.00');
    const listed = await service.listAdvance(T, c);
    expect(listed.data).toHaveLength(1);
    expect(listed.creditRemaining).toBe('3000.00');
  });

  it('refuses the same reference twice for one advance (unique index), and more than the advance', async () => {
    if (!ready) return;
    const c = await makeCustomer('-1000.00', 2);
    await service.recordAdvance(T, USER, c, { amount: 100, mode: 'UPI', referenceNo: 'UTR-DUP' });
    await expect(service.recordAdvance(T, USER, c, { amount: 100, mode: 'UPI', referenceNo: 'UTR-DUP' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.recordAdvance(T, USER, c, { amount: 5000, mode: 'UPI' })).rejects.toMatchObject({ response: { error: 'RefundTooLarge' } });
    expect(await opening(c)).toBe('-900.00');
  });

  it('never pays out more than the advance when two refunds arrive at once', async () => {
    if (!ready) return;
    const c = await makeCustomer('-500.00', 3);
    const results = await Promise.allSettled([
      service.recordAdvance(T, USER, c, { amount: 400, mode: 'CASH' }),
      service.recordAdvance(T, USER, c, { amount: 400, mode: 'CASH' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); // the second finds only 100 left
    expect(await opening(c)).toBe('-100.00');
  });

  it('another business cannot refund this business customer advance (row-level security)', async () => {
    if (!ready) return;
    const c = await makeCustomer('-500.00', 4);
    await expect(service.recordAdvance(OTHER, USER, c, { amount: 10, mode: 'CASH' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listAdvance(OTHER, c)).rejects.toBeInstanceOf(NotFoundException);
  });
});
