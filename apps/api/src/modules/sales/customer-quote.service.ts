import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, sql, quotations, quotationItems, orders, activities, auditLogs, customers } from '@friendly-crm/db';
import {
  globalMemoryQuotations,
  globalMemoryQuotationItems,
  globalMemoryOrders,
  globalMemoryActivities,
  globalMemoryAuditLogs,
  globalMemoryCustomers,
} from '../crm/memory-store';
import { SalesService } from './sales.service';
import { QuoteLinkService } from './quote-link.service';
import { onDbError } from '../../common/utils/db-fallback.util';

/** What a customer may see about a quote waiting for their decision. */
export interface CustomerQuoteView {
  id: string;
  quoteNumber: string;
  version: number;
  grandTotal: string;
  validUntil: string | null;
  /** Signed public link to the quotation PDF, when the server can make one. */
  pdfUrl: string | null;
  items: Array<{ itemName: string; quantity: string; unit: string }>;
}

export interface QuoteDecisionContext {
  /** Sender's WhatsApp number and the inbound message id, recorded in the audit trail. */
  phone: string;
  messageId: string;
}

export type QuoteApproveResult =
  | { ok: true; orderNumber: string; alreadyApproved: boolean }
  | { ok: false; reason: 'NOT_AVAILABLE' | 'EXPIRED' | 'CHANGED' };

/** Back-office view of customer activity on WhatsApp that staff need to act on. */
export interface QuoteInbox {
  changeRequests: Array<{
    quotationId: string;
    quoteNumber: string;
    version: number;
    customerName: string;
    customerPhone: string;
    request: string;
    requestedAt: string;
    grandTotal: string | null;
  }>;
  awaitingPayment: Array<{
    orderId: string;
    orderNumber: string;
    customerName: string;
    customerPhone: string;
    totalAmount: string | null;
    balanceDue: string | null;
    approvedAt: string;
  }>;
}

const toPaise = (v: unknown) => Math.round(Number(v) * 100);

/**
 * Lets a CUSTOMER (identified and verified by the WhatsApp bot, not a staff user) approve or comment on a
 * quote sent to them. Every call is scoped by tenantId AND customerId taken from the verified phone lookup,
 * never from message text. Approval creates the order through SalesService.convertQuoteToOrder, so order
 * numbering, receivables, the lead -> WON update and the ORDER_CONFIRMED notification stay in one place.
 */
@Injectable()
export class CustomerQuoteService {
  private readonly logger = new Logger(CustomerQuoteService.name);
  /** Serialises approvals per quote inside this process so a double tap cannot create two orders. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly sales: SalesService,
    private readonly links: QuoteLinkService
  ) {}

  /** Quotes sent to this customer that are still open: latest version, not converted/rejected, not expired. */
  async listForCustomer(tenantId: string, customerId: string, limit = 5): Promise<CustomerQuoteView[]> {
    const now = Date.now();
    const open = (q: any) => q.status === 'SENT' && (!q.validUntil || new Date(q.validUntil).getTime() > now);
    const view = (q: any, items: any[]): CustomerQuoteView => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      version: q.version ?? 1,
      grandTotal: String(q.grandTotal),
      validUntil: q.validUntil ? new Date(q.validUntil).toISOString() : null,
      pdfUrl: this.links.buildUrl(tenantId, q.id),
      items: items.map((i) => ({ itemName: i.itemName, quantity: String(i.quantity), unit: i.unit })),
    });

    try {
      if (db && typeof db.transaction === 'function') {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const rows = (
            await tx
              .select()
              .from(quotations)
              .where(
                and(eq(quotations.tenantId, tenantId), eq(quotations.customerId, customerId), eq(quotations.status, 'SENT'))
              )
              .orderBy(desc(quotations.createdAt))
              .limit(limit * 2)
          )
            .filter(open)
            .slice(0, limit);
          if (rows.length === 0) return [];
          const items = await tx
            .select()
            .from(quotationItems)
            .where(
              and(
                eq(quotationItems.tenantId, tenantId),
                inArray(
                  quotationItems.quotationId,
                  rows.map((r: any) => r.id)
                )
              )
            );
          return rows.map((q: any) =>
            view(
              q,
              items.filter((i: any) => i.quotationId === q.id)
            )
          );
        });
      }
    } catch (err: any) {
      onDbError(this.logger, 'utilizing memory fallback for listForCustomer', err);
    }

    return globalMemoryQuotations
      .filter((q) => q.tenantId === tenantId && q.customerId === customerId && open(q))
      .sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0))
      .slice(0, limit)
      .map((q) =>
        view(
          q,
          globalMemoryQuotationItems.filter((i) => i.quotationId === q.id && i.tenantId === tenantId)
        )
      );
  }

  /**
   * Approves the quote the customer was shown. `expectedTotal` is that quote's grand total at display time:
   * if it no longer matches, nothing is approved (the customer must review the current quote).
   */
  async approve(
    tenantId: string,
    customerId: string,
    industryKey: string,
    quotationId: string,
    expectedTotal: string,
    ctx: QuoteDecisionContext
  ): Promise<QuoteApproveResult> {
    const key = `${tenantId}:${quotationId}`;
    const previous = this.inFlight.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.approveOnce(tenantId, customerId, industryKey, quotationId, expectedTotal, ctx));
    this.inFlight.set(key, run);
    try {
      return await run;
    } finally {
      if (this.inFlight.get(key) === run) this.inFlight.delete(key);
    }
  }

  private async approveOnce(
    tenantId: string,
    customerId: string,
    industryKey: string,
    quotationId: string,
    expectedTotal: string,
    ctx: QuoteDecisionContext
  ): Promise<QuoteApproveResult> {
    const quote = await this.loadQuote(tenantId, quotationId);
    if (!quote || quote.customerId !== customerId) return { ok: false, reason: 'NOT_AVAILABLE' };

    if (quote.status === 'CONVERTED') {
      // A repeat tap on an already-approved quote: report the existing order, create nothing.
      const orderNumber = await this.findOrderNumber(tenantId, quotationId);
      return orderNumber ? { ok: true, orderNumber, alreadyApproved: true } : { ok: false, reason: 'NOT_AVAILABLE' };
    }
    if (quote.status !== 'SENT') return { ok: false, reason: 'NOT_AVAILABLE' };
    if (quote.validUntil && new Date(quote.validUntil).getTime() <= Date.now()) return { ok: false, reason: 'EXPIRED' };
    if (toPaise(quote.grandTotal) !== toPaise(expectedTotal)) return { ok: false, reason: 'CHANGED' };

    const result: any = await this.sales.convertQuoteToOrder(
      tenantId,
      '', // no staff user: the customer is the approver, recorded in the audit entry below
      industryKey,
      quotationId,
      0,
      undefined,
      `wa-approve:${quotationId}`
    );

    await this.writeAudit(tenantId, 'QUOTE_APPROVED_BY_CUSTOMER', quotationId, {
      before: { status: 'SENT' },
      after: { status: 'CONVERTED' },
      metadata: {
        channel: 'WHATSAPP',
        customerId,
        phone: ctx.phone,
        messageId: ctx.messageId,
        quoteNumber: quote.quoteNumber,
        version: quote.version ?? 1,
        grandTotal: String(quote.grandTotal),
        orderNumber: result.orderNumber,
      },
    });
    return { ok: true, orderNumber: result.orderNumber, alreadyApproved: false };
  }

  /**
   * Open customer change requests (quote still SENT, so not yet revised or approved) and orders created by
   * customer approval that have received no payment yet. Amounts are null unless `showAmounts`.
   */
  async inbox(tenantId: string, showAmounts: boolean): Promise<QuoteInbox> {
    const money = (v: unknown) => (showAmounts ? String(v) : null);
    const build = (
      acts: any[],
      quoteById: Map<string, any>,
      custById: Map<string, any>,
      ords: any[]
    ): QuoteInbox => {
      const seen = new Set<string>();
      const changeRequests: QuoteInbox['changeRequests'] = [];
      for (const a of acts) {
        const q = quoteById.get(a.entityId);
        if (!q || q.status !== 'SENT' || seen.has(q.id)) continue;
        seen.add(q.id); // acts are newest first: keep the latest request per quote
        const c = custById.get(q.customerId);
        changeRequests.push({
          quotationId: q.id,
          quoteNumber: q.quoteNumber,
          version: q.version ?? 1,
          customerName: c?.name ?? 'Customer',
          customerPhone: c?.whatsappNumber || c?.phone || '',
          request: String(a.metadata?.request ?? ''),
          requestedAt: new Date(a.createdAt).toISOString(),
          grandTotal: money(q.grandTotal),
        });
      }
      const awaitingPayment = ords
        .filter((o) => Number(o.advanceReceived) === 0 && Number(o.balanceDue) > 0)
        .map((o) => {
          const c = custById.get(o.customerId);
          return {
            orderId: o.id,
            orderNumber: o.orderNumber,
            customerName: c?.name ?? 'Customer',
            customerPhone: c?.whatsappNumber || c?.phone || '',
            totalAmount: money(o.totalAmount),
            balanceDue: money(o.balanceDue),
            approvedAt: new Date(o.createdAt).toISOString(),
          };
        });
      return { changeRequests, awaitingPayment };
    };

    try {
      if (db && typeof db.transaction === 'function') {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const acts = await tx
            .select()
            .from(activities)
            .where(
              and(
                eq(activities.tenantId, tenantId),
                eq(activities.entityType, 'QUOTATION'),
                eq(activities.action, 'QUOTE_CHANGE_REQUESTED')
              )
            )
            .orderBy(desc(activities.createdAt))
            .limit(200);
          const qids = [...new Set(acts.map((a: any) => a.entityId))] as string[];
          const quoteRows = qids.length
            ? await tx
                .select()
                .from(quotations)
                .where(and(eq(quotations.tenantId, tenantId), inArray(quotations.id, qids)))
            : [];
          const approvedQids = (
            await tx
              .select({ entityId: auditLogs.entityId })
              .from(auditLogs)
              .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'QUOTE_APPROVED_BY_CUSTOMER')))
              .orderBy(desc(auditLogs.createdAt))
              .limit(200)
          ).map((r: any) => r.entityId) as string[];
          const orderRows = approvedQids.length
            ? await tx
                .select()
                .from(orders)
                .where(and(eq(orders.tenantId, tenantId), inArray(orders.quotationId, approvedQids)))
                .orderBy(desc(orders.createdAt))
            : [];
          const custIds = [
            ...new Set([...quoteRows.map((q: any) => q.customerId), ...orderRows.map((o: any) => o.customerId)]),
          ] as string[];
          const custRows = custIds.length
            ? await tx
                .select()
                .from(customers)
                .where(and(eq(customers.tenantId, tenantId), inArray(customers.id, custIds)))
            : [];
          return build(
            acts,
            new Map(quoteRows.map((q: any) => [q.id, q])),
            new Map(custRows.map((c: any) => [c.id, c])),
            orderRows
          );
        });
      }
    } catch (err: any) {
      onDbError(this.logger, 'utilizing memory fallback for inbox', err);
    }

    const acts = globalMemoryActivities
      .filter((a: any) => a.tenantId === tenantId && a.action === 'QUOTE_CHANGE_REQUESTED')
      .sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt));
    const approved = new Set(
      globalMemoryAuditLogs
        .filter((l: any) => l.tenantId === tenantId && l.action === 'QUOTE_APPROVED_BY_CUSTOMER')
        .map((l: any) => l.entityId)
    );
    return build(
      acts,
      new Map(globalMemoryQuotations.filter((q) => q.tenantId === tenantId).map((q) => [q.id, q])),
      new Map(globalMemoryCustomers.filter((c) => c.tenantId === tenantId).map((c) => [c.id, c])),
      globalMemoryOrders
        .filter((o) => o.tenantId === tenantId && o.quotationId && approved.has(o.quotationId))
        .sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0))
    );
  }

  /** Records what the customer wants changed, on the quote's activity timeline for staff to see. */
  async requestChange(
    tenantId: string,
    customerId: string,
    quotationId: string,
    text: string,
    ctx: QuoteDecisionContext
  ): Promise<boolean> {
    const quote = await this.loadQuote(tenantId, quotationId);
    if (!quote || quote.customerId !== customerId || quote.status !== 'SENT') return false;

    const row = {
      tenantId,
      actorId: null,
      entityType: 'QUOTATION',
      entityId: quotationId,
      action: 'QUOTE_CHANGE_REQUESTED',
      metadata: {
        channel: 'WHATSAPP',
        customerId,
        phone: ctx.phone,
        messageId: ctx.messageId,
        quoteNumber: quote.quoteNumber,
        version: quote.version ?? 1,
        request: text.slice(0, 500),
      },
    };
    try {
      if (db && typeof db.transaction === 'function') {
        await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          await tx.insert(activities).values(row);
        });
        return true;
      }
    } catch (err: any) {
      onDbError(this.logger, 'recording quote change request in memory', err);
    }
    globalMemoryActivities.unshift({ id: randomUUID(), ...row, createdAt: new Date() });
    return true;
  }

  private async loadQuote(tenantId: string, quotationId: string): Promise<any | undefined> {
    try {
      if (db && typeof db.transaction === 'function') {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [q] = await tx
            .select()
            .from(quotations)
            .where(and(eq(quotations.id, quotationId), eq(quotations.tenantId, tenantId)))
            .limit(1);
          return q;
        });
      }
    } catch (err: any) {
      onDbError(this.logger, 'utilizing memory fallback for loadQuote', err);
    }
    return globalMemoryQuotations.find((q) => q.id === quotationId && q.tenantId === tenantId);
  }

  private async findOrderNumber(tenantId: string, quotationId: string): Promise<string | undefined> {
    try {
      if (db && typeof db.transaction === 'function') {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [o] = await tx
            .select({ orderNumber: orders.orderNumber })
            .from(orders)
            .where(and(eq(orders.quotationId, quotationId), eq(orders.tenantId, tenantId)))
            .limit(1);
          return o?.orderNumber;
        });
      }
    } catch (err: any) {
      onDbError(this.logger, 'utilizing memory fallback for findOrderNumber', err);
    }
    return globalMemoryOrders.find((o) => o.quotationId === quotationId && o.tenantId === tenantId)?.orderNumber;
  }

  private async writeAudit(tenantId: string, action: string, entityId: string, changes: Record<string, unknown>) {
    const audit = {
      id: randomUUID(),
      tenantId,
      actorId: null,
      action,
      entityType: 'QUOTATION',
      entityId,
      changes,
      ipAddress: null,
      userAgent: 'whatsapp-bot',
      createdAt: new Date(),
    };
    try {
      if (db && typeof db.transaction === 'function') {
        await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          await tx.insert(auditLogs).values(audit);
        });
        return;
      }
    } catch (err: any) {
      // The order already exists at this point; a lost audit row must be loud, not silent.
      this.logger.error(`AUDIT WRITE FAILED for ${action} on ${entityId}: ${err.message}`);
      globalMemoryAuditLogs.unshift(audit as any);
      return;
    }
    globalMemoryAuditLogs.unshift(audit as any);
  }
}
