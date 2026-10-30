import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql, eq, and, desc, isNull } from 'drizzle-orm';
import { db, orders, customers, refunds, activities } from '@friendly-crm/db';
import { RecordRefundDto } from '@friendly-crm/shared';
import { globalMemoryActivities, globalMemoryCustomers, globalMemoryOrders, globalMemoryRefunds } from '../crm/memory-store';
import { onDbError } from '../../common/utils/db-fallback.util';
import {
  getIdempotentResult,
  getNextDbDocumentNumber,
  getNextMemoryDocumentNumber,
  roundMoney,
  setIdempotentResult,
} from '../../common/utils/document-number.util';

const toPaise = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** What an order's customer is owed back: what they paid, less what the order now comes to. Zero when they are not in credit. */
export const creditOf = (order: { advanceReceived?: unknown; totalAmount?: unknown }): number =>
  Math.max(0, toPaise(order.advanceReceived) - toPaise(order.totalAmount));

/** The advance a customer has on record (a negative opening balance), in paise. Zero when they owe us or nothing. */
export const advanceOf = (customer: { openingBalance?: unknown } | undefined): number => Math.max(0, -toPaise(customer?.openingBalance));

/**
 * Money paid back to a customer. A credit note can leave an order in credit (the customer had paid more than the order is
 * now worth); the business hands that money back outside the app, and this records it. It lowers the order's advance, which
 * brings the credit down; it can never refund more than the credit, and a refund cannot be changed or deleted afterwards.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  private tooMuch(creditPaise: number, amount: number) {
    return new BadRequestException({
      statusCode: 400,
      error: creditPaise <= 0 ? 'NotInCredit' : 'RefundTooLarge',
      message:
        creditPaise <= 0
          ? 'This order is not in credit, so there is nothing to refund.'
          : `Only ₹${roundMoney(creditPaise / 100)} is in credit on this order; a refund of ₹${roundMoney(amount)} is more than that.`,
      available: roundMoney(creditPaise / 100),
    });
  }

  async record(tenantId: string, userId: string, orderId: string, dto: RecordRefundDto, idempotencyKey?: string) {
    const amount = Number(dto.amount);
    if (!(amount > 0) || Math.round(amount * 100) / 100 !== amount) {
      throw new BadRequestException('Refund amount must be more than zero, in rupees and paise');
    }
    const key = idempotencyKey || dto.idempotencyKey;
    if (key) {
      const cached = getIdempotentResult(tenantId, 'record-refund', key);
      if (cached) return { ...cached, isIdempotent: true };
    }
    const mode = dto.mode;
    const referenceNo = dto.referenceNo?.trim() || null;

    const finish = (result: any) => {
      if (key) setIdempotentResult(tenantId, 'record-refund', key, result);
      return result;
    };

    try {
      if (typeof db?.transaction === 'function') {
        const result = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          // Locked, so two refunds at once cannot both be paid out of the same credit
          const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1).for('update');
          if (!order) return undefined;

          const creditPaise = creditOf(order);
          if (creditPaise <= 0 || toPaise(amount) > creditPaise) throw this.tooMuch(creditPaise, amount);

          if (referenceNo) {
            const [dup] = await tx.select({ id: refunds.id }).from(refunds).where(and(eq(refunds.tenantId, tenantId), eq(refunds.orderId, orderId), eq(refunds.referenceNo, referenceNo))).limit(1);
            if (dup) throw new BadRequestException(`A refund with reference '${referenceNo}' has already been recorded for this order`);
          }

          const refundNumber = await getNextDbDocumentNumber(tx, refunds, refunds.refundNumber, 'RFD', tenantId);
          const [refund] = await tx
            .insert(refunds)
            .values({ tenantId, refundNumber, customerId: order.customerId, orderId, amount: roundMoney(amount), mode, referenceNo, refundedById: userId, notes: dto.notes || null })
            .returning();

          const newAdvance = (toPaise(order.advanceReceived) - toPaise(amount)) / 100;
          const [updated] = await tx
            .update(orders)
            .set({ advanceReceived: roundMoney(newAdvance), balanceDue: roundMoney(Number(order.totalAmount) - newAdvance), updatedAt: new Date() })
            .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
            .returning();

          await tx.insert(activities).values({
            tenantId,
            actorId: userId,
            entityType: 'ORDER',
            entityId: orderId,
            action: 'REFUND_RECORDED',
            metadata: { refundNumber, amount: roundMoney(amount), mode, creditRemaining: roundMoney(creditOf(updated) / 100) },
          });
          return { refund, order: updated };
        });
        if (result) return finish(result);
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      if (err?.code === '23505') throw new BadRequestException('That refund was already recorded');
      onDbError(this.logger, 'recording a refund', err);
    }

    const order = globalMemoryOrders.find((o) => o.id === orderId && o.tenantId === tenantId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found in this business`);
    const creditPaise = creditOf(order);
    if (creditPaise <= 0 || toPaise(amount) > creditPaise) throw this.tooMuch(creditPaise, amount);
    if (referenceNo && globalMemoryRefunds.some((r) => r.tenantId === tenantId && r.orderId === orderId && r.referenceNo === referenceNo)) {
      throw new BadRequestException(`A refund with reference '${referenceNo}' has already been recorded for this order`);
    }

    const refundNumber = getNextMemoryDocumentNumber(globalMemoryRefunds, 'refundNumber', 'RFD', tenantId);
    const refund = { id: randomUUID(), tenantId, refundNumber, customerId: order.customerId, orderId, amount: roundMoney(amount), mode, referenceNo, refundedById: userId, refundedAt: new Date(), notes: dto.notes || null };
    globalMemoryRefunds.unshift(refund);
    const newAdvance = (toPaise(order.advanceReceived) - toPaise(amount)) / 100;
    order.advanceReceived = roundMoney(newAdvance);
    order.balanceDue = roundMoney(Number(order.totalAmount) - newAdvance);
    order.updatedAt = new Date();
    globalMemoryActivities.unshift({
      id: randomUUID(),
      tenantId,
      actorId: userId,
      entityType: 'ORDER',
      entityId: orderId,
      action: 'REFUND_RECORDED',
      metadata: { refundNumber, amount: roundMoney(amount), mode, creditRemaining: roundMoney(creditOf(order) / 100) },
      createdAt: new Date(),
    });
    return finish({ refund, order });
  }

  /** The refunds recorded for an order, newest first, and how much credit is still left on it. */
  async list(tenantId: string, orderId: string): Promise<{ data: any[]; creditRemaining: string }> {
    try {
      if (typeof db?.transaction === 'function') {
        const out = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
          if (!order) return undefined;
          const rows = await tx.select().from(refunds).where(and(eq(refunds.tenantId, tenantId), eq(refunds.orderId, orderId))).orderBy(desc(refunds.refundedAt));
          return { data: rows, creditRemaining: roundMoney(creditOf(order) / 100) };
        });
        if (out) return out;
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      onDbError(this.logger, 'listing refunds', err);
    }
    const order = globalMemoryOrders.find((o) => o.id === orderId && o.tenantId === tenantId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found in this business`);
    return {
      data: globalMemoryRefunds.filter((r) => r.tenantId === tenantId && r.orderId === orderId),
      creditRemaining: roundMoney(creditOf(order) / 100),
    };
  }

  // ---------------------------------------------------------------- the customer's advance

  private advanceTooMuch(advancePaise: number, amount: number) {
    return new BadRequestException({
      statusCode: 400,
      error: advancePaise <= 0 ? 'NoAdvance' : 'RefundTooLarge',
      message:
        advancePaise <= 0
          ? 'This customer has no advance on record, so there is nothing to refund.'
          : `Only ₹${roundMoney(advancePaise / 100)} of advance is on record; a refund of ₹${roundMoney(amount)} is more than that.`,
      available: roundMoney(advancePaise / 100),
    });
  }

  /**
   * Pays back (part of) a customer's ADVANCE, the money they paid before Friendly CRM and which was imported as a negative
   * opening balance. It belongs to the customer, not to an order, so the refund has no order. It brings the advance down
   * towards zero; it can never be more than the advance, and it cannot be changed afterwards.
   */
  async recordAdvance(tenantId: string, userId: string, customerId: string, dto: RecordRefundDto, idempotencyKey?: string) {
    const amount = Number(dto.amount);
    if (!(amount > 0) || Math.round(amount * 100) / 100 !== amount) {
      throw new BadRequestException('Refund amount must be more than zero, in rupees and paise');
    }
    const key = idempotencyKey || dto.idempotencyKey;
    if (key) {
      const cached = getIdempotentResult(tenantId, 'record-advance-refund', key);
      if (cached) return { ...cached, isIdempotent: true };
    }
    const mode = dto.mode;
    const referenceNo = dto.referenceNo?.trim() || null;
    const finish = (result: any) => {
      if (key) setIdempotentResult(tenantId, 'record-advance-refund', key, result);
      return result;
    };

    try {
      if (typeof db?.transaction === 'function') {
        const result = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          // Locked, so two refunds at once cannot both be paid out of the same advance
          const [cust] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1).for('update');
          if (!cust) return undefined;
          const advance = advanceOf(cust);
          if (advance <= 0 || toPaise(amount) > advance) throw this.advanceTooMuch(advance, amount);

          if (referenceNo) {
            const [dup] = await tx.select({ id: refunds.id }).from(refunds).where(and(eq(refunds.tenantId, tenantId), eq(refunds.customerId, customerId), isNull(refunds.orderId), eq(refunds.referenceNo, referenceNo))).limit(1);
            if (dup) throw new BadRequestException(`A refund with reference '${referenceNo}' has already been recorded for this customer's advance`);
          }

          const refundNumber = await getNextDbDocumentNumber(tx, refunds, refunds.refundNumber, 'RFD', tenantId);
          const [refund] = await tx
            .insert(refunds)
            .values({ tenantId, refundNumber, customerId, orderId: null, amount: roundMoney(amount), mode, referenceNo, refundedById: userId, notes: dto.notes || null })
            .returning();
          const newOpening = roundMoney((toPaise(cust.openingBalance) + toPaise(amount)) / 100);
          await tx.update(customers).set({ openingBalance: newOpening, updatedAt: new Date() }).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
          await tx.insert(activities).values({
            tenantId,
            actorId: userId,
            entityType: 'CUSTOMER',
            entityId: customerId,
            action: 'ADVANCE_REFUNDED',
            metadata: { refundNumber, amount: roundMoney(amount), mode, advanceRemaining: roundMoney(advanceOf({ openingBalance: newOpening }) / 100) },
          });
          return { refund, advanceRemaining: roundMoney(advanceOf({ openingBalance: newOpening }) / 100) };
        });
        if (result) return finish(result);
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      if (err?.code === '23505') throw new BadRequestException('That refund was already recorded');
      onDbError(this.logger, 'refunding a customer advance', err);
    }

    const cust: any = globalMemoryCustomers.find((c) => c.id === customerId && c.tenantId === tenantId);
    if (!cust) throw new NotFoundException(`Customer ${customerId} not found in this business`);
    const advance = advanceOf(cust);
    if (advance <= 0 || toPaise(amount) > advance) throw this.advanceTooMuch(advance, amount);
    if (referenceNo && globalMemoryRefunds.some((r) => r.tenantId === tenantId && r.customerId === customerId && !r.orderId && r.referenceNo === referenceNo)) {
      throw new BadRequestException(`A refund with reference '${referenceNo}' has already been recorded for this customer's advance`);
    }
    const refundNumber = getNextMemoryDocumentNumber(globalMemoryRefunds, 'refundNumber', 'RFD', tenantId);
    const refund = { id: randomUUID(), tenantId, refundNumber, customerId, orderId: null, amount: roundMoney(amount), mode, referenceNo, refundedById: userId, refundedAt: new Date(), notes: dto.notes || null };
    globalMemoryRefunds.unshift(refund);
    cust.openingBalance = roundMoney((toPaise(cust.openingBalance) + toPaise(amount)) / 100);
    const advanceRemaining = roundMoney(advanceOf(cust) / 100);
    globalMemoryActivities.unshift({ id: randomUUID(), tenantId, actorId: userId, entityType: 'CUSTOMER', entityId: customerId, action: 'ADVANCE_REFUNDED', metadata: { refundNumber, amount: roundMoney(amount), mode, advanceRemaining }, createdAt: new Date() });
    return finish({ refund, advanceRemaining });
  }

  /** The refunds of this customer's advance, newest first, and how much advance is still on record (as `creditRemaining`). */
  async listAdvance(tenantId: string, customerId: string): Promise<{ data: any[]; creditRemaining: string }> {
    try {
      if (typeof db?.transaction === 'function') {
        const out = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const [cust] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId))).limit(1);
          if (!cust) return undefined;
          const rows = await tx.select().from(refunds).where(and(eq(refunds.tenantId, tenantId), eq(refunds.customerId, customerId), isNull(refunds.orderId))).orderBy(desc(refunds.refundedAt));
          return { data: rows, creditRemaining: roundMoney(advanceOf(cust) / 100) };
        });
        if (out) return out;
      }
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      onDbError(this.logger, 'listing advance refunds', err);
    }
    const cust: any = globalMemoryCustomers.find((c) => c.id === customerId && c.tenantId === tenantId);
    if (!cust) throw new NotFoundException(`Customer ${customerId} not found in this business`);
    return {
      data: globalMemoryRefunds.filter((r) => r.tenantId === tenantId && r.customerId === customerId && !r.orderId),
      creditRemaining: roundMoney(advanceOf(cust) / 100),
    };
  }
}
