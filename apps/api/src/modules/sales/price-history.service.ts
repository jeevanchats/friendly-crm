import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, sql, quotations, quotationItems, orders, orderItems } from '@friendly-crm/db';
import type { PriceHistoryEntry } from '@friendly-crm/shared';
import { globalMemoryQuotations, globalMemoryQuotationItems, globalMemoryOrders, globalMemoryOrderItems } from '../crm/memory-store';
import { onDbError } from '../../common/utils/db-fallback.util';

/** A draft was never offered to the customer and a rejected quote was refused by them: neither says what they pay. */
const USABLE_QUOTE_STATUSES = ['SENT', 'APPROVED', 'CONVERTED'];
const MAX_DOCUMENTS = 40;

/**
 * What a customer was charged before: the lines of the quotations sent to them and of their orders, newest first.
 * Used to pre-fill the rate when a new enquiry from the same customer asks for the same item.
 */
@Injectable()
export class PriceHistoryService {
  private readonly logger = new Logger(PriceHistoryService.name);

  async forCustomer(tenantId: string, customerId: string | null | undefined): Promise<PriceHistoryEntry[]> {
    if (!customerId) return [];
    let found: PriceHistoryEntry[] | null = null;
    try {
      if (db && typeof db.transaction === 'function') found = await this.fromDb(tenantId, customerId);
    } catch (err: any) {
      onDbError(this.logger, 'reading earlier prices; using memory', err);
    }
    const entries = found ?? this.fromMemory(tenantId, customerId);
    return entries.sort((a, b) => +new Date(b.on) - +new Date(a.on));
  }

  private entry(item: any, doc: { number: string; on: unknown }): PriceHistoryEntry {
    return {
      productId: item.productId ?? null,
      itemName: String(item.itemName ?? ''),
      description: String(item.description ?? ''),
      unit: String(item.unit ?? ''),
      unitPrice: Number(item.unitPrice),
      hsnCode: String(item.hsnCode ?? ''),
      taxPercent: Number(item.taxPercent ?? 18),
      on: new Date((doc.on as any) ?? 0).toISOString(),
      documentNumber: doc.number,
    };
  }

  private async fromDb(tenantId: string, customerId: string): Promise<PriceHistoryEntry[]> {
    return db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
      const out: PriceHistoryEntry[] = [];

      const quotes = await tx
        .select()
        .from(quotations)
        .where(and(eq(quotations.tenantId, tenantId), eq(quotations.customerId, customerId), inArray(quotations.status, USABLE_QUOTE_STATUSES)))
        .orderBy(desc(quotations.createdAt))
        .limit(MAX_DOCUMENTS);
      if (quotes.length) {
        const items = await tx
          .select()
          .from(quotationItems)
          .where(and(eq(quotationItems.tenantId, tenantId), inArray(quotationItems.quotationId, quotes.map((q: any) => q.id))));
        for (const q of quotes) {
          for (const i of items.filter((x: any) => x.quotationId === q.id)) out.push(this.entry(i, { number: q.quoteNumber, on: q.createdAt }));
        }
      }

      const ords = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, customerId)))
        .orderBy(desc(orders.createdAt))
        .limit(MAX_DOCUMENTS);
      if (ords.length) {
        const items = await tx
          .select()
          .from(orderItems)
          .where(and(eq(orderItems.tenantId, tenantId), inArray(orderItems.orderId, ords.map((o: any) => o.id))));
        for (const o of ords) {
          for (const i of items.filter((x: any) => x.orderId === o.id)) out.push(this.entry(i, { number: o.orderNumber, on: o.createdAt }));
        }
      }
      return out;
    });
  }

  private fromMemory(tenantId: string, customerId: string): PriceHistoryEntry[] {
    const out: PriceHistoryEntry[] = [];
    for (const q of globalMemoryQuotations) {
      if (q.tenantId !== tenantId || q.customerId !== customerId || !USABLE_QUOTE_STATUSES.includes(q.status)) continue;
      for (const i of globalMemoryQuotationItems.filter((x) => x.quotationId === q.id)) out.push(this.entry(i, { number: q.quoteNumber, on: q.createdAt }));
    }
    for (const o of globalMemoryOrders) {
      if (o.tenantId !== tenantId || o.customerId !== customerId) continue;
      for (const i of globalMemoryOrderItems.filter((x) => x.orderId === o.id)) out.push(this.entry(i, { number: o.orderNumber, on: o.createdAt }));
    }
    return out;
  }
}
