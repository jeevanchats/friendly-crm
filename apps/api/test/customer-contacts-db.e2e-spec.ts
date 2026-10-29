import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pgClient, tenants, customers, customerContacts } from '@friendly-crm/db';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerContactsService } from '../src/modules/crm/customer-contacts.service';

/**
 * The same rules as customer-contacts.e2e-spec.ts, but against a real Postgres: they exercise migration 0018 (the
 * contacts table, its unique phone index, row-level security, and lookup_customer_by_phone seeing a contact's number).
 * Skipped when no database with the migrations applied is reachable.
 */
describe('Customer contacts against a real Postgres', () => {
  const service = new CustomerContactsService();
  let ready = false;
  const T = randomUUID();
  const OTHER = randomUUID();
  const C1 = randomUUID();
  const C2 = randomUUID();
  const suffix = Date.now().toString().slice(-6);
  const phone = (n: number) => `+9198${suffix}${String(n).padStart(2, '0')}`.slice(0, 13);

  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT 1 FROM customer_contacts LIMIT 0`);
      ready = true;
    } catch {
      ready = false;
      // CI has a migrated Postgres: a silent skip there would hide a broken migration
      if (process.env.CI) throw new Error('CI must have Postgres with migration 0018 applied');
      return;
    }
    for (const id of [T, OTHER]) {
      await db.insert(tenants).values({ id, name: `Contacts DB ${id.slice(0, 4)}`, slug: `contacts-db-${id}`, industryKey: 'printing', phone: phone(90) } as any);
    }
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${T}, true)`);
      await tx.insert(customers).values([
        { id: C1, tenantId: T, name: 'Anand Traders', phone: phone(1), whatsappNumber: phone(9) },
        { id: C2, tenantId: T, name: 'Bala Stores', phone: phone(2) },
      ] as any);
    });
  });

  afterAll(async () => {
    if (ready) await db.delete(tenants).where(sql`${tenants.id} IN (${T}, ${OTHER})`);
    await pgClient?.end?.({ timeout: 1 });
  });

  it('adds a contact, lists it, and refuses a number that is already someone\'s', async () => {
    if (!ready) return;
    const c = await service.create(T, null, C1, { name: 'Ravi', phone: phone(11), designation: 'Accounts' });
    expect(c).toMatchObject({ customerId: C1, name: 'Ravi', phone: phone(11) });
    expect(await service.list(T, C1)).toHaveLength(1);

    await expect(service.create(T, null, C2, { name: 'X', phone: phone(11) })).rejects.toBeInstanceOf(ConflictException); // another contact's
    await expect(service.create(T, null, C2, { name: 'X', phone: phone(1) })).rejects.toBeInstanceOf(ConflictException); // a customer's phone
    await expect(service.create(T, null, C2, { name: 'X', phone: phone(9) })).rejects.toBeInstanceOf(ConflictException); // a customer's WhatsApp
  });

  it("another business cannot see or touch this business's customer or contacts (row-level security)", async () => {
    if (!ready) return;
    await expect(service.list(OTHER, C1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create(OTHER, null, C1, { name: 'Y', phone: phone(12) })).rejects.toBeInstanceOf(NotFoundException);
    // the same number is free in another business
    const elsewhere = await db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${OTHER}, true)`);
      const [c] = await tx.insert(customers).values({ tenantId: OTHER, name: 'Elsewhere', phone: phone(3) } as any).returning();
      return c;
    });
    const added = await service.create(OTHER, null, elsewhere.id, { name: 'Same Number', phone: phone(11) });
    expect(added.phone).toBe(phone(11));
  });

  it("lookup_customer_by_phone (the WhatsApp bot's lookup) resolves a contact's number to their customer", async () => {
    if (!ready) return;
    const rows: any = await db.execute(sql`SELECT * FROM lookup_customer_by_phone(${phone(11)})`);
    const list = Array.isArray(rows) ? rows : rows.rows;
    const mine = list.find((r: any) => r.tenant_id === T);
    expect(mine).toMatchObject({ customer_id: C1, customer_name: 'Anand Traders' });
    // listing is by customer, not by matching row: a customer matched twice still appears once
    expect(list.filter((r: any) => r.customer_id === C1)).toHaveLength(1);
  });

  it('the database itself refuses a duplicate number inside a business, and removes contacts with their customer', async () => {
    if (!ready) return;
    await expect(
      db.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${T}, true)`);
        await tx.insert(customerContacts).values({ tenantId: T, customerId: C2, name: 'Dup', phone: phone(11) } as any);
      })
    ).rejects.toMatchObject({ code: '23505' });

    await db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${T}, true)`);
      await tx.delete(customers).where(eq(customers.id, C1));
      expect(await tx.select().from(customerContacts).where(eq(customerContacts.customerId, C1))).toHaveLength(0);
    });
  });
});
