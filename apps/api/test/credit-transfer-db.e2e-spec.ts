import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pgClient, tenants, users, customers, orders, creditTransfers, payments } from '@friendly-crm/db';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CreditTransferService } from '../src/modules/orders/credit-transfer.service';

/**
 * Moving order credit against a real Postgres: migration 0022 (the table and its constraints, row-level security), and two
 * transfers at once neither spending the same credit twice nor deadlocking.
 * Skipped when no database with the migration applied is reachable.
 */
describe('Order credit transfers against a real Postgres', () => {
  const service = new CreditTransferService();
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
  const makeOrder = async (total: number, paid: number) => {
    const id = randomUUID();
    await inTenant(T, (tx) =>
      tx.insert(orders).values({
        id, tenantId: T, orderNumber: `ORD-CT-${suffix}-${id.slice(0, 4)}`, customerId: C, productionStage: 'PRINTING',
        totalAmount: total.toFixed(2), advanceReceived: paid.toFixed(2), balanceDue: (total - paid).toFixed(2),
      } as any)
    );
    return id;
  };
  const orderRow = (id: string) => inTenant(T, async (tx) => (await tx.select().from(orders).where(eq(orders.id, id)))[0]);

  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT 1 FROM credit_transfers LIMIT 0`);
      ready = true;
    } catch {
      if (process.env.CI) throw new Error('CI must have Postgres with migration 0022 applied');
      return;
    }
    await db.insert(users).values({ id: USER, fullName: 'Transfer Tester', phone: `+9194${suffix}` } as any);
    for (const id of [T, OTHER]) {
      await db.insert(tenants).values({ id, name: `Transfer DB ${id.slice(0, 4)}`, slug: `transfer-db-${id}`, industryKey: 'printing', phone: `+9193${suffix}` } as any);
    }
    await inTenant(T, (tx) => tx.insert(customers).values({ id: C, tenantId: T, name: 'Transfer Customer', phone: `+9192${suffix}` } as any));
  });

  afterAll(async () => {
    if (ready) {
      await db.delete(tenants).where(sql`${tenants.id} IN (${T}, ${OTHER})`);
      await db.delete(users).where(eq(users.id, USER));
    }
    await pgClient?.end?.({ timeout: 1 });
  });

  it('moves credit between two orders, writes the receipt and the record, and lists it from both orders', async () => {
    if (!ready) return;
    const credit = await makeOrder(500, 1000);
    const owes = await makeOrder(900, 200);
    const out = await service.transfer(T, USER, credit, { toOrderId: owes });
    expect(out.transfer).toMatchObject({ amount: '500.00', fromOrderId: credit, toOrderId: owes });
    expect(await orderRow(credit)).toMatchObject({ advanceReceived: '500.00', balanceDue: '0.00' });
    expect(await orderRow(owes)).toMatchObject({ advanceReceived: '700.00', balanceDue: '200.00' });
    const receipts = await inTenant(T, (tx) => tx.select().from(payments).where(eq(payments.orderId, owes)));
    expect(receipts.map((p: any) => [p.mode, p.amount])).toEqual([['CREDIT_TRANSFER', '500.00']]);
    expect((await service.list(T, credit)).data).toHaveLength(1);
    expect((await service.list(T, owes)).data).toHaveLength(1);
  });

  it('never spends the same credit twice when two transfers arrive at once', async () => {
    if (!ready) return;
    const credit = await makeOrder(500, 800); // 300 credit
    const a = await makeOrder(1000, 0);
    const b = await makeOrder(1000, 0);
    const results = await Promise.allSettled([
      service.transfer(T, USER, credit, { toOrderId: a, amount: 200 }),
      service.transfer(T, USER, credit, { toOrderId: b, amount: 200 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); // the second finds only 100 left
    expect((await orderRow(credit)).advanceReceived).toBe('600.00');
  });

  it('two opposite transfers at once do not deadlock', async () => {
    if (!ready) return;
    const x = await makeOrder(100, 400); // 300 credit
    const y = await makeOrder(1000, 1500); // 500 credit, but also ...
    const z = await makeOrder(1000, 0);
    const results = await Promise.allSettled([
      service.transfer(T, USER, x, { toOrderId: z, amount: 100 }),
      service.transfer(T, USER, y, { toOrderId: z, amount: 100 }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect((await orderRow(z)).advanceReceived).toBe('200.00');
  });

  it('the database refuses a transfer from an order to itself and a zero amount', async () => {
    if (!ready) return;
    const o = await makeOrder(500, 900);
    const attempt = (values: Record<string, unknown>) =>
      inTenant(T, (tx) => tx.insert(creditTransfers).values({ tenantId: T, transferNumber: `CTR-X-${randomUUID().slice(0, 6)}`, customerId: C, fromOrderId: o, toOrderId: o, amount: '5.00', transferredById: USER, ...values } as any));
    await expect(attempt({})).rejects.toThrow(); // from = to
    const o2 = await makeOrder(500, 0);
    await expect(attempt({ toOrderId: o2, amount: '0.00' })).rejects.toThrow(); // amount > 0
  });

  it('another business cannot move this business credit (row-level security)', async () => {
    if (!ready) return;
    const credit = await makeOrder(500, 900);
    const owes = await makeOrder(900, 0);
    await expect(service.transfer(OTHER, USER, credit, { toOrderId: owes })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.options(OTHER, credit)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.transfer(T, USER, credit, { toOrderId: owes, amount: 99999 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
