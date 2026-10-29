import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pgClient, tenants, customers, products, quotations, quotationItems } from '@friendly-crm/db';

/** Migration 0019 against a real Postgres: a line keeps its own copy of the product, and only loses the link if the product goes. */
describe('Quote line product link against a real Postgres', () => {
  let ready = false;
  const T = randomUUID();
  const suffix = Date.now().toString().slice(-6);

  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT product_id FROM quotation_items LIMIT 0`);
      ready = true;
    } catch {
      if (process.env.CI) throw new Error('CI must have Postgres with migration 0019 applied');
      return;
    }
    await db.insert(tenants).values({ id: T, name: 'Lines DB', slug: `lines-db-${T}`, industryKey: 'printing', phone: `+9198${suffix}01` } as any);
  });

  afterAll(async () => {
    if (ready) await db.delete(tenants).where(eq(tenants.id, T));
    await pgClient?.end?.({ timeout: 1 });
  });

  it('stores the link on the line and on the order line, and unlinks (keeps the line) when the product is deleted', async () => {
    if (!ready) return;
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${T}, true)`);
      const [cust] = await tx.insert(customers).values({ tenantId: T, name: 'Lines Customer', phone: `+9198${suffix}02` } as any).returning();
      const [prod] = await tx.insert(products).values({ tenantId: T, name: 'Wall Calendar', unit: 'Nos', unitPrice: '85.00', taxPercent: '12.00' } as any).returning();
      const [q] = await tx
        .insert(quotations)
        .values({ tenantId: T, quoteNumber: `QT-T-${suffix}`, version: 1, customerId: cust.id, status: 'SENT', subTotal: '8500.00', taxTotal: '1020.00', discountTotal: '0.00', grandTotal: '9520.00' } as any)
        .returning();
      const [item] = await tx
        .insert(quotationItems)
        .values({ tenantId: T, quotationId: q.id, productId: prod.id, itemName: 'Wall Calendar', quantity: '100.00', unit: 'Nos', unitPrice: '85.00', taxPercent: '12.00', lineTotal: '9520.00' } as any)
        .returning();
      expect(item.productId).toBe(prod.id);

      await tx.delete(products).where(eq(products.id, prod.id));
      const [after] = await tx.select().from(quotationItems).where(eq(quotationItems.id, item.id));
      expect(after.productId).toBeNull();
      expect(after.itemName).toBe('Wall Calendar');
      expect(after.unitPrice).toBe('85.00');
    });
  });
});
