import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql, eq, and, or, ne, asc } from 'drizzle-orm';
import { db, customers, customerContacts } from '@friendly-crm/db';
import { validateContact } from '@friendly-crm/shared';
import { globalMemoryContacts, globalMemoryCustomers } from './memory-store';
import { memoryFallbackAllowed, onDbError } from '../../common/utils/db-fallback.util';

const MAX_CONTACTS_PER_CUSTOMER = 20;

export interface ContactView {
  id: string;
  customerId: string;
  name: string;
  designation: string | null;
  phone: string;
  email: string | null;
}

const toView = (c: any): ContactView => ({
  id: String(c.id),
  customerId: String(c.customerId),
  name: c.name,
  designation: c.designation ?? null,
  phone: c.phone,
  email: c.email ?? null,
});

/**
 * The people who deal with us for a customer (owner, accounts, purchase...). The customer's own phone stays its primary
 * contact; this adds more. A mobile number identifies exactly ONE customer in a business, so a number that is already a
 * customer's phone (or WhatsApp number) or another contact's is refused, and the answer says whose it is.
 */
@Injectable()
export class CustomerContactsService {
  private readonly logger = new Logger(CustomerContactsService.name);

  /**
   * Runs `dbFn` in a business-scoped transaction. `dbFn` returns undefined when the customer is not in Postgres, in which
   * case (development and tests only) the in-memory copy is used; elsewhere that is simply "not found".
   */
  private async both<T>(tenantId: string, op: string, dbFn: (tx: any) => Promise<T | undefined>, memFn: () => T): Promise<T> {
    try {
      if (typeof db?.transaction === 'function') {
        const result = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          return dbFn(tx);
        });
        if (result !== undefined) return result;
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      if (err?.code === '23505') {
        throw new ConflictException({ statusCode: 409, error: 'PhoneInUse', message: 'That number already belongs to someone in this business.' });
      }
      onDbError(this.logger, op, err);
    }
    if (!memoryFallbackAllowed()) throw new NotFoundException('Customer not found in this business');
    return memFn();
  }

  private inUse(who: string, phone: string, customerId: string) {
    return new ConflictException({ statusCode: 409, error: 'PhoneInUse', message: `${who} already uses ${phone}.`, customerId });
  }

  // ---------------------------------------------------------------- reads

  async list(tenantId: string, customerId: string): Promise<ContactView[]> {
    return this.both(
      tenantId,
      'listing customer contacts',
      async (tx) => {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
        if (!c) return undefined;
        const rows = await tx
          .select()
          .from(customerContacts)
          .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, customerId)))
          .orderBy(asc(customerContacts.name));
        return rows.map(toView);
      },
      () => {
        this.memCustomer(tenantId, customerId);
        return globalMemoryContacts.filter((c) => c.tenantId === tenantId && c.customerId === customerId).map(toView);
      }
    );
  }

  // ---------------------------------------------------------------- writes

  async create(tenantId: string, actorId: string | null, customerId: string, raw: Record<string, unknown>): Promise<ContactView> {
    const check = validateContact(raw ?? {});
    if (!check.ok) throw new BadRequestException({ statusCode: 400, error: 'InvalidContact', message: check.errors.join('. '), errors: check.errors });
    const v = check.value as Required<NonNullable<typeof check.value>>;

    return this.both(
      tenantId,
      'adding a customer contact',
      async (tx) => {
        const [c] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
        if (!c) return undefined;
        await this.assertPhoneFreeDb(tx, tenantId, v.phone);
        const count = (await tx.select({ id: customerContacts.id }).from(customerContacts).where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, customerId)))).length;
        if (count >= MAX_CONTACTS_PER_CUSTOMER) throw new BadRequestException(`A customer can have at most ${MAX_CONTACTS_PER_CUSTOMER} contacts`);
        const [row] = await tx
          .insert(customerContacts)
          .values({ tenantId, customerId, name: v.name, designation: v.designation, phone: v.phone, email: v.email, createdById: actorId })
          .returning();
        return toView(row);
      },
      () => {
        this.memCustomer(tenantId, customerId);
        this.assertPhoneFreeMem(tenantId, v.phone);
        if (globalMemoryContacts.filter((c) => c.tenantId === tenantId && c.customerId === customerId).length >= MAX_CONTACTS_PER_CUSTOMER) {
          throw new BadRequestException(`A customer can have at most ${MAX_CONTACTS_PER_CUSTOMER} contacts`);
        }
        const row = { id: randomUUID(), tenantId, customerId, name: v.name, designation: v.designation, phone: v.phone, email: v.email, createdById: actorId, createdAt: new Date(), updatedAt: new Date() };
        globalMemoryContacts.push(row);
        return toView(row);
      }
    );
  }

  async update(tenantId: string, customerId: string, contactId: string, raw: Record<string, unknown>): Promise<ContactView> {
    const check = validateContact(raw ?? {}, { partial: true });
    if (!check.ok) throw new BadRequestException({ statusCode: 400, error: 'InvalidContact', message: check.errors.join('. '), errors: check.errors });
    const patch = check.value;
    if (Object.keys(patch).length === 0) throw new BadRequestException('Nothing to update: send name, designation, phone and/or email');

    return this.both(
      tenantId,
      'updating a customer contact',
      async (tx) => {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
        if (!c) return undefined;
        const [existing] = await tx
          .select()
          .from(customerContacts)
          .where(and(eq(customerContacts.id, contactId), eq(customerContacts.customerId, customerId), eq(customerContacts.tenantId, tenantId)))
          .limit(1);
        if (!existing) throw new NotFoundException('Contact not found for this customer');
        if (patch.phone && patch.phone !== existing.phone) await this.assertPhoneFreeDb(tx, tenantId, patch.phone, contactId);
        const [row] = await tx
          .update(customerContacts)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(customerContacts.id, contactId), eq(customerContacts.tenantId, tenantId)))
          .returning();
        return toView(row);
      },
      () => {
        this.memCustomer(tenantId, customerId);
        const row = globalMemoryContacts.find((c) => c.id === contactId && c.customerId === customerId && c.tenantId === tenantId);
        if (!row) throw new NotFoundException('Contact not found for this customer');
        if (patch.phone && patch.phone !== row.phone) this.assertPhoneFreeMem(tenantId, patch.phone, contactId);
        Object.assign(row, patch, { updatedAt: new Date() });
        return toView(row);
      }
    );
  }

  async remove(tenantId: string, customerId: string, contactId: string): Promise<{ ok: true }> {
    return this.both(
      tenantId,
      'removing a customer contact',
      async (tx) => {
        const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
        if (!c) return undefined;
        const gone = await tx
          .delete(customerContacts)
          .where(and(eq(customerContacts.id, contactId), eq(customerContacts.customerId, customerId), eq(customerContacts.tenantId, tenantId)))
          .returning({ id: customerContacts.id });
        if (gone.length === 0) throw new NotFoundException('Contact not found for this customer');
        return { ok: true as const };
      },
      () => {
        this.memCustomer(tenantId, customerId);
        const i = globalMemoryContacts.findIndex((c) => c.id === contactId && c.customerId === customerId && c.tenantId === tenantId);
        if (i < 0) throw new NotFoundException('Contact not found for this customer');
        globalMemoryContacts.splice(i, 1);
        return { ok: true as const };
      }
    );
  }

  // ---------------------------------------------------------------- WhatsApp number

  /** The customer's main phone and the number its WhatsApp messages go to (its own phone when none is set). */
  async numbers(tenantId: string, customerId: string): Promise<{ phone: string; whatsappNumber: string }> {
    return this.both(
      tenantId,
      'reading customer numbers',
      async (tx) => {
        const [c] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
        return c ? { phone: c.phone, whatsappNumber: c.whatsappNumber || c.phone } : undefined;
      },
      () => {
        const c: any = globalMemoryCustomers.find((x: any) => x.id === customerId && x.tenantId === tenantId);
        return { phone: c.phone, whatsappNumber: c.whatsappNumber || c.phone };
      }
    );
  }

  /**
   * Sends this customer's WhatsApp messages to a contact's number. The contact becomes the WhatsApp number (it is no longer
   * listed as a person: one number lives in one place). A different WhatsApp number it replaces is kept as a contact so
   * it is still recognised when that number writes in; the main phone stays as it is.
   */
  async useForWhatsApp(tenantId: string, actorId: string | null, customerId: string, contactId: string) {
    return this.both(
      tenantId,
      'setting the WhatsApp number',
      async (tx) => {
        const [cust] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
        if (!cust) return undefined;
        const [contact] = await tx
          .select()
          .from(customerContacts)
          .where(and(eq(customerContacts.id, contactId), eq(customerContacts.customerId, customerId), eq(customerContacts.tenantId, tenantId)))
          .limit(1);
        if (!contact) throw new NotFoundException('Contact not found for this customer');
        const old = cust.whatsappNumber;
        await tx.delete(customerContacts).where(eq(customerContacts.id, contactId));
        await tx.update(customers).set({ whatsappNumber: contact.phone, updatedAt: new Date() }).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
        if (old && old !== cust.phone && old !== contact.phone) {
          await tx.insert(customerContacts).values({ tenantId, customerId, name: cust.name, designation: 'Earlier WhatsApp number', phone: old, createdById: actorId });
        }
        return { phone: cust.phone, whatsappNumber: contact.phone as string };
      },
      () => {
        const cust: any = globalMemoryCustomers.find((x: any) => x.id === customerId && x.tenantId === tenantId);
        const i = globalMemoryContacts.findIndex((c) => c.id === contactId && c.customerId === customerId && c.tenantId === tenantId);
        if (i < 0) throw new NotFoundException('Contact not found for this customer');
        const contact = globalMemoryContacts[i];
        const old = cust.whatsappNumber;
        globalMemoryContacts.splice(i, 1);
        cust.whatsappNumber = contact.phone;
        if (old && old !== cust.phone && old !== contact.phone) {
          globalMemoryContacts.push({ id: randomUUID(), tenantId, customerId, name: cust.name, designation: 'Earlier WhatsApp number', phone: old, email: null, createdById: actorId, createdAt: new Date(), updatedAt: new Date() });
        }
        return { phone: cust.phone as string, whatsappNumber: contact.phone as string };
      }
    );
  }

  /**
   * Goes back to sending WhatsApp messages to the customer's main phone. The number that was the WhatsApp number is kept
   * as a contact (so it is still recognised when it writes in); it can be made the WhatsApp number again at any time.
   */
  async useMainForWhatsApp(tenantId: string, actorId: string | null, customerId: string) {
    return this.both(
      tenantId,
      'resetting the WhatsApp number',
      async (tx) => {
        const [cust] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
        if (!cust) return undefined;
        const old = cust.whatsappNumber;
        if (old && old !== cust.phone) {
          const count = (await tx.select({ id: customerContacts.id }).from(customerContacts).where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, customerId)))).length;
          if (count >= MAX_CONTACTS_PER_CUSTOMER) throw new BadRequestException(`A customer can have at most ${MAX_CONTACTS_PER_CUSTOMER} contacts. Remove one first.`);
          await tx.update(customers).set({ whatsappNumber: cust.phone, updatedAt: new Date() }).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
          await tx.insert(customerContacts).values({ tenantId, customerId, name: cust.name, designation: 'Earlier WhatsApp number', phone: old, createdById: actorId });
        }
        return { phone: cust.phone as string, whatsappNumber: cust.phone as string };
      },
      () => {
        const cust: any = globalMemoryCustomers.find((x: any) => x.id === customerId && x.tenantId === tenantId);
        const old = cust.whatsappNumber;
        if (old && old !== cust.phone) {
          if (globalMemoryContacts.filter((c) => c.tenantId === tenantId && c.customerId === customerId).length >= MAX_CONTACTS_PER_CUSTOMER) {
            throw new BadRequestException(`A customer can have at most ${MAX_CONTACTS_PER_CUSTOMER} contacts. Remove one first.`);
          }
          cust.whatsappNumber = cust.phone;
          globalMemoryContacts.push({ id: randomUUID(), tenantId, customerId, name: cust.name, designation: 'Earlier WhatsApp number', phone: old, email: null, createdById: actorId, createdAt: new Date(), updatedAt: new Date() });
        }
        return { phone: cust.phone as string, whatsappNumber: cust.phone as string };
      }
    );
  }

  // ---------------------------------------------------------------- the one-number-one-customer rule

  private async assertPhoneFreeDb(tx: any, tenantId: string, phone: string, exceptContactId?: string) {
    const [cust] = await tx
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), or(eq(customers.phone, phone), eq(customers.whatsappNumber, phone))))
      .limit(1);
    if (cust) throw this.inUse(cust.name, phone, cust.id);
    const [other] = await tx
      .select({ name: customerContacts.name, customerId: customerContacts.customerId })
      .from(customerContacts)
      .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.phone, phone), exceptContactId ? ne(customerContacts.id, exceptContactId) : sql`true`))
      .limit(1);
    if (other) throw this.inUse(other.name, phone, other.customerId);
  }

  private assertPhoneFreeMem(tenantId: string, phone: string, exceptContactId?: string) {
    const cust = globalMemoryCustomers.find((c: any) => c.tenantId === tenantId && (c.phone === phone || c.whatsappNumber === phone));
    if (cust) throw this.inUse(cust.name, phone, cust.id);
    const other = globalMemoryContacts.find((c) => c.tenantId === tenantId && c.phone === phone && c.id !== exceptContactId);
    if (other) throw this.inUse(other.name, phone, other.customerId);
  }

  private memCustomer(tenantId: string, customerId: string) {
    if (!globalMemoryCustomers.some((c: any) => c.id === customerId && c.tenantId === tenantId)) {
      throw new NotFoundException('Customer not found in this business');
    }
  }
}
