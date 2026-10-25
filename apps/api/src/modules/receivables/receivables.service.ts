import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db, sql, orders, customers, activities, tenants, payments } from '@friendly-crm/db';
import {
  globalMemoryOrders,
  globalMemoryCustomers,
  globalMemoryActivities,
  globalMemoryTenants,
  globalMemoryPayments,
} from '../crm/memory-store';
import {
  getNextDbDocumentNumber,
  getNextMemoryDocumentNumber,
  getIdempotentResult,
  setIdempotentResult,
} from '../../common/utils/document-number.util';
import { NotificationOutboxService } from '../notifications/notification-outbox.service';
import { buildReminderMessage } from './reminder-message';

/** Age of an unpaid order since it was placed, or OPENING: money owed from before Friendly CRM (age unknown). */
export type AgeBucketKey = '0-30' | '31-60' | '61-90' | '90+' | 'OPENING';
const BUCKET_KEYS: AgeBucketKey[] = ['0-30', '31-60', '61-90', '90+', 'OPENING'];
const DAY_MS = 86_400_000;
/** One reminder per customer per this long, so a double click or a busy afternoon cannot spam a customer. */
export const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const REMINDER_ACTION = 'PAYMENT_REMINDER_SENT';

export interface DueOrder {
  orderId: string;
  orderNumber: string;
  balanceDue: string;
  ageDays: number;
  bucket: AgeBucketKey;
}

export interface DueCustomer {
  customerId: string;
  name: string;
  companyName: string | null;
  phone: string;
  /** Everything owed: open order balances plus the opening balance. */
  totalDue: string;
  /** Owed from before Friendly CRM; part of totalDue. Cleared by recording payments on account. */
  openingBalance: string;
  oldestAgeDays: number;
  bucket: AgeBucketKey;
  orders: DueOrder[];
  lastReminderAt: string | null;
  /** Automatic reminders sent since the oldest open order was placed (reset by a fresh debt, not by payment). */
  autoRemindersSent: number;
  /** The customer asked not to get automatic reminders. Staff can still send one by hand. */
  remindersOptOut: boolean;
}

export interface ReminderSchedule {
  /** First reminder once the oldest unpaid order is this many days old. */
  afterDays: number;
  /** Then repeat every this many days. */
  repeatDays: number;
  /** At most this many automatic reminders for one outstanding debt. */
  maxCount: number;
}

export interface AutoRunSummary {
  tenants: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** Automatic reminders go out 09:00-19:00 India time only, never in the middle of the night. */
const SEND_WINDOW_START_HOUR = 9;
const SEND_WINDOW_END_HOUR = 19;
const MAX_AUTO_PER_TENANT_PER_RUN = 50;

export const istHour = (d: Date): number =>
  Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(d));

export const inSendWindow = (d: Date): boolean => {
  const h = istHour(d);
  return h >= SEND_WINDOW_START_HOUR && h < SEND_WINDOW_END_HOUR;
};

/**
 * Whether a customer should get an automatic reminder right now. Pure, so the rules can be tested without a
 * database. Every condition must hold: not opted out, has a phone, owes something, the oldest order is old
 * enough, the last reminder (automatic or by hand) was long enough ago, and the cap has not been reached.
 */
export function isDueForAutoReminder(c: DueCustomer, s: ReminderSchedule, now: Date): boolean {
  if (c.remindersOptOut || !c.phone) return false;
  if (toPaise(c.totalDue) === 0) return false;
  if (c.oldestAgeDays < s.afterDays) return false;
  if (c.autoRemindersSent >= s.maxCount) return false;
  if (c.lastReminderAt && now.getTime() - new Date(c.lastReminderAt).getTime() < s.repeatDays * DAY_MS) return false;
  return true;
}

export interface Receivables {
  totalDue: string;
  customerCount: number;
  buckets: Array<{ key: AgeBucketKey; amount: string; orderCount: number }>;
  customers: DueCustomer[];
}

export interface ReminderResult {
  customerId: string;
  sentTo: string;
  totalDue: string;
  /** Delivery state straight after the attempt: SENT, or PENDING/FAILED if the provider did not accept it yet. */
  status: string;
}

/** Every reminder sent to a customer (by hand or automatically), keyed by customer id. */
type ReminderLog = Map<string, Array<{ at: Date; auto: boolean }>>;

const toPaise = (v: unknown) => {
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const money = (paise: number) => (paise / 100).toFixed(2);
const bucketOf = (ageDays: number): AgeBucketKey =>
  ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+';

/**
 * "Who owes me money": open order balances grouped by customer and aged from the order date, plus sending
 * a WhatsApp payment reminder (with the business's UPI link) to one customer at a time.
 */
@Injectable()
export class ReceivablesService {
  private readonly logger = new Logger(ReceivablesService.name);
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly outbox: NotificationOutboxService) {}

  async list(tenantId: string, now = new Date()): Promise<Receivables> {
    const { orderRows, custRows, reminders } = await this.load(tenantId);
    return this.build(orderRows, custRows, reminders, now);
  }

  async sendReminder(
    tenantId: string,
    actorId: string | null,
    customerId: string,
    now = new Date(),
    opts: { auto?: boolean } = {}
  ): Promise<ReminderResult> {
    // One reminder at a time per customer in this process: the second caller re-reads the log the first one
    // wrote, so the 24 hour limit holds even for simultaneous clicks or overlapping passes.
    const key = `${tenantId}:${customerId}`;
    const previous = this.inFlight.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.sendReminderOnce(tenantId, actorId, customerId, now, opts));
    this.inFlight.set(key, run);
    try {
      return await run;
    } finally {
      if (this.inFlight.get(key) === run) this.inFlight.delete(key);
    }
  }

  private async sendReminderOnce(
    tenantId: string,
    actorId: string | null,
    customerId: string,
    now: Date,
    opts: { auto?: boolean }
  ): Promise<ReminderResult> {
    const { orderRows, custRows, reminders } = await this.load(tenantId, customerId);
    const view = this.build(orderRows, custRows, reminders, now);
    const cust = view.customers.find((c) => c.customerId === customerId);
    if (!cust) throw new NotFoundException('This customer has nothing outstanding.');

    if (cust.lastReminderAt && now.getTime() - new Date(cust.lastReminderAt).getTime() < REMINDER_COOLDOWN_MS) {
      throw new ConflictException({
        statusCode: 409,
        error: 'ReminderTooSoon',
        message: 'A reminder was already sent to this customer in the last 24 hours.',
        lastReminderAt: cust.lastReminderAt,
      });
    }
    const raw = custRows.find((c) => c.id === customerId);
    const recipient: string = raw?.whatsappNumber || raw?.phone || '';
    if (!recipient) throw new NotFoundException('This customer has no phone number on file.');

    const tenant = await this.loadTenant(tenantId);
    const lang = tenant.defaultLanguage === 'ta' ? 'ta' : 'en';
    const message = buildReminderMessage({
      lang,
      customerName: cust.name,
      tenantName: tenant.name,
      tenantPhone: tenant.phone,
      upiId: tenant.upiId,
      orders: [
        ...cust.orders.map((o) => ({ orderNumber: o.orderNumber, duePaise: toPaise(o.balanceDue) })),
        ...(toPaise(cust.openingBalance) > 0
          ? [{ orderNumber: lang === 'ta' ? 'முந்தைய நிலுவை' : 'Previous balance', duePaise: toPaise(cust.openingBalance) }]
          : []),
      ],
    });

    const job: any = await this.outbox.enqueueNotification({ tenantId, recipient, rawMessage: message, lang });
    // Dispatch this one job now so the person who clicked sees whether it went out; failures stay queued for retry.
    let status: string = job?.status ?? 'PENDING';
    try {
      if (job?.id) status = (await this.outbox.dispatchJob(job.id, tenantId))?.status ?? status;
    } catch (err: any) {
      this.logger.warn(`Reminder dispatch failed for ${customerId}: ${err.message}`);
    }

    await this.logReminder(tenantId, actorId, customerId, {
      totalDue: cust.totalDue,
      orderNumbers: cust.orders.map((o) => o.orderNumber),
      deliveryStatus: status,
      outboxId: job?.id ?? null,
      auto: opts.auto === true,
    });
    return { customerId, sentTo: recipient, totalDue: cust.totalDue, status };
  }

  // ---- payments on account (opening balances) ----

  /**
   * Records money received against a customer's OPENING balance (what they owed before Friendly CRM), which no
   * order carries. It lowers the opening balance, writes a receipt, and WhatsApps the customer the receipt.
   * Payments against an order's own balance go through the order instead.
   */
  async recordOpeningPayment(
    tenantId: string,
    actorId: string,
    customerId: string,
    dto: { amount?: unknown; mode?: unknown; referenceNo?: unknown; notes?: unknown },
    idempotencyKey?: string
  ) {
    const rupees = Number(dto.amount);
    const paise = Math.round(rupees * 100);
    if (!Number.isFinite(rupees) || paise <= 0 || paise > 99_999_999_999) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }
    if (Math.abs(rupees * 100 - paise) > 1e-6) throw new BadRequestException('Payment amount can have at most two decimal places');
    const mode = String(dto.mode ?? 'UPI').toUpperCase();
    if (!['UPI', 'CASH', 'BANK_TRANSFER', 'CHEQUE'].includes(mode)) {
      throw new BadRequestException('Payment mode must be UPI, CASH, BANK_TRANSFER or CHEQUE');
    }
    const reference = typeof dto.referenceNo === 'string' && dto.referenceNo.trim() ? dto.referenceNo.trim().slice(0, 100) : null;
    const notes = typeof dto.notes === 'string' && dto.notes.trim() ? dto.notes.trim().slice(0, 500) : 'Payment against opening balance';

    if (idempotencyKey) {
      const cached = getIdempotentResult(tenantId, 'record-opening-payment', idempotencyKey);
      if (cached) return { ...cached, isIdempotent: true };
    }

    const tooMuch = (balance: number) =>
      new BadRequestException(`Payment (₹${money(paise)}) is more than the opening balance still owed (₹${money(balance)})`);
    let result: { receiptNumber: string; amount: string; openingBalanceRemaining: string; totalRemaining: string; customerName: string; phone: string };

    const done = async () => {
      if (idempotencyKey) setIdempotentResult(tenantId, 'record-opening-payment', idempotencyKey, result);
      if (result.phone) {
        this.outbox
          .enqueueNotification({
            tenantId,
            recipient: result.phone,
            templateKey: 'PAYMENT_RECEIPT',
            params: {
              customerName: result.customerName,
              amount: result.amount,
              mode,
              receiptNumber: result.receiptNumber,
              balanceRemaining: result.totalRemaining,
            },
          })
          .catch((e: any) => this.logger.warn(`Receipt enqueue failed: ${e.message}`));
      }
      return result;
    };

    try {
      if (db && typeof db.transaction === 'function') {
        await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          if (reference) {
            const [dup] = await tx
              .select({ id: payments.id })
              .from(payments)
              .where(and(eq(payments.tenantId, tenantId), eq(payments.customerId, customerId), eq(payments.referenceNo, reference)))
              .limit(1);
            if (dup) throw new BadRequestException(`A payment with reference '${reference}' has already been recorded for this customer`);
          }
          // One atomic statement: it only subtracts if enough is still owed, so two staff cannot overdraw it.
          const [cust] = await tx
            .update(customers)
            .set({ openingBalance: sql`${customers.openingBalance} - ${money(paise)}::numeric`, updatedAt: new Date() })
            .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId), sql`${customers.openingBalance} >= ${money(paise)}::numeric`))
            .returning();
          if (!cust) {
            const [exists] = await tx
              .select()
              .from(customers)
              .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
              .limit(1);
            if (!exists) throw new NotFoundException('Customer not found');
            throw tooMuch(toPaise(exists.openingBalance));
          }
          const receiptNumber = await getNextDbDocumentNumber(tx, payments, payments.receiptNumber, 'RCP', tenantId);
          await tx.insert(payments).values({
            tenantId,
            receiptNumber,
            customerId,
            orderId: null,
            amount: money(paise),
            mode,
            referenceNo: reference,
            receivedById: actorId,
            notes,
            paidAt: new Date(),
          });
          await tx.insert(activities).values({
            tenantId,
            actorId,
            entityType: 'CUSTOMER',
            entityId: customerId,
            action: 'OPENING_BALANCE_PAYMENT',
            metadata: { receiptNumber, amount: money(paise), mode, openingBalanceRemaining: String(cust.openingBalance) },
          });
          const open = await tx
            .select({ balance: orders.balanceDue })
            .from(orders)
            .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, customerId), gt(orders.balanceDue, '0')));
          const orderBalance = open.reduce((s: number, o: any) => s + toPaise(o.balance), 0);
          result = {
            receiptNumber,
            amount: money(paise),
            openingBalanceRemaining: money(toPaise(cust.openingBalance)),
            totalRemaining: money(toPaise(cust.openingBalance) + orderBalance),
            customerName: cust.name,
            phone: cust.whatsappNumber || cust.phone || '',
          };
        });
        return await done();
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Postgres offline; recording the payment in memory: ${err.message}`);
    }

    const cust: any = globalMemoryCustomers.find((c) => c.id === customerId && c.tenantId === tenantId);
    if (!cust) throw new NotFoundException('Customer not found');
    const owed = toPaise(cust.openingBalance);
    if (paise > owed) throw tooMuch(owed);
    if (reference && globalMemoryPayments.some((p) => p.tenantId === tenantId && p.customerId === customerId && p.referenceNo === reference)) {
      throw new BadRequestException(`A payment with reference '${reference}' has already been recorded for this customer`);
    }
    const receiptNumber = getNextMemoryDocumentNumber(globalMemoryPayments, 'receiptNumber', 'RCP', tenantId);
    cust.openingBalance = money(owed - paise);
    globalMemoryPayments.unshift({
      id: randomUUID(),
      tenantId,
      receiptNumber,
      customerId,
      orderId: null,
      amount: money(paise),
      mode,
      referenceNo: reference,
      receivedById: actorId,
      paidAt: new Date(),
      notes,
    });
    globalMemoryActivities.unshift({
      id: randomUUID(),
      tenantId,
      actorId,
      entityType: 'CUSTOMER',
      entityId: customerId,
      action: 'OPENING_BALANCE_PAYMENT',
      metadata: { receiptNumber, amount: money(paise), mode, openingBalanceRemaining: cust.openingBalance },
      createdAt: new Date(),
    } as any);
    const orderBalance = globalMemoryOrders
      .filter((o: any) => o.tenantId === tenantId && o.customerId === customerId && o.productionStage !== 'CANCELLED')
      .reduce((s: number, o: any) => s + toPaise(o.balanceDue), 0);
    result = {
      receiptNumber,
      amount: money(paise),
      openingBalanceRemaining: cust.openingBalance,
      totalRemaining: money(toPaise(cust.openingBalance) + orderBalance),
      customerName: cust.name,
      phone: cust.whatsappNumber || cust.phone || '',
    };
    return await done();
  }
  // ---- automatic reminders ----

  /**
   * One pass of the automatic reminder scheduler over every business that has turned it on. Safe to call often
   * and from several API instances: each business is processed under a database advisory lock, and every
   * customer is re-checked (last reminder, cap) before sending, so nobody is reminded twice.
   * Nothing is sent outside 09:00-19:00 India time.
   */
  async runAutoReminders(now = new Date()): Promise<AutoRunSummary> {
    const summary: AutoRunSummary = { tenants: 0, sent: 0, skipped: 0, failed: 0 };
    if (!inSendWindow(now)) return summary;

    for (const t of await this.tenantsWithAutoReminders()) {
      summary.tenants++;
      try {
        await this.withTenantLock(t.id, async () => {
          const schedule: ReminderSchedule = { afterDays: t.afterDays, repeatDays: t.repeatDays, maxCount: t.maxCount };
          const view = await this.list(t.id, now);
          let sentHere = 0;
          for (const c of view.customers) {
            if (!isDueForAutoReminder(c, schedule, now)) {
              summary.skipped++;
              continue;
            }
            if (sentHere >= MAX_AUTO_PER_TENANT_PER_RUN) break;
            try {
              await this.sendReminder(t.id, null, c.customerId, now, { auto: true });
              summary.sent++;
              sentHere++;
            } catch (err: any) {
              if (err instanceof ConflictException) {
                summary.skipped++; // reminded a moment ago by another pass or by hand
              } else {
                summary.failed++;
                this.logger.warn(`Auto reminder for ${c.customerId} failed: ${err.message}`);
              }
            }
          }
        });
      } catch (err: any) {
        summary.failed++;
        this.logger.error(`Auto reminders failed for business ${t.id}: ${err.message}`);
      }
    }
    return summary;
  }

  private async tenantsWithAutoReminders(): Promise<Array<{ id: string; afterDays: number; repeatDays: number; maxCount: number }>> {
    try {
      if (db && typeof db.select === 'function') {
        const rows = await db
          .select({
            id: tenants.id,
            afterDays: tenants.reminderAfterDays,
            repeatDays: tenants.reminderRepeatDays,
            maxCount: tenants.reminderMaxCount,
          })
          .from(tenants)
          .where(and(eq(tenants.autoRemindersEnabled, true), eq(tenants.isActive, true)));
        return rows;
      }
    } catch {
      // Postgres offline: memory fallback below
    }
    return [...globalMemoryTenants.values()]
      .filter((t: any) => t.autoRemindersEnabled === true && t.isActive !== false)
      .map((t: any) => ({
        id: t.id,
        afterDays: t.reminderAfterDays ?? 7,
        repeatDays: t.reminderRepeatDays ?? 7,
        maxCount: t.reminderMaxCount ?? 3,
      }));
  }

  /**
   * Runs `fn` only if no other API instance is already working on this business. The lock lives for the
   * length of a database transaction and is released automatically if this process dies. Without a database
   * (local development) there is only one process, so it just runs.
   */
  private async withTenantLock(tenantId: string, fn: () => Promise<void>): Promise<void> {
    let started = false;
    if (db && typeof db.transaction === 'function') {
      try {
        await db.transaction(async (tx: any) => {
          const rows: any = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${'auto-remind:' + tenantId})) as locked`);
          const first = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
          if (!first?.locked) return; // another instance has this business right now
          started = true;
          await fn();
        });
        return;
      } catch (err: any) {
        if (started) throw err; // the work itself failed: never run it a second time
        this.logger.warn(`Postgres offline; running auto reminders without a lock: ${err.message}`);
      }
    }
    await fn();
  }

  // ---- internals ----

  private build(orderRows: any[], custRows: any[], reminders: ReminderLog, now: Date): Receivables {
    const custById = new Map(custRows.map((c) => [c.id, c]));
    const byCustomer = new Map<string, DueOrder[]>();
    const oldestPlaced = new Map<string, number>();
    const bucketTotals = new Map<AgeBucketKey, { paise: number; count: number }>(
      BUCKET_KEYS.map((k) => [k, { paise: 0, count: 0 }])
    );

    for (const o of orderRows) {
      const paise = toPaise(o.balanceDue);
      if (paise === 0 || o.productionStage === 'CANCELLED' || !custById.has(o.customerId)) continue;
      const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(o.createdAt).getTime()) / DAY_MS));
      const bucket = bucketOf(ageDays);
      const b = bucketTotals.get(bucket)!;
      b.paise += paise;
      b.count += 1;
      const list = byCustomer.get(o.customerId) ?? [];
      list.push({ orderId: o.id, orderNumber: o.orderNumber, balanceDue: money(paise), ageDays, bucket });
      byCustomer.set(o.customerId, list);
      const placed = new Date(o.createdAt).getTime();
      if (!oldestPlaced.has(o.customerId) || placed < oldestPlaced.get(o.customerId)!) oldestPlaced.set(o.customerId, placed);
    }

    // Customers owe money either through open orders or through an opening balance (or both)
    const dueIds = new Set<string>(byCustomer.keys());
    for (const c of custRows) if (toPaise(c.openingBalance) > 0) dueIds.add(c.id);
    const openingTotals = bucketTotals.get('OPENING')!;

    const rows: DueCustomer[] = [];
    for (const customerId of dueIds) {
      const c = custById.get(customerId);
      if (!c) continue;
      const list = byCustomer.get(customerId) ?? [];
      list.sort((a, b) => b.ageDays - a.ageDays);
      const opening = toPaise(c.openingBalance);
      if (opening > 0) {
        openingTotals.paise += opening;
        openingTotals.count += 1;
      }
      const total = list.reduce((s, o) => s + toPaise(o.balanceDue), 0) + opening;
      const log = reminders.get(customerId) ?? [];
      const last = log.reduce<Date | null>((m, r) => (!m || r.at > m ? r.at : m), null);
      // An opening balance has no order date; it counts from the day the customer joined Friendly CRM, so
      // automatic reminders for imported balances start after the usual grace period, not on import day.
      const joined = new Date(c.createdAt ?? now).getTime();
      const since = Math.min(oldestPlaced.get(customerId) ?? Infinity, opening > 0 ? joined : Infinity);
      const openingAge = opening > 0 ? Math.max(0, Math.floor((now.getTime() - joined) / DAY_MS)) : 0;
      rows.push({
        customerId,
        name: c.name,
        companyName: c.companyName ?? null,
        phone: c.whatsappNumber || c.phone || '',
        totalDue: money(total),
        openingBalance: money(opening),
        oldestAgeDays: Math.max(list[0]?.ageDays ?? 0, openingAge),
        bucket: list.length > 0 ? list[0].bucket : 'OPENING',
        orders: list,
        lastReminderAt: last ? last.toISOString() : null,
        autoRemindersSent: log.filter((r) => r.auto && r.at.getTime() >= (Number.isFinite(since) ? since : 0)).length,
        remindersOptOut: c.remindersOptOut === true,
      });
    }
    rows.sort((a, b) => toPaise(b.totalDue) - toPaise(a.totalDue));

    const totalPaise = [...bucketTotals.values()].reduce((s, b) => s + b.paise, 0);
    return {
      totalDue: money(totalPaise),
      customerCount: rows.length,
      buckets: BUCKET_KEYS.map((key) => ({
        key,
        amount: money(bucketTotals.get(key)!.paise),
        orderCount: bucketTotals.get(key)!.count,
      })),
      customers: rows,
    };
  }

  /** Orders with a balance, their customers, and the latest reminder time per customer. Optionally one customer. */
  private async load(tenantId: string, onlyCustomerId?: string) {
    try {
      if (db && typeof db.transaction === 'function') {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const orderRows = await tx
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.tenantId, tenantId),
                gt(orders.balanceDue, '0'),
                ...(onlyCustomerId ? [eq(orders.customerId, onlyCustomerId)] : [])
              )
            );
          const openingRows = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(
              and(
                eq(customers.tenantId, tenantId),
                gt(customers.openingBalance, '0'),
                ...(onlyCustomerId ? [eq(customers.id, onlyCustomerId)] : [])
              )
            );
          const ids = [...new Set([...orderRows.map((o: any) => o.customerId), ...openingRows.map((c: any) => c.id)])] as string[];
          if (ids.length === 0) return { orderRows, custRows: [] as any[], reminders: new Map() as ReminderLog };
          const custRows = await tx
            .select()
            .from(customers)
            .where(and(eq(customers.tenantId, tenantId), inArray(customers.id, ids)));
          const acts = await tx
            .select()
            .from(activities)
            .where(
              and(
                eq(activities.tenantId, tenantId),
                eq(activities.entityType, 'CUSTOMER'),
                eq(activities.action, REMINDER_ACTION),
                inArray(activities.entityId, ids)
              )
            )
            .orderBy(desc(activities.createdAt));
          return { orderRows, custRows, reminders: this.latestReminders(acts) };
        });
      }
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for receivables: ${err.message}`);
    }

    const orderRows = globalMemoryOrders.filter(
      (o: any) => o.tenantId === tenantId && (!onlyCustomerId || o.customerId === onlyCustomerId)
    );
    const custRows = globalMemoryCustomers.filter((c) => c.tenantId === tenantId && (!onlyCustomerId || c.id === onlyCustomerId));
    const acts = globalMemoryActivities.filter(
      (a: any) => a.tenantId === tenantId && a.entityType === 'CUSTOMER' && a.action === REMINDER_ACTION
    );
    return { orderRows, custRows, reminders: this.latestReminders(acts) };
  }

  private latestReminders(acts: any[]): ReminderLog {
    const out: ReminderLog = new Map();
    for (const a of acts) {
      const list = out.get(a.entityId) ?? [];
      list.push({ at: new Date(a.createdAt), auto: a.metadata?.auto === true });
      out.set(a.entityId, list);
    }
    return out;
  }

  private async loadTenant(tenantId: string): Promise<{ name: string; phone: string | null; upiId: string | null; defaultLanguage: string }> {
    try {
      if (db && typeof db.select === 'function') {
        const [row] = await db
          .select({ name: tenants.name, phone: tenants.phone, upiId: tenants.upiId, defaultLanguage: tenants.defaultLanguage })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        if (row) return row;
      }
    } catch {
      // Postgres offline: memory fallback below
    }
    const mem = globalMemoryTenants.get(tenantId) as any;
    if (!mem) throw new NotFoundException(`Tenant ${tenantId} not found`);
    return { name: mem.name, phone: mem.phone ?? null, upiId: mem.upiId ?? null, defaultLanguage: mem.defaultLanguage ?? 'en' };
  }

  private async logReminder(tenantId: string, actorId: string | null, customerId: string, metadata: Record<string, unknown>) {
    const row = { tenantId, actorId, entityType: 'CUSTOMER', entityId: customerId, action: REMINDER_ACTION, metadata };
    try {
      if (db && typeof db.transaction === 'function') {
        await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          await tx.insert(activities).values(row);
        });
        return;
      }
    } catch (err: any) {
      this.logger.warn(`Postgres offline; recording reminder in memory: ${err.message}`);
    }
    globalMemoryActivities.unshift({ id: randomUUID(), ...row, createdAt: new Date() } as any);
  }
}
