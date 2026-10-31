import { BadRequestException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql, eq, and, desc, inArray, ne } from 'drizzle-orm';
import { db, orders, payments, activities, creditTransfers } from '@friendly-crm/db';
import type { TransferCreditDto } from '@friendly-crm/shared';
import { globalMemoryActivities, globalMemoryCreditTransfers, globalMemoryOrders, globalMemoryPayments } from '../crm/memory-store';
import { onDbError } from '../../common/utils/db-fallback.util';
import {
  getIdempotentResult,
  getNextDbDocumentNumber,
  getNextMemoryDocumentNumber,
  roundMoney,
  setIdempotentResult,
} from '../../common/utils/document-number.util';
import { creditOf } from './refunds.service';

const toPaise = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** Payment mode of the receipt written on the order that receives the credit. */
export const CREDIT_TRANSFER_MODE = 'CREDIT_TRANSFER';

/** What an order still owes: its total less what has been received. Zero when it is paid or in credit. */
const dueOf = (order: { totalAmount?: unknown; advanceReceived?: unknown }): number => Math.max(0, toPaise(order.totalAmount) - toPaise(order.advanceReceived));

export interface CreditTransferOptions {
  /** Credit this order holds (the customer paid more than it comes to), in rupees. */
  credit: string;
  /** What this order still owes, in rupees. */
  balanceDue: string;
  /** Other open orders of the same customer that still owe something: where this order's credit can go. */
  targets: Array<{ id: string; orderNumber: string; balanceDue: string }>;
  /** Other orders of the same customer that hold credit: where this order's dues can be paid from. */
  sources: Array<{ id: string; orderNumber: string; credit: string }>;
}

const open = (o: { productionStage?: string | null }) => o.productionStage !== 'CANCELLED';

/**
 * A customer's order can be in credit (they paid more than it now comes to, after a credit note) while another order of
 * theirs still owes money. Instead of handing the credit back, the business can use it against the other order: the first
 * order's advance goes down and the second's goes up by the same amount, a receipt is written on the second, and the move
 * is recorded (append-only). It never leaves the customer, never creates money, and cannot be more than the credit or
 * than the other order still owes.
 */
@Injectable()
export class CreditTransferService {
  private readonly logger = new Logger(CreditTransferService.name);

  private view(order: any, others: any[]): CreditTransferOptions {
    return {
      credit: roundMoney(creditOf(order) / 100),
      balanceDue: roundMoney(dueOf(order) / 100),
      targets: others.filter((o) => open(o) && dueOf(o) > 0).map((o) => ({ id: o.id, orderNumber: o.orderNumber, balanceDue: roundMoney(dueOf(o) / 100) })),
      sources: others.filter((o) => creditOf(o) > 0).map((o) => ({ id: o.id, orderNumber: o.orderNumber, credit: roundMoney(creditOf(o) / 100) })),
    };
  }

  /** Where the credit of this order can go, and where credit for its dues can come from. */
  async options(tenantId: string, orderId: string): Promise<CreditTransferOptions> {
    try {
      if (typeof db?.transaction === 'function') {
        const out = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
          if (!order) return undefined;
          const others = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, order.customerId), ne(orders.id, orderId)));
          return this.view(order, others);
        });
        if (out) return out;
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      onDbError(this.logger, 'reading credit transfer options', err);
    }
    const order = globalMemoryOrders.find((o) => o.id === orderId && o.tenantId === tenantId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found in this business`);
    return this.view(order, globalMemoryOrders.filter((o) => o.tenantId === tenantId && o.customerId === order.customerId && o.id !== orderId));
  }

  private refuse(error: string, message: string, available?: string) {
    return new BadRequestException({ statusCode: 400, error, message, ...(available !== undefined ? { available } : {}) });
  }

  /** Checks the two orders and decides how much moves. Throws a plain refusal when it cannot be done. */
  private plan(from: any, to: any, amount: number | undefined): number {
    if (from.customerId !== to.customerId) throw this.refuse('DifferentCustomer', 'Credit can only be moved between orders of the same customer.');
    if (!open(to)) throw this.refuse('OrderCancelled', 'The other order is cancelled.');
    const credit = creditOf(from);
    const due = dueOf(to);
    const most = Math.min(credit, due);
    if (credit <= 0) throw this.refuse('NotInCredit', 'This order is not in credit, so there is nothing to move.', '0.00');
    if (due <= 0) throw this.refuse('NothingOwed', 'The other order has nothing left to pay.', '0.00');
    const paise = amount === undefined ? most : toPaise(amount);
    if (paise > most) {
      throw this.refuse('TransferTooLarge', `Only ₹${roundMoney(most / 100)} can be moved (credit ₹${roundMoney(credit / 100)}, the other order still owes ₹${roundMoney(due / 100)}).`, roundMoney(most / 100));
    }
    return paise;
  }

  /** Moves `dto.amount` rupees (the most possible when none is given) of this order's credit to another order of the same customer. */
  async transfer(tenantId: string, userId: string, fromOrderId: string, dto: TransferCreditDto, idempotencyKey?: string) {
    const amount = dto.amount === undefined ? undefined : Number(dto.amount);
    if (amount !== undefined && (!(amount > 0) || Math.round(amount * 100) / 100 !== amount)) {
      throw new BadRequestException('Amount must be more than zero, in rupees and paise');
    }
    if (dto.toOrderId === fromOrderId) throw this.refuse('SameOrder', 'Choose a different order to move the credit to.');
    const key = idempotencyKey || dto.idempotencyKey;
    if (key) {
      const cached = getIdempotentResult(tenantId, 'transfer-credit', key);
      if (cached) return { ...cached, isIdempotent: true };
    }
    const finish = (result: any) => {
      if (key) setIdempotentResult(tenantId, 'transfer-credit', key, result);
      return result;
    };
    const notes = dto.notes?.trim() || null;
    const noteOnReceipt = (fromNumber: string, transferNumber: string) => `Credit moved from ${fromNumber} (${transferNumber})`;

    try {
      if (typeof db?.transaction === 'function') {
        const result = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          // Both rows locked in one fixed order, so two transfers at once cannot spend the same credit twice or deadlock
          const rows = await tx
            .select()
            .from(orders)
            .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, [fromOrderId, dto.toOrderId])))
            .orderBy(orders.id)
            .for('update');
          const from = rows.find((r: any) => r.id === fromOrderId);
          const to = rows.find((r: any) => r.id === dto.toOrderId);
          if (!from) return undefined;
          if (!to) throw new NotFoundException(`Order ${dto.toOrderId} not found in this business`);
          const paise = this.plan(from, to, amount);

          const transferNumber = await getNextDbDocumentNumber(tx, creditTransfers, creditTransfers.transferNumber, 'CTR', tenantId);
          const [transfer] = await tx
            .insert(creditTransfers)
            .values({ tenantId, transferNumber, customerId: from.customerId, fromOrderId, toOrderId: to.id, amount: roundMoney(paise / 100), transferredById: userId, notes })
            .returning();
          const receiptNumber = await getNextDbDocumentNumber(tx, payments, payments.receiptNumber, 'RCP', tenantId);
          const [payment] = await tx
            .insert(payments)
            .values({ tenantId, receiptNumber, customerId: to.customerId, orderId: to.id, amount: roundMoney(paise / 100), mode: CREDIT_TRANSFER_MODE, receivedById: userId, notes: noteOnReceipt(from.orderNumber, transferNumber) })
            .returning();

          const fromAdvance = (toPaise(from.advanceReceived) - paise) / 100;
          const [updatedFrom] = await tx
            .update(orders)
            .set({ advanceReceived: roundMoney(fromAdvance), balanceDue: roundMoney(Number(from.totalAmount) - fromAdvance), updatedAt: new Date() })
            .where(and(eq(orders.id, from.id), eq(orders.tenantId, tenantId)))
            .returning();
          const toAdvance = (toPaise(to.advanceReceived) + paise) / 100;
          const [updatedTo] = await tx
            .update(orders)
            .set({ advanceReceived: roundMoney(toAdvance), balanceDue: roundMoney(Math.max(0, Number(to.totalAmount) - toAdvance)), updatedAt: new Date() })
            .where(and(eq(orders.id, to.id), eq(orders.tenantId, tenantId)))
            .returning();

          const meta = { transferNumber, amount: roundMoney(paise / 100), fromOrder: from.orderNumber, toOrder: to.orderNumber };
          await tx.insert(activities).values([
            { tenantId, actorId: userId, entityType: 'ORDER', entityId: from.id, action: 'CREDIT_MOVED_OUT', metadata: { ...meta, creditRemaining: roundMoney(creditOf(updatedFrom) / 100) } },
            { tenantId, actorId: userId, entityType: 'ORDER', entityId: to.id, action: 'CREDIT_MOVED_IN', metadata: { ...meta, receiptNumber } },
          ]);
          return { transfer, payment, from: updatedFrom, to: updatedTo };
        });
        if (result) return finish(result);
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      onDbError(this.logger, 'moving order credit', err);
    }

    const from = globalMemoryOrders.find((o) => o.id === fromOrderId && o.tenantId === tenantId);
    if (!from) throw new NotFoundException(`Order ${fromOrderId} not found in this business`);
    const to = globalMemoryOrders.find((o) => o.id === dto.toOrderId && o.tenantId === tenantId);
    if (!to) throw new NotFoundException(`Order ${dto.toOrderId} not found in this business`);
    const paise = this.plan(from, to, amount);

    const transferNumber = getNextMemoryDocumentNumber(globalMemoryCreditTransfers, 'transferNumber', 'CTR', tenantId);
    const transfer = { id: randomUUID(), tenantId, transferNumber, customerId: from.customerId, fromOrderId, toOrderId: to.id, amount: roundMoney(paise / 100), transferredById: userId, transferredAt: new Date(), notes };
    globalMemoryCreditTransfers.unshift(transfer);
    const receiptNumber = getNextMemoryDocumentNumber(globalMemoryPayments, 'receiptNumber', 'RCP', tenantId);
    const payment = { id: randomUUID(), tenantId, receiptNumber, customerId: to.customerId, orderId: to.id, amount: roundMoney(paise / 100), mode: CREDIT_TRANSFER_MODE, referenceNo: null, receivedById: userId, paidAt: new Date(), notes: noteOnReceipt(from.orderNumber, transferNumber) };
    globalMemoryPayments.unshift(payment);

    const fromAdvance = (toPaise(from.advanceReceived) - paise) / 100;
    from.advanceReceived = roundMoney(fromAdvance);
    from.balanceDue = roundMoney(Number(from.totalAmount) - fromAdvance);
    from.updatedAt = new Date();
    const toAdvance = (toPaise(to.advanceReceived) + paise) / 100;
    to.advanceReceived = roundMoney(toAdvance);
    to.balanceDue = roundMoney(Math.max(0, Number(to.totalAmount) - toAdvance));
    to.updatedAt = new Date();

    const meta = { transferNumber, amount: roundMoney(paise / 100), fromOrder: from.orderNumber, toOrder: to.orderNumber };
    globalMemoryActivities.unshift(
      { id: randomUUID(), tenantId, actorId: userId, entityType: 'ORDER', entityId: from.id, action: 'CREDIT_MOVED_OUT', metadata: { ...meta, creditRemaining: roundMoney(creditOf(from) / 100) }, createdAt: new Date() },
      { id: randomUUID(), tenantId, actorId: userId, entityType: 'ORDER', entityId: to.id, action: 'CREDIT_MOVED_IN', metadata: { ...meta, receiptNumber }, createdAt: new Date() }
    );
    return finish({ transfer, payment, from, to });
  }

  /** The moves into or out of this order, newest first. */
  async list(tenantId: string, orderId: string): Promise<{ data: any[] }> {
    try {
      if (typeof db?.transaction === 'function') {
        const out = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [order] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
          if (!order) return undefined;
          const rows = await tx
            .select()
            .from(creditTransfers)
            .where(and(eq(creditTransfers.tenantId, tenantId), sql`(${creditTransfers.fromOrderId} = ${orderId} OR ${creditTransfers.toOrderId} = ${orderId})`))
            .orderBy(desc(creditTransfers.transferredAt));
          return { data: rows };
        });
        if (out) return out;
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      onDbError(this.logger, 'listing credit transfers', err);
    }
    if (!globalMemoryOrders.some((o) => o.id === orderId && o.tenantId === tenantId)) throw new NotFoundException(`Order ${orderId} not found in this business`);
    return { data: globalMemoryCreditTransfers.filter((t) => t.tenantId === tenantId && (t.fromOrderId === orderId || t.toOrderId === orderId)) };
  }
}
