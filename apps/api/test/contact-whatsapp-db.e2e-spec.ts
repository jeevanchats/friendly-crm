import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db, pgClient, tenants, customers, customerContacts } from '@friendly-crm/db';
import { CustomerContactsService } from '../src/modules/crm/customer-contacts.service';

/** "Use for WhatsApp" against a real Postgres: one transaction, both numbers still resolve to the customer. */
describe('Use a contact\'s number for WhatsApp against a real Postgres', () => {
  const service = new CustomerContactsService();
  let ready = false;
  const T = randomUUID();
  const C = randomUUID();
  const suffix = Date.now().toString().slice(-6);
  const phone = (n: number) => `+9198${suffix}${String(n).padStart(2, '0')}`.slice(0, 13);
  const inTenant = (fn: (tx: any) => Promise<any>) =>
    db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${T}, true)`);
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
    await db.insert(tenants).values({ id: T, name: 'WA DB', slug: `wa-db-${T}`, industryKey: 'printing', phone: phone(90) } as any);
    await inTenant((tx) => tx.insert(customers).values({ id: C, tenantId: T, name: 'Chris Studio', phone: phone(1), whatsappNumber: phone(2) } as any));
  });

  afterAll(async () => {
    if (ready) await db.delete(tenants).where(eq(tenants.id, T));
    await pgClient?.end?.({ timeout: 1 });
  });

  it('makes a person number the WhatsApp number, keeps the person and the earlier number, and all still find the customer', async () => {
    if (!ready) return;
    const added = await service.create(T, null, C, { name: 'Jeevan', phone: phone(3) });
    const out = await service.useForWhatsApp(T, null, C, added.id);
    expect(out).toEqual({ phone: phone(1), whatsappNumber: phone(3) });

    await inTenant(async (tx) => {
      const [c] = await tx.select().from(customers).where(eq(customers.id, C));
      expect(c.whatsappNumber).toBe(phone(3));
      const phones = (await tx.select().from(customerContacts).where(eq(customerContacts.customerId, C))).map((x: any) => x.phone);
      expect(phones.sort()).toEqual([phone(2), phone(3)].sort()); // the person stays; the earlier WhatsApp number is added
    });
    for (const p of [phone(1), phone(2), phone(3)]) {
      const rows = (await db.execute(sql`SELECT * FROM lookup_customer_by_phone(${p})`)) as any;
      expect(rows[0]?.customer_id).toBe(C);
    }
    expect(await service.numbers(T, C)).toEqual({ phone: phone(1), whatsappNumber: phone(3) });
  });

  it('goes back to the main phone: the number it leaves becomes a contact and everything still resolves', async () => {
    if (!ready) return;
    const out = await service.useMainForWhatsApp(T, null, C);
    expect(out).toEqual({ phone: phone(1), whatsappNumber: phone(1) });
    await inTenant(async (tx) => {
      const phones = (await tx.select().from(customerContacts).where(eq(customerContacts.customerId, C))).map((x: any) => x.phone).sort();
      expect(phones).toEqual([phone(2), phone(3)].sort());
    });
    for (const p of [phone(1), phone(2), phone(3)]) {
      const rows = (await db.execute(sql`SELECT * FROM lookup_customer_by_phone(${p})`)) as any;
      expect(rows[0]?.customer_id).toBe(C);
    }
  });
});
