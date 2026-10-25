import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db, sql, orders, customers, activities, tenants } from '@friendly-crm/db';
import {
  globalMemoryOrders,
  globalMemoryCustomers,
  globalMemoryActivities,
  globalMemoryTenants,
} from '../crm/memory-store';
import { NotificationOutboxService } from '../notifications/notification-outbox.service';
import { buildReminderMessage } from './reminder-message';

export type AgeBucketKey = '0-30' | '31-60' | '61-90' | '90+';
const BUCKET_KEYS: AgeBucketKey[] = ['0-30', '31-60', '61-90', '90+'];
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
  totalDue: string;
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
    const cust = view.customers[0];
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
      orders: cust.orders.map((o) => ({ orderNumber: o.orderNumber, duePaise: toPaise(o.balanceDue) })),
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

    const rows: DueCustomer[] = [];
    for (const [customerId, list] of byCustomer) {
      const c = custById.get(customerId);
      list.sort((a, b) => b.ageDays - a.ageDays);
      const total = list.reduce((s, o) => s + toPaise(o.balanceDue), 0);
      const log = reminders.get(customerId) ?? [];
      const last = log.reduce<Date | null>((m, r) => (!m || r.at > m ? r.at : m), null);
      const since = oldestPlaced.get(customerId) ?? 0;
      rows.push({
        customerId,
        name: c.name,
        companyName: c.companyName ?? null,
        phone: c.whatsappNumber || c.phone || '',
        totalDue: money(total),
        oldestAgeDays: list[0].ageDays,
        bucket: list[0].bucket,
        orders: list,
        lastReminderAt: last ? last.toISOString() : null,
        autoRemindersSent: log.filter((r) => r.auto && r.at.getTime() >= since).length,
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
          const ids = [...new Set(orderRows.map((o: any) => o.customerId))] as string[];
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
    const custRows = globalMemoryCustomers.filter((c) => c.tenantId === tenantId);
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
