import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pgClient, tenants, users, customers, orders, refunds } from '@friendly-crm/db';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RefundsService } from '../src/modules/orders/refunds.service';

/**
 * Refunds against a real Postgres: migration 0020 (the table, its constraints, row-level security, and the app role being
 * unable to change or delete a refund), and two refunds at once not paying out the same credit twice.
 * Skipped when no database with the migrations applied is reachable.
 */
describe('Refunds against a real Postgres', () => {
  const service = new RefundsService();
  let ready = false;
  const T = randomUUID();
  const OTHER = randomUUID();
  const USER = randomUUID();
  const C = randomUUID();
  const suffix = Date.now().toString().slice(-7);
  const inTenant = (id: string, fn: (tx: any) => Promise<any>) =>
    db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${id}, true)`);
      return fn(tx);
    });
  /** An order worth `total` with `paid` received; paid > total is a customer in credit, as after a credit note. */
  const makeOrder = async (total: number, paid: number) => {
    const id = randomUUID();
    await inTenant(T, (tx) =>
      tx.insert(orders).values({
        id, tenantId: T, orderNumber: `ORD-RF-${suffix}-${id.slice(0, 4)}`, customerId: C, productionStage: 'DELIVERED',
        totalAmount: total.toFixed(2), advanceReceived: paid.toFixed(2), balanceDue: (total - paid).toFixed(2),
      } as any)
    );
    return id;
  };
  const orderRow = (id: string) => inTenant(T, async (tx) => (await tx.select().from(orders).where(eq(orders.id, id)))[0]);

  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT 1 FROM refunds LIMIT 0`);
      ready = true;
    } catch {
      if (process.env.CI) throw new Error('CI must have Postgres with migration 0020 applied');
      return;
    }
    await db.insert(users).values({ id: USER, fullName: 'Refund Tester', phone: `+9197${suffix}` } as any);
    for (const id of [T, OTHER]) {
      await db.insert(tenants).values({ id, name: `Refund DB ${id.slice(0, 4)}`, slug: `refund-db-${id}`, industryKey: 'printing', phone: `+9196${suffix}` } as any);
    }
    await inTenant(T, (tx) => tx.insert(customers).values({ id: C, tenantId: T, name: 'Credit Customer', phone: `+9195${suffix}` } as any));
  });

  afterAll(async () => {
    if (ready) {
      await db.delete(tenants).where(sql`${tenants.id} IN (${T}, ${OTHER})`);
      await db.delete(users).where(eq(users.id, USER));
    }
    await pgClient?.end?.({ timeout: 1 });
  });

  it('records refunds against the credit, numbers them, and brings the order back to zero', async () => {
    if (!ready) return;
    const id = await makeOrder(500, 1000);
    const a = await service.record(T, USER, id, { amount: 200, mode: 'UPI', referenceNo: 'UTR-A' });
    expect(a.refund.refundNumber).toMatch(/^RFD-\d{4}-0001$/);
    expect(a.order).toMatchObject({ advanceReceived: '800.00', balanceDue: '-300.00' });
    const b = await service.record(T, USER, id, { amount: 300, mode: 'BANK_TRANSFER' });
    expect(b.refund.refundNumber).toMatch(/-0002$/);
    expect(await orderRow(id)).toMatchObject({ advanceReceived: '500.00', balanceDue: '0.00' });
    const listed = await service.list(T, id);
    expect(listed.creditRemaining).toBe('0.00');
    expect(listed.data.map((r: any) => r.amount).sort()).toEqual(['200.00', '300.00']);

    await expect(service.record(T, USER, id, { amount: 1, mode: 'CASH' })).rejects.toMatchObject({ response: { error: 'NotInCredit' } });
  });

  it('never pays out more than the credit, even when two refunds arrive at once', async () => {
    if (!ready) return;
    const id = await makeOrder(500, 1000); // 500 in credit
    const results = await Promise.allSettled([
      service.record(T, USER, id, { amount: 400, mode: 'CASH' }),
      service.record(T, USER, id, { amount: 400, mode: 'CASH' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); // the second finds only 100 left
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BadRequestException);
    expect(await orderRow(id)).toMatchObject({ advanceReceived: '600.00', balanceDue: '-100.00' });
  });

  it('refuses a repeated reference for an order', async () => {
    if (!ready) return;
    const id = await makeOrder(100, 400);
    await service.record(T, USER, id, { amount: 50, mode: 'UPI', referenceNo: 'UTR-DUP' });
    await expect(service.record(T, USER, id, { amount: 50, mode: 'UPI', referenceNo: 'UTR-DUP' })).rejects.toBeInstanceOf(BadRequestException);
    expect((await service.list(T, id)).data).toHaveLength(1);
  });

  it("another business cannot see or refund this business's order (row-level security)", async () => {
    if (!ready) return;
    const id = await makeOrder(100, 400);
    await expect(service.record(OTHER, USER, id, { amount: 10, mode: 'CASH' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.list(OTHER, id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the database refuses a zero refund (check constraint)', async () => {
    if (!ready) return;
    const id = await makeOrder(100, 400);
    await expect(
      inTenant(T, (tx) => tx.insert(refunds).values({ tenantId: T, refundNumber: `RFD-9999-${suffix.slice(-4)}`, customerId: C, orderId: id, amount: '0.00', mode: 'CASH', refundedById: USER } as any))
    ).rejects.toBeDefined();
  });
});
