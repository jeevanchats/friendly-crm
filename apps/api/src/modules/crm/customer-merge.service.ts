import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql, eq, and } from 'drizzle-orm';
import { db, customers, customerContacts, leads, tasks, quotations, orders, invoices, creditNotes, payments } from '@friendly-crm/db';
import {
  globalMemoryContacts,
  globalMemoryCustomers,
  globalMemoryInvoices,
  globalMemoryLeads,
  globalMemoryOrders,
  globalMemoryPayments,
  globalMemoryQuotations,
  globalMemoryTasks,
  globalMemoryCreditNotes,
} from './memory-store';
import { memoryFallbackAllowed, onDbError } from '../../common/utils/db-fallback.util';

const MAX_CONTACTS_PER_CUSTOMER = 20;

export interface MergeResult {
  keptId: string;
  removedId: string;
  /** How many records were moved to the kept customer, by kind. */
  moved: Record<'enquiries' | 'tasks' | 'quotations' | 'orders' | 'invoices' | 'creditNotes' | 'payments' | 'contacts', number>;
}

const money = (v: unknown) => Number(v ?? 0) || 0;
const fixed = (n: number) => n.toFixed(2);
const gstinOf = (c: any) => String(c?.gstin ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * Merges two customers that are really one business: everything of the duplicate (enquiries, tasks, quotes, orders, invoices,
 * credit notes, payments, contacts) moves to the customer being kept, the duplicate's own phone numbers become contacts of
 * the kept customer (so the WhatsApp bot still recognises them), blank details are filled from the duplicate, and the
 * duplicate is removed. All or nothing: one transaction. Two different GSTINs mean two legal businesses, which is refused.
 */
@Injectable()
export class CustomerMergeService {
  private readonly logger = new Logger(CustomerMergeService.name);

  async merge(tenantId: string, actorId: string | null, keepId: string, removeId: string): Promise<MergeResult> {
    if (!removeId || typeof removeId !== 'string') throw new BadRequestException('Say which customer to merge in (fromId).');
    if (keepId === removeId) throw new BadRequestException('Choose two different customers.');

    try {
      if (typeof db?.transaction === 'function') {
        const result = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          return this.mergeDb(tx, tenantId, actorId, keepId, removeId);
        });
        if (result) return result;
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      onDbError(this.logger, 'merging customers', err);
    }
    if (!memoryFallbackAllowed()) throw new NotFoundException('Customer not found in this business');
    return this.mergeMemory(tenantId, actorId, keepId, removeId);
  }

  /** What the kept customer gets from the duplicate: only where the kept one is blank (numbers add up). */
  private filled(keep: any, gone: any) {
    const patch: Record<string, unknown> = {};
    for (const k of ['companyName', 'email', 'billingAddress', 'shippingAddress', 'stateCode'] as const) {
      if (!String(keep[k] ?? '').trim() && String(gone[k] ?? '').trim()) patch[k] = gone[k];
    }
    if (!gstinOf(keep) && gstinOf(gone)) patch.gstin = gone.gstin;
    const opening = money(keep.openingBalance) + money(gone.openingBalance);
    if (opening !== money(keep.openingBalance)) patch.openingBalance = fixed(opening);
    if (money(gone.creditLimit) > money(keep.creditLimit)) patch.creditLimit = fixed(money(gone.creditLimit));
    if (gone.remindersOptOut && !keep.remindersOptOut) patch.remindersOptOut = true;
    return patch;
  }

  /** The duplicate's own numbers, to keep as contacts of the kept customer (not ones it already has). */
  private numbersToKeep(keep: any, gone: any, existingPhones: Set<string>) {
    const out: Array<{ name: string; designation: string | null; phone: string; email: string | null }> = [];
    const taken = new Set<string>([keep.phone, keep.whatsappNumber, ...existingPhones].filter(Boolean));
    for (const phone of [gone.phone, gone.whatsappNumber]) {
      if (!phone || taken.has(phone)) continue;
      taken.add(phone);
      out.push({ name: gone.name, designation: 'Merged customer', phone, email: gone.email ?? null });
    }
    return out;
  }

  private refuse(keep: any, gone: any) {
    if (gstinOf(keep) && gstinOf(gone) && gstinOf(keep) !== gstinOf(gone)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'DifferentGstin',
        message: 'These two customers have different GSTINs, so they are different businesses. They cannot be merged.',
      });
    }
  }

  private async mergeDb(tx: any, tenantId: string, actorId: string | null, keepId: string, removeId: string): Promise<MergeResult | undefined> {
    const find = async (id: string) => (await tx.select().from(customers).where(and(eq(customers.id, id), eq(customers.tenantId, tenantId))).limit(1))[0];
    const keep = await find(keepId);
    const gone = await find(removeId);
    if (!keep || !gone) return undefined;
    this.refuse(keep, gone);

    const keepContacts = await tx.select().from(customerContacts).where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, keepId)));
    const goneContacts = await tx.select().from(customerContacts).where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, removeId)));
    const extra = this.numbersToKeep(keep, gone, new Set([...keepContacts, ...goneContacts].map((c: any) => c.phone)));
    if (keepContacts.length + goneContacts.length + extra.length > MAX_CONTACTS_PER_CUSTOMER) {
      throw new BadRequestException(`The merged customer would have more than ${MAX_CONTACTS_PER_CUSTOMER} contacts. Remove some contacts first.`);
    }

    const move = async (table: any) =>
      (await tx.update(table).set({ customerId: keepId }).where(and(eq(table.tenantId, tenantId), eq(table.customerId, removeId))).returning({ id: table.id })).length;
    const moved = {
      enquiries: await move(leads),
      tasks: await move(tasks),
      quotations: await move(quotations),
      orders: await move(orders),
      invoices: await move(invoices),
      creditNotes: await move(creditNotes),
      payments: await move(payments),
      contacts: await move(customerContacts),
    };

    // Remove the duplicate first: that frees its phone and GSTIN for the kept customer to take
    await tx.delete(customers).where(and(eq(customers.id, removeId), eq(customers.tenantId, tenantId)));
    const patch = this.filled(keep, gone);
    if (Object.keys(patch).length) await tx.update(customers).set({ ...patch, updatedAt: new Date() }).where(and(eq(customers.id, keepId), eq(customers.tenantId, tenantId)));
    for (const c of extra) await tx.insert(customerContacts).values({ tenantId, customerId: keepId, ...c, createdById: actorId });
    moved.contacts += extra.length;

    this.logger.log(`Merged customer ${removeId} into ${keepId} (tenant ${tenantId}): ${JSON.stringify(moved)}`);
    return { keptId: keepId, removedId: removeId, moved };
  }

  private mergeMemory(tenantId: string, actorId: string | null, keepId: string, removeId: string): MergeResult {
    const keep: any = globalMemoryCustomers.find((c) => c.id === keepId && c.tenantId === tenantId);
    const gone: any = globalMemoryCustomers.find((c) => c.id === removeId && c.tenantId === tenantId);
    if (!keep || !gone) throw new NotFoundException('Customer not found in this business');
    this.refuse(keep, gone);

    const mine = globalMemoryContacts.filter((c) => c.tenantId === tenantId && (c.customerId === keepId || c.customerId === removeId));
    const extra = this.numbersToKeep(keep, gone, new Set(mine.map((c) => c.phone)));
    if (mine.length + extra.length > MAX_CONTACTS_PER_CUSTOMER) {
      throw new BadRequestException(`The merged customer would have more than ${MAX_CONTACTS_PER_CUSTOMER} contacts. Remove some contacts first.`);
    }

    const move = (rows: any[]) => {
      let n = 0;
      for (const r of rows) if (r.tenantId === tenantId && r.customerId === removeId) { r.customerId = keepId; n++; }
      return n;
    };
    const moved = {
      enquiries: move(globalMemoryLeads),
      tasks: move(globalMemoryTasks),
      quotations: move(globalMemoryQuotations),
      orders: move(globalMemoryOrders),
      invoices: move(globalMemoryInvoices),
      creditNotes: move(globalMemoryCreditNotes),
      payments: move(globalMemoryPayments),
      contacts: move(globalMemoryContacts),
    };

    globalMemoryCustomers.splice(globalMemoryCustomers.indexOf(gone), 1);
    Object.assign(keep, this.filled(keep, gone), { updatedAt: new Date() });
    for (const c of extra) {
      globalMemoryContacts.push({ id: randomUUID(), tenantId, customerId: keepId, ...c, createdById: actorId, createdAt: new Date(), updatedAt: new Date() });
    }
    moved.contacts += extra.length;
    return { keptId: keepId, removedId: removeId, moved };
  }
}
