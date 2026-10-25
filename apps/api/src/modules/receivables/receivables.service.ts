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

  constructor(private readonly outbox: NotificationOutboxService) {}

  async list(tenantId: string, now = new Date()): Promise<Receivables> {
    const { orderRows, custRows, reminders } = await this.load(tenantId);
    return this.build(orderRows, custRows, reminders, now);
  }

  async sendReminder(tenantId: string, actorId: string | null, customerId: string, now = new Date()): Promise<ReminderResult> {
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
    });
    return { customerId, sentTo: recipient, totalDue: cust.totalDue, status };
  }

  // ---- internals ----

  private build(orderRows: any[], custRows: any[], reminders: Map<string, Date>, now: Date): Receivables {
    const custById = new Map(custRows.map((c) => [c.id, c]));
    const byCustomer = new Map<string, DueOrder[]>();
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
    }

    const rows: DueCustomer[] = [];
    for (const [customerId, list] of byCustomer) {
      const c = custById.get(customerId);
      list.sort((a, b) => b.ageDays - a.ageDays);
      const total = list.reduce((s, o) => s + toPaise(o.balanceDue), 0);
      const last = reminders.get(customerId);
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
          if (ids.length === 0) return { orderRows, custRows: [] as any[], reminders: new Map<string, Date>() };
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

  private latestReminders(acts: any[]): Map<string, Date> {
    const out = new Map<string, Date>();
    for (const a of acts) {
      const at = new Date(a.createdAt);
      const prev = out.get(a.entityId);
      if (!prev || at > prev) out.set(a.entityId, at);
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
