import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pgClient, tenants, customers, quotations, quotationItems, orders, orderItems } from '@friendly-crm/db';
import { PriceHistoryService } from '../src/modules/sales/price-history.service';

/** The earlier prices of a customer, read from a real Postgres (row-level security included). */
describe('Price history against a real Postgres', () => {
  const service = new PriceHistoryService();
  let ready = false;
  const T = randomUUID();
  const OTHER = randomUUID();
  const suffix = Date.now().toString().slice(-7);
  const inTenant = (id: string, fn: (tx: any) => Promise<any>) =>
    db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${id}, true)`);
      return fn(tx);
    });

  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT 1 FROM quotation_items LIMIT 1`);
      ready = true;
    } catch {
      ready = false;
    }
    if (!ready && process.env.CI) throw new Error('CI must have a migrated Postgres');
    if (!ready) return;
    for (const id of [T, OTHER]) {
      await db.insert(tenants).values({ id, name: `Price DB ${id.slice(0, 4)}`, slug: `price-db-${id}`, industryKey: 'trading', phone: `+9192${suffix}` } as any);
    }
  });

  afterAll(async () => {
    if (ready) await db.delete(tenants).where(sql`${tenants.id} IN (${T}, ${OTHER})`);
    await pgClient?.end?.({ timeout: 1 });
  });

  it('returns sent quotes and orders of this customer only, newest first, never drafts', async () => {
    if (!ready) return;
    const cust = randomUUID();
    const otherCust = randomUUID();
    await inTenant(T, async (tx) => {
      await tx.insert(customers).values([
        { id: cust, tenantId: T, name: 'Price Co', phone: `+9195${suffix}1` },
        { id: otherCust, tenantId: T, name: 'Other Co', phone: `+9195${suffix}2` },
      ] as any);
      const quote = async (customerId: string, status: string, number: string, rate: string, at: string) => {
        const [q] = await tx
          .insert(quotations)
          .values({ tenantId: T, quoteNumber: number, customerId, status, subTotal: '0', grandTotal: '0', createdAt: new Date(at) } as any)
          .returning();
        await tx.insert(quotationItems).values({ tenantId: T, quotationId: q.id, itemName: 'MS Round Rod', description: '50 mm', quantity: '10', unit: 'Kg', unitPrice: rate, lineTotal: '0' } as any);
      };
      await quote(cust, 'SENT', 'QT-P-1', '70.00', '2026-02-01');
      await quote(cust, 'DRAFT', 'QT-P-2', '1.00', '2026-03-01');
      await quote(otherCust, 'SENT', 'QT-P-3', '999.00', '2026-03-01');
      const [o] = await tx
        .insert(orders)
        .values({ tenantId: T, orderNumber: 'ORD-P-1', customerId: cust, productionStage: 'NEW', totalAmount: '0', balanceDue: '0', createdAt: new Date('2026-04-01') } as any)
        .returning();
      await tx.insert(orderItems).values({ tenantId: T, orderId: o.id, itemName: 'MS Round Rod', quantity: '5', unit: 'Kg', unitPrice: '73.00', lineTotal: '0' } as any);
    });

    const history = await service.forCustomer(T, cust);
    expect(history.map((h) => [h.documentNumber, h.unitPrice])).toEqual([['ORD-P-1', 73], ['QT-P-1', 70]]);
    expect(history[1]).toMatchObject({ description: '50 mm', unit: 'Kg' });
  });

  it('another business sees nothing of this customer, and no customer means no history', async () => {
    if (!ready) return;
    const cust = (await inTenant(T, (tx) => tx.select({ id: customers.id }).from(customers).where(eq(customers.name, 'Price Co'))))[0].id;
    expect(await service.forCustomer(OTHER, cust)).toEqual([]);
    expect(await service.forCustomer(T, null)).toEqual([]);
  });
});
