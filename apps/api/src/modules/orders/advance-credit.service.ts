import { BadRequestException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql, eq, and } from 'drizzle-orm';
import { db, orders, customers, payments, activities } from '@friendly-crm/db';
import { globalMemoryActivities, globalMemoryCustomers, globalMemoryOrders, globalMemoryPayments } from '../crm/memory-store';
import { onDbError } from '../../common/utils/db-fallback.util';
import {
  getIdempotentResult,
  getNextDbDocumentNumber,
  getNextMemoryDocumentNumber,
  roundMoney,
  setIdempotentResult,
} from '../../common/utils/document-number.util';

const toPaise = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** Payment mode used for the receipt of an advance being used up against an order. */
export const ADVANCE_MODE = 'ADVANCE';

export interface AdvanceAvailability {
  /** The advance the customer brought in (a negative opening balance), in rupees. */
  credit: string;
  /** What the order still owes, in rupees. */
  balanceDue: string;
  /** The most that can be applied now: the smaller of the two. */
  available: string;
}

/**
 * A customer who paid in advance before Friendly CRM (imported as a negative opening balance) is owed that money. When
 * they order, the advance is used up against the order: the order's balance comes down, the advance comes down by the same
 * amount, and a receipt is written so the books show where it went. Nothing else changes what the customer owes.
 */
@Injectable()
export class AdvanceCreditService {
  private readonly logger = new Logger(AdvanceCreditService.name);

  private availability(openingBalance: unknown, order: { totalAmount?: unknown; advanceReceived?: unknown }): AdvanceAvailability & { paise: number } {
    const credit = Math.max(0, -toPaise(openingBalance));
    const due = Math.max(0, toPaise(order.totalAmount) - toPaise(order.advanceReceived));
    const paise = Math.min(credit, due);
    return { credit: roundMoney(credit / 100), balanceDue: roundMoney(due / 100), available: roundMoney(paise / 100), paise };
  }

  async check(tenantId: string, orderId: string): Promise<AdvanceAvailability> {
    try {
      if (typeof db?.transaction === 'function') {
        const out = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
          if (!order) return undefined;
          const [cust] = await tx.select({ openingBalance: customers.openingBalance }).from(customers).where(and(eq(customers.id, order.customerId), eq(customers.tenantId, tenantId))).limit(1);
          const { paise: _p, ...view } = this.availability(cust?.openingBalance, order);
          return view;
        });
        if (out) return out;
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      onDbError(this.logger, 'checking the customer advance', err);
    }
    const order = globalMemoryOrders.find((o) => o.id === orderId && o.tenantId === tenantId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found in this business`);
    const cust: any = globalMemoryCustomers.find((c) => c.id === order.customerId && c.tenantId === tenantId);
    const { paise: _p, ...view } = this.availability(cust?.openingBalance, order);
    return view;
  }

  /** Uses `amount` rupees of the customer's advance against the order (the most possible when no amount is given). */
  async apply(tenantId: string, userId: string, orderId: string, amount?: number, idempotencyKey?: string) {
    if (amount !== undefined && (!(amount > 0) || Math.round(amount * 100) / 100 !== amount)) {
      throw new BadRequestException('Amount must be more than zero, in rupees and paise');
    }
    if (idempotencyKey) {
      const cached = getIdempotentResult(tenantId, 'apply-advance', idempotencyKey);
      if (cached) return { ...cached, isIdempotent: true };
    }
    const finish = (result: any) => {
      if (idempotencyKey) setIdempotentResult(tenantId, 'apply-advance', idempotencyKey, result);
      return result;
    };
    const tooMuch = (a: AdvanceAvailability) =>
      new BadRequestException({
        statusCode: 400,
        error: Number(a.available) <= 0 ? 'NoAdvanceToApply' : 'AdvanceTooLarge',
        message:
          Number(a.credit) <= 0
            ? 'This customer has no advance to use.'
            : Number(a.balanceDue) <= 0
            ? 'This order has nothing left to pay.'
            : `Only ₹${a.available} can be applied (advance ₹${a.credit}, order still owes ₹${a.balanceDue}).`,
        available: a.available,
      });

    try {
      if (typeof db?.transaction === 'function') {
        const result = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          // Both rows locked, so two applications at once cannot spend the same advance twice
          const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1).for('update');
          if (!order) return undefined;
          const [cust] = await tx.select().from(customers).where(and(eq(customers.id, order.customerId), eq(customers.tenantId, tenantId))).limit(1).for('update');
          const a = this.availability(cust?.openingBalance, order);
          const paise = amount === undefined ? a.paise : toPaise(amount);
          if (a.paise <= 0 || paise > a.paise) throw tooMuch(a);

          const receiptNumber = await getNextDbDocumentNumber(tx, payments, payments.receiptNumber, 'RCP', tenantId);
          const [payment] = await tx
            .insert(payments)
            .values({ tenantId, receiptNumber, customerId: order.customerId, orderId, amount: roundMoney(paise / 100), mode: ADVANCE_MODE, receivedById: userId, notes: 'Advance paid before Friendly CRM, used against this order' })
            .returning();
          const newAdvance = (toPaise(order.advanceReceived) + paise) / 100;
          const [updated] = await tx
            .update(orders)
            .set({ advanceReceived: roundMoney(newAdvance), balanceDue: roundMoney(Math.max(0, Number(order.totalAmount) - newAdvance)), updatedAt: new Date() })
            .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
            .returning();
          await tx.update(customers).set({ openingBalance: roundMoney((toPaise(cust.openingBalance) + paise) / 100), updatedAt: new Date() }).where(and(eq(customers.id, order.customerId), eq(customers.tenantId, tenantId)));
          await tx.insert(activities).values({
            tenantId,
            actorId: userId,
            entityType: 'ORDER',
            entityId: orderId,
            action: 'ADVANCE_APPLIED',
            metadata: { receiptNumber, amount: roundMoney(paise / 100), advanceRemaining: roundMoney((a.credit ? toPaise(a.credit) - paise : 0) / 100) },
          });
          return { payment, order: updated };
        });
        if (result) return finish(result);
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      onDbError(this.logger, 'applying a customer advance', err);
    }

    const order = globalMemoryOrders.find((o) => o.id === orderId && o.tenantId === tenantId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found in this business`);
    const cust: any = globalMemoryCustomers.find((c) => c.id === order.customerId && c.tenantId === tenantId);
    const a = this.availability(cust?.openingBalance, order);
    const paise = amount === undefined ? a.paise : toPaise(amount);
    if (a.paise <= 0 || paise > a.paise) throw tooMuch(a);

    const receiptNumber = getNextMemoryDocumentNumber(globalMemoryPayments, 'receiptNumber', 'RCP', tenantId);
    const payment = { id: randomUUID(), tenantId, receiptNumber, customerId: order.customerId, orderId, amount: roundMoney(paise / 100), mode: ADVANCE_MODE, referenceNo: null, receivedById: userId, paidAt: new Date(), notes: 'Advance paid before Friendly CRM, used against this order' };
    globalMemoryPayments.unshift(payment);
    const newAdvance = (toPaise(order.advanceReceived) + paise) / 100;
    order.advanceReceived = roundMoney(newAdvance);
    order.balanceDue = roundMoney(Math.max(0, Number(order.totalAmount) - newAdvance));
    order.updatedAt = new Date();
    cust.openingBalance = roundMoney((toPaise(cust.openingBalance) + paise) / 100);
    globalMemoryActivities.unshift({ id: randomUUID(), tenantId, actorId: userId, entityType: 'ORDER', entityId: orderId, action: 'ADVANCE_APPLIED', metadata: { receiptNumber, amount: roundMoney(paise / 100) }, createdAt: new Date() });
    return finish({ payment, order });
  }
}
