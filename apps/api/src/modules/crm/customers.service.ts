import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql, eq, and, or, inArray, desc } from 'drizzle-orm';
import {
  db,
  customers,
  leads,
  quotations,
  orders,
  payments,
  tasks,
  activities,
} from '@friendly-crm/db';
import {
  TenantRole,
  CleanCustomer,
  hasPermission,
  validateCustomerRow,
  isValidGstin,
  isValidStateCode,
  normalizeGstin,
  stateCodeFromGstin,
} from '@friendly-crm/shared';
import { filterAndSanitizeActivities } from '../../common';
import {
  globalMemoryCustomers,
  globalMemoryOrders,
  globalMemoryQuotations,
  globalMemoryLeads,
  globalMemoryPayments,
  globalMemoryTasks,
  globalMemoryActivities,
} from './memory-store';
import { onDbError } from '../../common/utils/db-fallback.util';

export const MAX_IMPORT_ROWS = 1000;

export type ImportRowStatus = 'create' | 'update' | 'skip' | 'error';

export interface ImportRowResult {
  /** 1-based position among the data rows (not counting the header). */
  row: number;
  name: string;
  phone: string;
  status: ImportRowStatus;
  messages: string[];
}

export interface ImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  /** Total of the opening balances being brought in by new customers, in rupees. */
  openingBalanceTotal: string;
  rows: ImportRowResult[];
}

const money = (paise: number) => (paise / 100).toFixed(2);

export interface PilotCustomerRecord {
  id: string;
  tenantId: string;
  name: string;
  companyName?: string;
  phone: string;
  whatsappNumber?: string;
  gstin?: string;
  openingBalance: string;
  creditLimit: string;
  activeOrdersCount: number;
  totalReceivable: string;
  createdAt: Date;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  /** Customers of this business whose phone number is one of `phones`, keyed by E.164 number. */
  private async findByPhones(tx: any | null, tenantId: string, phones: string[]): Promise<Map<string, any>> {
    const out = new Map<string, any>();
    if (phones.length === 0) return out;
    if (tx) {
      for (let i = 0; i < phones.length; i += 500) {
        const rows = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), inArray(customers.phone, phones.slice(i, i + 500))));
        for (const r of rows) out.set(r.phone, r);
      }
    } else {
      const want = new Set(phones);
      for (const c of globalMemoryCustomers) if (c.tenantId === tenantId && want.has(c.phone)) out.set(c.phone, c);
    }
    return out;
  }

  private insertValues(tenantId: string, actorId: string | null, c: CleanCustomer) {
    return {
      tenantId,
      name: c.name,
      companyName: c.companyName,
      phone: c.phone,
      whatsappNumber: c.whatsappNumber,
      email: c.email,
      gstin: c.gstin,
      stateCode: c.stateCode,
      billingAddress: c.billingAddress,
      openingBalance: money(c.openingBalancePaise),
      creditLimit: money(c.creditLimitPaise),
      createdById: actorId,
    };
  }

  /** What changes on an existing customer when an import says 'update': only fields the sheet actually filled in. */
  private updateValues(c: CleanCustomer) {
    const set: Record<string, unknown> = {};
    if (c.companyName) set.companyName = c.companyName;
    if (c.email) set.email = c.email;
    if (c.gstin) {
      set.gstin = c.gstin;
      set.stateCode = c.stateCode;
    } else if (c.stateCode) set.stateCode = c.stateCode;
    if (c.billingAddress) set.billingAddress = c.billingAddress;
    if (c.creditLimitPaise > 0) set.creditLimit = money(c.creditLimitPaise);
    return set;
  }

  /** What this customer owed before Friendly CRM, as rupees text ("0.00" if nothing / unknown customer). */
  async getOpeningBalance(tenantId: string, customerId: string): Promise<string> {
    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [row] = await tx
            .select({ openingBalance: customers.openingBalance })
            .from(customers)
            .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
            .limit(1);
          return row?.openingBalance ?? '0.00';
        });
      }
    } catch (err: any) {
      onDbError(this.logger, 'reading opening balance from memory', err);
    }
    const mem: any = globalMemoryCustomers.find((c) => c.id === customerId && c.tenantId === tenantId);
    return mem?.openingBalance ?? '0.00';
  }

  /** Adds one customer. A phone number that already belongs to a customer of this business is refused. */
  async createCustomer(tenantId: string, actorId: string | null, raw: Record<string, unknown>) {
    const check = validateCustomerRow(raw as any);
    if (!check.ok || !check.value) {
      throw new BadRequestException({ statusCode: 400, error: 'InvalidCustomer', message: check.errors.join('. '), errors: check.errors });
    }
    const c = check.value;
    const dup = (existing: any) =>
      new ConflictException({
        statusCode: 409,
        error: 'CustomerExists',
        message: `${existing.name} already uses ${c.phone}.`,
        customerId: existing.id,
      });

    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const existing = (await this.findByPhones(tx, tenantId, [c.phone])).get(c.phone);
          if (existing) throw dup(existing);
          const [row] = await tx.insert(customers).values(this.insertValues(tenantId, actorId, c)).returning();
          return row;
        });
      }
    } catch (err: any) {
      if (err instanceof ConflictException) throw err;
      if (err?.code === '23505') throw new ConflictException({ statusCode: 409, error: 'CustomerExists', message: `${c.phone} is already a customer.` });
      onDbError(this.logger, 'creating customer in memory', err);
    }
    const existing = (await this.findByPhones(null, tenantId, [c.phone])).get(c.phone);
    if (existing) throw dup(existing);
    const mem: any = {
      id: randomUUID(),
      ...this.insertValues(tenantId, actorId, c),
      activeOrdersCount: 0,
      totalReceivable: money(c.openingBalancePaise),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    globalMemoryCustomers.push(mem);
    return mem;
  }

  /**
   * Bulk-adds customers from a parsed sheet. Every row is checked with the same rules as the browser preview.
   * `dryRun` reports what would happen without writing. Rows with problems are reported and skipped; they never
   * stop the good rows. A phone number that already belongs to a customer is skipped, or, with 'update', has only
   * its blank fields filled. Opening balances are only ever set on NEW customers: changing the balance of an
   * existing customer from a sheet could double-count money they have already paid.
   */
  async importCustomers(
    tenantId: string,
    actorId: string | null,
    rawRows: unknown,
    opts: { dryRun: boolean; onDuplicate: 'skip' | 'update' }
  ): Promise<ImportResult> {
    if (!Array.isArray(rawRows) || rawRows.length === 0) throw new BadRequestException('Send at least one row to import');
    if (rawRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Import at most ${MAX_IMPORT_ROWS} customers at a time (this file has ${rawRows.length}). Split it into parts.`);
    }

    type Planned = { result: ImportRowResult; clean?: CleanCustomer; existing?: any; warnings?: string[] };
    const planned: Planned[] = [];
    const firstRowForPhone = new Map<string, number>();

    rawRows.forEach((raw, i) => {
      const rowNo = i + 1;
      const check = validateCustomerRow((raw && typeof raw === 'object' ? raw : {}) as any);
      const name = String((raw as any)?.name ?? '').trim();
      const phoneText = String((raw as any)?.phone ?? '').trim();
      if (!check.ok || !check.value) {
        planned.push({ result: { row: rowNo, name, phone: phoneText, status: 'error', messages: check.errors } });
        return;
      }
      const seen = firstRowForPhone.get(check.value.phone);
      if (seen !== undefined) {
        planned.push({
          result: { row: rowNo, name: check.value.name, phone: check.value.phone, status: 'error', messages: [`Same phone number as row ${seen}`] },
        });
        return;
      }
      firstRowForPhone.set(check.value.phone, rowNo);
      planned.push({
        result: { row: rowNo, name: check.value.name, phone: check.value.phone, status: 'create', messages: [...check.warnings] },
        clean: check.value,
        warnings: [...check.warnings],
      });
    });

    const run = async (tx: any | null) => {
      const phones = planned.filter((p) => p.clean).map((p) => p.clean!.phone);
      const existing = await this.findByPhones(tx, tenantId, phones);
      for (const p of planned) {
        if (!p.clean) continue;
        const found = existing.get(p.clean.phone);
        if (!found) continue;
        p.existing = found;
        if (opts.onDuplicate === 'update') {
          p.result.status = 'update';
          p.result.messages.push(`Already a customer (${found.name}); blank fields will be filled in`);
          if (p.clean.openingBalancePaise > 0) p.result.messages.push('Opening balance not changed for an existing customer');
        } else {
          p.result.status = 'skip';
          p.result.messages.push(`Already a customer (${found.name})`);
        }
      }
      if (opts.dryRun) return;

      const toCreate = planned.filter((p) => p.result.status === 'create' && p.clean);
      const toUpdate = planned.filter((p) => p.result.status === 'update' && p.clean && p.existing);
      if (tx) {
        for (let i = 0; i < toCreate.length; i += 200) {
          await tx.insert(customers).values(toCreate.slice(i, i + 200).map((p) => this.insertValues(tenantId, actorId, p.clean!)));
        }
        for (const p of toUpdate) {
          const set = this.updateValues(p.clean!);
          if (Object.keys(set).length > 0) {
            await tx.update(customers).set(set).where(and(eq(customers.id, p.existing.id), eq(customers.tenantId, tenantId)));
          }
        }
      } else {
        for (const p of toCreate) {
          globalMemoryCustomers.push({
            id: randomUUID(),
            ...this.insertValues(tenantId, actorId, p.clean!),
            activeOrdersCount: 0,
            totalReceivable: money(p.clean!.openingBalancePaise),
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any);
        }
        for (const p of toUpdate) Object.assign(p.existing, this.updateValues(p.clean!));
      }
    };

    let usedMemory = false;
    try {
      if (typeof db?.transaction === 'function') {
        await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          await run(tx);
        });
      } else usedMemory = true;
    } catch (err: any) {
      if (err instanceof BadRequestException || err instanceof ConflictException) throw err;
      if (err?.code === '23505') {
        throw new ConflictException({
          statusCode: 409,
          error: 'CustomerExists',
          message: 'Another person added one of these customers while you were importing. Nothing was imported; please try again.',
        });
      }
      onDbError(this.logger, 'importing customers into memory', err);
      usedMemory = true;
    }
    if (usedMemory) {
      // Start the plan over: the failed database attempt may already have marked rows as duplicates.
      for (const p of planned) {
        if (!p.clean) continue;
        p.result.status = 'create';
        p.result.messages = [...(p.warnings ?? [])];
        p.existing = undefined;
      }
      await run(null);
    }

    const rows = planned.map((p) => p.result);
    const count = (s: ImportRowStatus) => rows.filter((r) => r.status === s).length;
    return {
      dryRun: opts.dryRun,
      created: count('create'),
      updated: count('update'),
      skipped: count('skip'),
      errors: count('error'),
      openingBalanceTotal: money(planned.filter((p) => p.result.status === 'create' && p.clean).reduce((s, p) => s + p.clean!.openingBalancePaise, 0)),
      rows,
    };
  }
  /**
   * Updates the details a GST invoice needs about a buyer: GSTIN, billing address, GST state and company name.
   * Only the fields present in `patch` change; null or '' clears one. A GSTIN fixes the state, so the two
   * cannot disagree.
   */
  async updateBillingDetails(
    tenantId: string,
    customerId: string,
    patch: {
      gstin?: string | null;
      billingAddress?: string | null;
      stateCode?: string | null;
      companyName?: string | null;
      remindersOptOut?: boolean;
    }
  ) {
    const text = (v: unknown, max: number, field: string): string | null => {
      const t = v === null ? '' : String(v).trim();
      if (t.length > max) throw new BadRequestException(`${field} must be at most ${max} characters`);
      return t === '' ? null : t;
    };
    const next: {
      gstin?: string | null;
      billingAddress?: string | null;
      stateCode?: string | null;
      companyName?: string | null;
      remindersOptOut?: boolean;
    } = {};
    if (patch.remindersOptOut !== undefined) {
      if (typeof patch.remindersOptOut !== 'boolean') throw new BadRequestException('remindersOptOut must be true or false');
      next.remindersOptOut = patch.remindersOptOut;
    }
    if (patch.companyName !== undefined) next.companyName = text(patch.companyName, 160, 'companyName');
    if (patch.billingAddress !== undefined) next.billingAddress = text(patch.billingAddress, 500, 'billingAddress');
    if (patch.gstin !== undefined) {
      const raw = patch.gstin === null ? '' : String(patch.gstin).trim();
      if (raw !== '' && !isValidGstin(raw)) {
        throw new BadRequestException('gstin is not a valid GSTIN (15 characters, valid state code and check character)');
      }
      next.gstin = raw === '' ? null : normalizeGstin(raw);
      if (next.gstin) next.stateCode = stateCodeFromGstin(next.gstin);
    }
    if (patch.stateCode !== undefined) {
      const raw = patch.stateCode === null ? '' : String(patch.stateCode).trim();
      if (raw !== '' && !isValidStateCode(raw)) throw new BadRequestException('stateCode is not a valid GST state code');
      if (next.gstin && raw !== '' && raw !== next.stateCode) {
        throw new BadRequestException('stateCode does not match the first two digits of the GSTIN');
      }
      if (!next.gstin) next.stateCode = raw === '' ? null : raw;
    }
    if (Object.keys(next).length === 0) {
      throw new BadRequestException('Nothing to update: send gstin, billingAddress, stateCode, companyName and/or remindersOptOut');
    }

    try {
      if (typeof db?.transaction === 'function') {
        const row = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [updated] = await tx
            .update(customers)
            .set(next)
            .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
            .returning();
          return updated;
        });
        if (!row) throw new NotFoundException('Customer not found');
        return {
          id: row.id,
          gstin: row.gstin,
          billingAddress: row.billingAddress,
          stateCode: row.stateCode,
          companyName: row.companyName,
          remindersOptOut: row.remindersOptOut,
        };
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      onDbError(this.logger, 'updating customer billing details in memory', err);
    }
    const mem: any = globalMemoryCustomers.find((c) => c.id === customerId && c.tenantId === tenantId);
    if (!mem) throw new NotFoundException('Customer not found');
    Object.assign(mem, next);
    return {
      id: mem.id,
      gstin: mem.gstin ?? null,
      billingAddress: mem.billingAddress ?? null,
      stateCode: mem.stateCode ?? null,
      companyName: mem.companyName ?? null,
      remindersOptOut: mem.remindersOptOut === true,
    };
  }

  /**
   * The customer's own "STOP" / "START" on WhatsApp. Scoped by the tenant and customer taken from the verified phone
   * lookup, never from message text. Returns what the setting was before, so the caller can tell a change from a repeat.
   */
  async setRemindersOptOutByCustomer(tenantId: string, customerId: string, optedOut: boolean): Promise<{ previous: boolean }> {
    try {
      if (typeof db?.transaction === 'function') {
        const result = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [row] = await tx.select({ id: customers.id, optOut: customers.remindersOptOut }).from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
          if (!row) return null;
          if (row.optOut !== optedOut) {
            await tx.update(customers).set({ remindersOptOut: optedOut }).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
            await tx.insert(activities).values({
              tenantId,
              actorId: null,
              entityType: 'CUSTOMER',
              entityId: customerId,
              action: optedOut ? 'REMINDERS_OPTED_OUT' : 'REMINDERS_OPTED_IN',
              metadata: { source: 'WHATSAPP' },
            });
          }
          return { previous: row.optOut };
        });
        if (!result) throw new NotFoundException('Customer not found');
        return result;
      }
    } catch (err: any) {
      if (err instanceof NotFoundException) {
        // Not in Postgres: a development-only customer may still live in memory
      } else {
        onDbError(this.logger, 'changing the reminder setting in memory', err);
      }
    }
    const mem: any = globalMemoryCustomers.find((c) => c.id === customerId && c.tenantId === tenantId);
    if (!mem) throw new NotFoundException('Customer not found');
    const previous = mem.remindersOptOut === true;
    mem.remindersOptOut = optedOut;
    return { previous };
  }

  /**
   * List all customers for a tenant with computed outstanding balance
   * Enforces Row-Level Security: returns ONLY customers belonging to the tenant.
   */
  async listCustomers(tenantId: string, search?: string, userRole?: TenantRole) {
    const canSeePayments = userRole ? hasPermission(userRole, 'payment:view') : true;
    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          const rows = await tx
            .select({
              id: customers.id,
              name: customers.name,
              companyName: customers.companyName,
              phone: customers.phone,
              gstin: customers.gstin,
              openingBalance: customers.openingBalance,
              activeOrdersCount: sql<number>`(
                SELECT count(*)::int FROM orders o
                WHERE o.customer_id = ${customers.id}
                  AND o.production_stage NOT IN ('DELIVERED', 'INSTALLED')
              )`,
              totalReceivable: sql<string>`(
                COALESCE(${customers.openingBalance}, 0) +
                COALESCE((SELECT SUM(o.balance_due) FROM orders o WHERE o.customer_id = ${customers.id}), 0)
              )::numeric(12,2)::text`,
            })
            .from(customers)
            .where(eq(customers.tenantId, tenantId))
            .orderBy(desc(customers.createdAt));

          const sanitizedRows = rows.map((r) =>
            canSeePayments
              ? r
              : {
                  ...r,
                  openingBalance: null,
                  totalReceivable: null,
                }
          );

          if (!search) return sanitizedRows;
          const q = search.toLowerCase();
          return sanitizedRows.filter(
            (r) =>
              r.name.toLowerCase().includes(q) ||
              r.companyName?.toLowerCase().includes(q) ||
              r.phone.includes(q)
          );
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      onDbError(this.logger, 'utilizing memory fallback for listCustomers', err);
    }

    let tenantCustomers = globalMemoryCustomers
      .filter((c) => c.tenantId === tenantId)
      .map((c) => {
        const custOrders = globalMemoryOrders.filter(
          (o) => o.customerId === c.id && o.tenantId === tenantId
        );
        const activeOrders = custOrders.filter(
          (o) => !['DELIVERED', 'INSTALLED'].includes(o.productionStage)
        );
        const totalPendingOrderBal = custOrders.reduce(
          (sum, o) => sum + parseFloat(o.balanceDue || '0'),
          0
        );
        const totalReceivable = (
          parseFloat(c.openingBalance || '0') + totalPendingOrderBal
        ).toFixed(2);

        return {
          ...c,
          activeOrdersCount: activeOrders.length,
          totalReceivable,
        };
      });

    if (search) {
      const q = search.toLowerCase();
      tenantCustomers = tenantCustomers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.companyName?.toLowerCase().includes(q) ||
          c.phone.includes(q)
      );
    }

    return tenantCustomers.map((c) =>
      canSeePayments
        ? c
        : {
            ...c,
            openingBalance: null,
            totalReceivable: null,
            creditLimit: null,
          }
    );
  }

  /**
   * Customer 360° Detail: Profile + Leads + Quotations + Orders + Ledger + Activity History
   * Enforces Row-Level Security: throws NotFoundException if the customer belongs to another tenant.
   */
  async getCustomer360(tenantId: string, userRole: TenantRole, customerId: string) {
    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          const [customer] = await tx
            .select()
            .from(customers)
            .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
            .limit(1);

          if (!customer) throw new NotFoundException('Customer not found in this tenant organization');

          const customerLeads = await tx
            .select()
            .from(leads)
            .where(and(eq(leads.customerId, customerId), eq(leads.tenantId, tenantId)))
            .orderBy(desc(leads.createdAt));

          const customerQuotes = await tx
            .select()
            .from(quotations)
            .where(and(eq(quotations.customerId, customerId), eq(quotations.tenantId, tenantId)))
            .orderBy(desc(quotations.createdAt));

          const customerOrders = await tx
            .select()
            .from(orders)
            .where(and(eq(orders.customerId, customerId), eq(orders.tenantId, tenantId)))
            .orderBy(desc(orders.createdAt));

          const pendingTasks = await tx
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.customerId, customerId),
                eq(tasks.tenantId, tenantId),
                eq(tasks.status, 'PENDING')
              )
            )
            .orderBy(tasks.dueAt);

          const canViewPayments = hasPermission(userRole, 'payment:view');
          const customerPayments = canViewPayments
            ? await tx
                .select()
                .from(payments)
                .where(and(eq(payments.customerId, customerId), eq(payments.tenantId, tenantId)))
                .orderBy(desc(payments.paidAt))
            : [];

          const relatedConditions: any[] = [
            eq(activities.entityId, customerId),
            sql`${activities.metadata}->>'customerId' = ${customerId}`,
          ];

          const leadIds = customerLeads.map((l) => l.id);
          if (leadIds.length > 0) {
            relatedConditions.push(and(eq(activities.entityType, 'LEAD'), inArray(activities.entityId, leadIds))!);
          }

          const quoteIds = customerQuotes.map((q) => q.id);
          if (quoteIds.length > 0) {
            relatedConditions.push(and(eq(activities.entityType, 'QUOTATION'), inArray(activities.entityId, quoteIds))!);
          }

          const orderIds = customerOrders.map((o) => o.id);
          if (orderIds.length > 0) {
            relatedConditions.push(and(eq(activities.entityType, 'ORDER'), inArray(activities.entityId, orderIds))!);
          }

          const taskIds = pendingTasks.map((t) => t.id);
          if (taskIds.length > 0) {
            relatedConditions.push(and(eq(activities.entityType, 'TASK'), inArray(activities.entityId, taskIds))!);
          }

          const timeline = await tx
            .select()
            .from(activities)
            .where(
              and(
                eq(activities.tenantId, tenantId),
                or(...relatedConditions)!
              )
            )
            .orderBy(desc(activities.createdAt))
            .limit(50);

          const totalOrderValue = customerOrders.reduce(
            (sum, o) => sum + parseFloat(o.totalAmount || '0'),
            0
          );
          const totalOrderBalance = customerOrders.reduce(
            (sum, o) => sum + parseFloat(o.balanceDue || '0'),
            0
          );
          const netReceivable = parseFloat(customer.openingBalance || '0') + totalOrderBalance;

          const maskedCustomer = canViewPayments
            ? customer
            : {
                ...customer,
                openingBalance: null,
                creditLimit: null,
              };

          const maskedQuotes = customerQuotes.map((q) =>
            canViewPayments
              ? q
              : {
                  ...q,
                  subTotal: null,
                  taxTotal: null,
                  discountTotal: null,
                  grandTotal: null,
                }
          );

          const sanitizedTimeline = filterAndSanitizeActivities(timeline, canViewPayments);

          return {
            customer: maskedCustomer,
            financialSummary: canViewPayments
              ? {
                  openingBalance: customer.openingBalance || '0.00',
                  lifetimeOrderValue: totalOrderValue.toFixed(2),
                  totalPendingBalance: netReceivable.toFixed(2),
                  creditLimit: customer.creditLimit || '100000.00',
                }
              : null,
            leads: customerLeads,
            quotations: maskedQuotes,
            orders: customerOrders.map((o) =>
              canViewPayments
                ? o
                : { ...o, totalAmount: null, advanceReceived: null, balanceDue: null }
            ),
            payments: customerPayments,
            pendingTasks,
            timeline: sanitizedTimeline,
          };
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      onDbError(this.logger, 'utilizing memory fallback for getCustomer360', err);
    }

    // Strict Tenant RLS Isolation Check: Customer MUST belong to the requested tenantId!
    const customer = globalMemoryCustomers.find(
      (c) => c.id === customerId && c.tenantId === tenantId
    );
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found in tenant ${tenantId}`);
    }

    const canViewPayments = hasPermission(userRole, 'payment:view');
    const tenantOrders = globalMemoryOrders.filter(
      (o) => o.customerId === customerId && o.tenantId === tenantId
    );

    const totalOrderValue = tenantOrders.reduce(
      (sum, o) => sum + parseFloat(o.totalAmount || '0'),
      0
    );
    const totalOrderBalance = tenantOrders.reduce(
      (sum, o) => sum + parseFloat(o.balanceDue || '0'),
      0
    );
    const netReceivable = parseFloat(customer.openingBalance || '0') + totalOrderBalance;

    const tenantLeads = globalMemoryLeads.filter(
      (l) => l.customerId === customerId && l.tenantId === tenantId
    );

    const tenantQuotes = globalMemoryQuotations.filter(
      (q) => q.customerId === customerId && q.tenantId === tenantId
    );

    const tenantPayments = canViewPayments
      ? globalMemoryPayments.filter(
          (p) => p.customerId === customerId && p.tenantId === tenantId
        )
      : [];

    const tenantTasks = globalMemoryTasks.filter(
      (t) =>
        t.customerId === customerId &&
        t.tenantId === tenantId &&
        t.status === 'PENDING'
    );

    const leadIdSet = new Set(tenantLeads.map((l) => l.id));
    const quoteIdSet = new Set(tenantQuotes.map((q) => q.id));
    const orderIdSet = new Set(tenantOrders.map((o) => o.id));
    const taskIdSet = new Set(tenantTasks.map((t) => t.id));

    const tenantActivities = globalMemoryActivities.filter(
      (a) =>
        a.tenantId === tenantId &&
        (a.entityId === customerId ||
          a.metadata?.customerId === customerId ||
          leadIdSet.has(a.entityId) ||
          quoteIdSet.has(a.entityId) ||
          orderIdSet.has(a.entityId) ||
          taskIdSet.has(a.entityId))
    );

    const maskedCustomer = canViewPayments
      ? customer
      : {
          ...customer,
          openingBalance: null,
          creditLimit: null,
        };

    const maskedQuotes = tenantQuotes.map((q) =>
      canViewPayments
        ? q
        : {
            ...q,
            subTotal: null,
            taxTotal: null,
            discountTotal: null,
            grandTotal: null,
          }
    );

    const baseTimeline = tenantActivities.length > 0 ? tenantActivities : [
      {
        id: `act-${customerId}-1`,
        action: 'CUSTOMER_CREATED',
        createdAt: customer.createdAt || new Date(),
      },
    ];
    const sanitizedTimeline = filterAndSanitizeActivities(baseTimeline, canViewPayments);

    return {
      customer: maskedCustomer,
      financialSummary: canViewPayments
        ? {
            openingBalance: customer.openingBalance || '0.00',
            lifetimeOrderValue: totalOrderValue.toFixed(2),
            totalPendingBalance: netReceivable.toFixed(2),
            creditLimit: customer.creditLimit || '100000.00',
          }
        : null,
      leads: tenantLeads,
      quotations: maskedQuotes,
      orders: tenantOrders.map((o) =>
        canViewPayments
          ? o
          : { ...o, totalAmount: null, advanceReceived: null, balanceDue: null }
      ),
      payments: tenantPayments,
      pendingTasks: tenantTasks,
      timeline: sanitizedTimeline,
    };
  }
}

