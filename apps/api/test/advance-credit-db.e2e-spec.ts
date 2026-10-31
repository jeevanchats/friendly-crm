import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pgClient, tenants, users, customers, orders, payments } from '@friendly-crm/db';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdvanceCreditService } from '../src/modules/orders/advance-credit.service';

/**
 * Using a customer's advance against an order, on a real Postgres: a negative opening balance is stored, both rows are
 * locked so the same advance cannot be spent twice, and another business cannot touch it (row-level security).
 * Skipped when no database with the migrations applied is reachable.
 */
describe('Customer advance against a real Postgres', () => {
  const service = new AdvanceCreditService();
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
    await inTenant(T, (tx) => tx.insert(customers).values({ id, tenantId: T, name: `Advance Customer ${n}`, phone: `+9195${suffix}${n}`.slice(0, 13), openingBalance: opening } as any));
    return id;
  };
  const makeOrder = async (customerId: string, total: number) => {
    const id = randomUUID();
    await inTenant(T, (tx) =>
      tx.insert(orders).values({ id, tenantId: T, orderNumber: `ORD-AD-${suffix}-${id.slice(0, 4)}`, customerId, productionStage: 'NEW', totalAmount: total.toFixed(2), advanceReceived: '0.00', balanceDue: total.toFixed(2) } as any)
    );
    return id;
  };
  const opening = (id: string) => inTenant(T, async (tx) => (await tx.select({ o: customers.openingBalance }).from(customers).where(eq(customers.id, id)))[0].o);
  const orderRow = (id: string) => inTenant(T, async (tx) => (await tx.select().from(orders).where(eq(orders.id, id)))[0]);

  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT 1 FROM refunds LIMIT 0`);
      ready = true;
    } catch {
      if (process.env.CI) throw new Error('CI must have Postgres with the migrations applied');
      return;
    }
    await db.insert(users).values({ id: USER, fullName: 'Advance Tester', phone: `+9197${suffix}` } as any);
    for (const id of [T, OTHER]) {
      await db.insert(tenants).values({ id, name: `Advance DB ${id.slice(0, 4)}`, slug: `advance-db-${id}`, industryKey: 'printing', phone: `+9196${suffix}` } as any);
    }
  });

  afterAll(async () => {
    if (ready) {
      await db.delete(tenants).where(sql`${tenants.id} IN (${T}, ${OTHER})`);
      await db.delete(users).where(eq(users.id, USER));
    }
    await pgClient?.end?.({ timeout: 1 });
  });

  it('uses the advance against an order, writes a receipt, and brings both down together', async () => {
    if (!ready) return;
    const c = await makeCustomer('-5000.00', 1);
    expect(await opening(c)).toBe('-5000.00'); // the database holds a negative opening balance
    const o = await makeOrder(c, 3000);
    expect(await service.check(T, o)).toEqual({ credit: '5000.00', balanceDue: '3000.00', available: '3000.00' });

    const out = await service.apply(T, USER, o);
    expect(out.payment).toMatchObject({ amount: '3000.00', mode: 'ADVANCE' });
    expect(out.payment.receiptNumber).toMatch(/^RCP-\d{4}-\d{4}$/);
    expect(await orderRow(o)).toMatchObject({ advanceReceived: '3000.00', balanceDue: '0.00' });
    expect(await opening(c)).toBe('-2000.00');
    const receipts = await inTenant(T, (tx) => tx.select().from(payments).where(eq(payments.orderId, o)));
    expect(receipts).toHaveLength(1);
  });

  it('never spends the same advance twice, even when two requests arrive at once', async () => {
    if (!ready) return;
    const c = await makeCustomer('-500.00', 2);
    const a = await makeOrder(c, 1000);
    const b = await makeOrder(c, 1000);
    const results = await Promise.allSettled([service.apply(T, USER, a, 400), service.apply(T, USER, b, 400)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); // the second finds only 100 left
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    expect(await opening(c)).toBe('-100.00');
  });

  it('does nothing for a customer who owes us, and cannot reach another business', async () => {
    if (!ready) return;
    const owes = await makeCustomer('800.00', 3);
    const o = await makeOrder(owes, 1000);
    await expect(service.apply(T, USER, o)).rejects.toMatchObject({ response: { error: 'NoAdvanceToApply' } });
    expect(await opening(owes)).toBe('800.00');
    await expect(service.apply(OTHER, USER, o)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.check(OTHER, o)).rejects.toBeInstanceOf(NotFoundException);
  });
});
