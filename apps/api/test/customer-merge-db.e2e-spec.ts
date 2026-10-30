import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pgClient, tenants, customers, customerContacts, leads, quotations, orders } from '@friendly-crm/db';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerMergeService } from '../src/modules/crm/customer-merge.service';

/**
 * Merging customers against a real Postgres: foreign keys, the unique phone and GSTIN indexes, and row-level security.
 * Skipped when no database with the migrations applied is reachable.
 */
describe('Customer merge against a real Postgres', () => {
  const service = new CustomerMergeService();
  let ready = false;
  const T = randomUUID();
  const OTHER = randomUUID();
  const KEEP = randomUUID();
  const GONE = randomUUID();
  const FOREIGN = randomUUID();
  const suffix = Date.now().toString().slice(-6);
  const phone = (n: number) => `+9198${suffix}${String(n).padStart(2, '0')}`.slice(0, 13);
  const inTenant = (id: string, fn: (tx: any) => Promise<any>) =>
    db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${id}, true)`);
      return fn(tx);
    });

  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT 1 FROM customer_contacts LIMIT 0`);
      ready = true;
    } catch {
      if (process.env.CI) throw new Error('CI must have Postgres with the migrations applied');
      return;
    }
    for (const id of [T, OTHER]) {
      await db.insert(tenants).values({ id, name: `Merge DB ${id.slice(0, 4)}`, slug: `merge-db-${id}`, industryKey: 'printing', phone: phone(90) } as any);
    }
    await inTenant(T, (tx) =>
      tx.insert(customers).values([
        { id: KEEP, tenantId: T, name: 'CHRIS GRAPHIC DESIGN STUDIO', phone: phone(1), openingBalance: '100.00' },
        { id: GONE, tenantId: T, name: 'chris graphic', phone: phone(2), gstin: '33ABCDE1234F1Z5', email: 'c@x.in', openingBalance: '20.00' },
      ] as any)
    );
    await inTenant(OTHER, (tx) => tx.insert(customers).values({ id: FOREIGN, tenantId: OTHER, name: 'Elsewhere', phone: phone(3) } as any));
  });

  afterAll(async () => {
    if (ready) await db.delete(tenants).where(sql`${tenants.id} IN (${T}, ${OTHER})`);
    await pgClient?.end?.({ timeout: 1 });
  });

  it('moves enquiries, quotes, orders and contacts across, keeps the numbers, and removes the duplicate', async () => {
    if (!ready) return;
    await inTenant(T, async (tx) => {
      const [lead] = await tx.insert(leads).values({ tenantId: T, customerId: GONE, title: 'Cards', source: 'PHONE' } as any).returning();
      const [q] = await tx.insert(quotations).values({ tenantId: T, quoteNumber: `QT-${suffix}`, customerId: GONE, leadId: lead.id, subTotal: '100', grandTotal: '118' } as any).returning();
      await tx.insert(orders).values({ tenantId: T, orderNumber: `ORD-${suffix}`, customerId: GONE, quotationId: q.id, productionStage: 'NEW', totalAmount: '118', balanceDue: '118' } as any);
      await tx.insert(customerContacts).values({ tenantId: T, customerId: GONE, name: 'Ravi', phone: phone(9) } as any);
    });

    const out = await service.merge(T, null, KEEP, GONE);
    expect(out.moved).toMatchObject({ enquiries: 1, quotations: 1, orders: 1 });
    expect(out.moved.contacts).toBe(2); // Ravi + the duplicate's own phone

    await inTenant(T, async (tx) => {
      expect(await tx.select().from(customers).where(eq(customers.id, GONE))).toHaveLength(0);
      const [keep] = await tx.select().from(customers).where(eq(customers.id, KEEP));
      expect(keep).toMatchObject({ gstin: '33ABCDE1234F1Z5', email: 'c@x.in', openingBalance: '120.00' });
      expect((await tx.select().from(leads).where(eq(leads.customerId, KEEP))).length).toBe(1);
      const phones = (await tx.select().from(customerContacts).where(eq(customerContacts.customerId, KEEP))).map((c: any) => c.phone).sort();
      expect(phones).toEqual([phone(2), phone(9)].sort());
    });
    // the duplicate's old number now leads to the kept customer
    const [hit] = (await db.execute(sql`SELECT * FROM lookup_customer_by_phone(${phone(2)})`)) as any;
    expect(hit?.customer_id).toBe(KEEP);
  });

  it("will not merge another business's customer (row-level security) or two different GSTINs", async () => {
    if (!ready) return;
    await expect(service.merge(T, null, KEEP, FOREIGN)).rejects.toBeInstanceOf(NotFoundException);
    const A = randomUUID();
    const B = randomUUID();
    await inTenant(T, (tx) =>
      tx.insert(customers).values([
        { id: A, tenantId: T, name: 'A Co', phone: phone(4), gstin: '33AAAAA1111A1Z1' },
        { id: B, tenantId: T, name: 'B Co', phone: phone(5), gstin: '33BBBBB2222B1Z2' },
      ] as any)
    );
    await expect(service.merge(T, null, A, B)).rejects.toBeInstanceOf(ConflictException);
    await inTenant(T, async (tx) => expect(await tx.select().from(customers).where(eq(customers.id, B))).toHaveLength(1));
  });
});
