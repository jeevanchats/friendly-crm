import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { sql, eq, and, desc } from 'drizzle-orm';
import { NotificationOutboxService } from '../notifications/notification-outbox.service';
import { PdfEngineService } from './pdf/pdf-engine.service';
import {
  db,
  quotations,
  quotationItems,
  orders,
  orderItems,
  payments,
  leads,
  activities,
  customers,
  tenants,
} from '@friendly-crm/db';
import { getIndustryTemplate, IndustryKey, TenantRole, hasPermission } from '@friendly-crm/shared';
import { tenantContextStorage } from '../../common/interceptors/tenant-rls.interceptor';
import { randomUUID } from 'crypto';
import {
  globalMemoryQuotations,
  globalMemoryQuotationItems,
  globalMemoryOrders,
  globalMemoryOrderItems,
  globalMemoryCustomers,
  globalMemoryLeads,
  globalMemoryActivities,
  globalMemoryTenants,
  globalMemoryPayments,
} from '../crm/memory-store';
import {
  getNextDbDocumentNumber,
  getNextMemoryDocumentNumber,
  getIdempotentResult,
  setIdempotentResult,
  roundMoney,
} from '../../common/utils/document-number.util';

export interface QuoteLineItemInput {
  itemName: string;
  description?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  taxPercent?: number;
}

export interface CreateQuotationDto {
  customerId: string;
  leadId?: string;
  discountAmount?: number;
  validDays?: number;
  termsAndConditions?: string;
  customData?: Record<string, unknown>;
  items: QuoteLineItemInput[];
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @Optional() private readonly notificationOutboxService?: NotificationOutboxService,
    @Optional() private readonly pdfEngine: PdfEngineService = new PdfEngineService()
  ) {}

  /**
   * Helper to retrieve active database transaction from TenantRlsInterceptor or default db client
   */
  private getDb() {
    const store = tenantContextStorage.getStore();
    return store?.tx || db;
  }

  /**
   * Exact 2-decimal rounding helper to avoid floating-point drift
   */
  private roundMoney(val: number): string {
    return (Math.round((val + Number.EPSILON) * 100) / 100).toFixed(2);
  }

  /**
   * Helper to validate and compute line items, preventing zero/negative quantities and negative prices
   */
  private computeValidatedLineItems(items: QuoteLineItemInput[], tenantId: string) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Quotation must contain at least one line item.');
    }

    let subTotal = 0;
    let taxTotal = 0;

    const computedItems = items.map((item, index) => {
      const name = (item.itemName || (item as any).description || '').trim();
      if (!name) {
        throw new BadRequestException(`Line item at index ${index} must have a valid item name.`);
      }

      const qty = Number(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new BadRequestException(
          `Line item '${name}' has invalid quantity: ${item.quantity}. Quantity must be greater than 0.`
        );
      }

      const rate = Number(item.unitPrice);
      if (isNaN(rate) || rate < 0) {
        throw new BadRequestException(
          `Line item '${name}' has invalid unit price: ${item.unitPrice}. Unit price cannot be negative.`
        );
      }

      const taxRate = item.taxPercent !== undefined ? Number(item.taxPercent) : 18;
      if (isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
        throw new BadRequestException(
          `Line item '${name}' has invalid tax percent: ${item.taxPercent}. Tax percent must be between 0 and 100.`
        );
      }

      const base = qty * rate;
      const tax = base * (taxRate / 100);
      const lineTotal = base + tax;
      subTotal += base;
      taxTotal += tax;

      return {
        tenantId,
        itemName: name,
        description: item.description || null,
        quantity: this.roundMoney(qty),
        unit: item.unit || 'Nos',
        unitPrice: this.roundMoney(rate),
        taxPercent: this.roundMoney(taxRate),
        lineTotal: this.roundMoney(lineTotal),
      };
    });

    return { computedItems, subTotal, taxTotal };
  }

  /**
   * Helper to validate non-negative discount bounded by quotation value
   */
  private validateDiscount(discountAmount: number | undefined, totalValue: number): number {
    const discount = Number(discountAmount || 0);
    if (isNaN(discount) || discount < 0) {
      throw new BadRequestException('Discount cannot be negative.');
    }
    if (discount > totalValue) {
      throw new BadRequestException(
        `Discount amount (₹${discount}) cannot exceed quotation value (₹${totalValue}).`
      );
    }
    return discount;
  }

  /**
   * 1. Create Initial Quotation (v1) & auto-advance Lead stage to 'QUOTED'
   */
  async createQuotation(tenantId: string, userId: string, dto: CreateQuotationDto, idempotencyKey?: string) {
    if (!dto.customerId || typeof dto.customerId !== 'string' || !dto.customerId.trim()) {
      throw new BadRequestException('Customer ID is required.');
    }

    const key = idempotencyKey || (dto as any).idempotencyKey;
    if (key) {
      const cached = getIdempotentResult(tenantId, 'create-quotation', key);
      if (cached) {
        return { ...cached, isIdempotent: true };
      }
    }

    const { computedItems, subTotal, taxTotal } = this.computeValidatedLineItems(dto.items, tenantId);
    const discount = this.validateDiscount(dto.discountAmount, subTotal + taxTotal);
    const grandTotal = Math.max(0, subTotal + taxTotal - discount);

    try {
      const activeDb = this.getDb();

      if (typeof activeDb?.transaction === 'function') {
        return await activeDb.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          // Validate customer exists and belongs to active tenant
          const [customer] = await tx
            .select()
            .from(customers)
            .where(and(eq(customers.id, dto.customerId), eq(customers.tenantId, tenantId)))
            .limit(1);

          if (!customer) {
            throw new NotFoundException('Customer not found in this tenant organization');
          }

          if (dto.leadId) {
            const [lead] = await tx
              .select()
              .from(leads)
              .where(and(eq(leads.id, dto.leadId), eq(leads.tenantId, tenantId)))
              .limit(1);
            if (!lead) {
              throw new NotFoundException('Lead not found in this tenant organization');
            }
          }

          const quoteNumber = await getNextDbDocumentNumber(tx, quotations, quotations.quoteNumber, 'QT', tenantId);

          const [quote] = await tx
            .insert(quotations)
            .values({
              tenantId,
              quoteNumber,
              version: 1,
              customerId: dto.customerId,
              leadId: dto.leadId || null,
              status: 'SENT',
              subTotal: this.roundMoney(subTotal),
              taxTotal: this.roundMoney(taxTotal),
              discountTotal: this.roundMoney(discount),
              grandTotal: this.roundMoney(grandTotal),
              validUntil: new Date(Date.now() + (dto.validDays || 15) * 86400000),
              termsAndConditions: dto.termsAndConditions || null,
              customData: dto.customData || {},
            })
            .returning();

          const insertedItems = await tx
            .insert(quotationItems)
            .values(computedItems.map((i) => ({ ...i, quotationId: quote.id })))
            .returning();

          // Advance linked Lead to QUOTED stage automatically
          if (dto.leadId) {
            await tx
              .update(leads)
              .set({ stage: 'QUOTED', estimatedValue: this.roundMoney(grandTotal) })
              .where(and(eq(leads.id, dto.leadId), eq(leads.tenantId, tenantId)));
          }

          await tx.insert(activities).values({
            tenantId,
            actorId: userId || null,
            entityType: 'QUOTATION',
            entityId: quote.id,
            action: 'QUOTATION_CREATED_V1',
            metadata: { quoteNumber, grandTotal: quote.grandTotal },
          });

          const result = { ...quote, items: insertedItems };
          if (key) {
            setIdempotentResult(tenantId, 'create-quotation', key, result);
          }

          if (this.notificationOutboxService && customer?.phone) {
            this.notificationOutboxService.enqueueNotification({
              tenantId,
              recipient: customer.phone,
              templateKey: 'QUOTATION_CREATED',
              params: {
                customerName: customer.name,
                quoteNumber: quote.quoteNumber,
                version: quote.version,
                grandTotal: quote.grandTotal,
                pdfUrl: `/q/${quote.id}/pdf`,
              },
            }).catch((notifErr: any) => this.logger.warn(`Failed to enqueue quotation notification: ${notifErr.message}`));
          }

          return result;
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for createQuotation: ${err.message}`);
    }

    // Unified Memory Fallback
    const customer = globalMemoryCustomers.find(
      (c) => c.id === dto.customerId && c.tenantId === tenantId
    );
    if (!customer) {
      throw new NotFoundException('Customer not found in this tenant organization');
    }

    if (dto.leadId) {
      const lead = globalMemoryLeads.find((l) => l.id === dto.leadId && l.tenantId === tenantId);
      if (!lead) {
        throw new NotFoundException('Lead not found in this tenant organization');
      }
      lead.stage = 'QUOTED';
      lead.estimatedValue = this.roundMoney(grandTotal);
    }

    const quoteNumber = getNextMemoryDocumentNumber(globalMemoryQuotations, 'quoteNumber', 'QT', tenantId);
    const quoteId = randomUUID();
    const quote = {
      id: quoteId,
      tenantId,
      quoteNumber,
      version: 1,
      customerId: dto.customerId,
      leadId: dto.leadId || null,
      status: 'SENT',
      subTotal: this.roundMoney(subTotal),
      taxTotal: this.roundMoney(taxTotal),
      discountTotal: this.roundMoney(discount),
      grandTotal: this.roundMoney(grandTotal),
      validUntil: new Date(Date.now() + (dto.validDays || 15) * 86400000),
      termsAndConditions: dto.termsAndConditions || 'Payment: 50% advance, 50% before dispatch.',
      customData: dto.customData || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    globalMemoryQuotations.unshift(quote);

    const items = computedItems.map((item) => ({
      ...item,
      id: randomUUID(),
      quotationId: quoteId,
    }));
    globalMemoryQuotationItems.push(...items);

    globalMemoryActivities.unshift({
      id: randomUUID(),
      tenantId,
      actorId: userId || null,
      entityType: 'QUOTATION',
      entityId: quote.id,
      action: 'QUOTATION_CREATED_V1',
      metadata: { quoteNumber, grandTotal: quote.grandTotal },
      createdAt: new Date(),
    });

    const result = { ...quote, items };
    if (key) {
      setIdempotentResult(tenantId, 'create-quotation', key, result);
    }

    if (this.notificationOutboxService && customer?.phone) {
      this.notificationOutboxService.enqueueNotification({
        tenantId,
        recipient: customer.phone,
        templateKey: 'QUOTATION_CREATED',
        params: {
          customerName: customer.name,
          quoteNumber: quote.quoteNumber,
          version: quote.version,
          grandTotal: quote.grandTotal,
          pdfUrl: `/q/${quote.id}/pdf`,
        },
      }).catch((notifErr: any) => this.logger.warn(`Failed to enqueue quotation notification: ${notifErr.message}`));
    }

    return result;
  }

  /**
   * 2. Create Revision (v2, v3...) without overwriting historical quote versions
   */
  async createRevision(
    tenantId: string,
    userId: string,
    existingQuoteId: string,
    dto: CreateQuotationDto
  ) {
    const { computedItems, subTotal, taxTotal } = this.computeValidatedLineItems(dto.items, tenantId);
    const discount = this.validateDiscount(dto.discountAmount, subTotal + taxTotal);
    const grandTotal = Math.max(0, subTotal + taxTotal - discount);

    try {
      const activeDb = this.getDb();

      if (typeof activeDb?.transaction === 'function') {
        return await activeDb.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          const [prevQuote] = await tx
            .select()
            .from(quotations)
            .where(and(eq(quotations.id, existingQuoteId), eq(quotations.tenantId, tenantId)))
            .limit(1);

          if (!prevQuote) throw new NotFoundException('Original quotation not found in this tenant');

          // Mark previous version as superseded
          await tx
            .update(quotations)
            .set({ status: 'REJECTED' })
            .where(eq(quotations.id, prevQuote.id));

          const nextVersion = prevQuote.version + 1;

          const [revisedQuote] = await tx
            .insert(quotations)
            .values({
              tenantId,
              quoteNumber: prevQuote.quoteNumber,
              version: nextVersion,
              parentQuoteId: prevQuote.id,
              customerId: prevQuote.customerId,
              leadId: prevQuote.leadId,
              status: 'SENT',
              subTotal: this.roundMoney(subTotal),
              taxTotal: this.roundMoney(taxTotal),
              discountTotal: this.roundMoney(discount),
              grandTotal: this.roundMoney(grandTotal),
              termsAndConditions: dto.termsAndConditions || prevQuote.termsAndConditions,
              customData: dto.customData || prevQuote.customData,
            })
            .returning();

          const insertedItems = await tx
            .insert(quotationItems)
            .values(computedItems.map((i) => ({ ...i, quotationId: revisedQuote.id })))
            .returning();

          await tx.insert(activities).values({
            tenantId,
            actorId: userId || null,
            entityType: 'QUOTATION',
            entityId: revisedQuote.id,
            action: `QUOTATION_REVISED_V${nextVersion}`,
            metadata: { previousQuoteId: prevQuote.id, grandTotal: revisedQuote.grandTotal },
          });

          return { ...revisedQuote, items: insertedItems };
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for createRevision: ${err.message}`);
    }

    // Unified Memory Fallback
    const prevQuote = globalMemoryQuotations.find(
      (q) => q.id === existingQuoteId && q.tenantId === tenantId
    );
    if (!prevQuote) throw new NotFoundException('Original quotation not found in this tenant');

    prevQuote.status = 'REJECTED';
    const nextVersion = prevQuote.version + 1;
    const revisedQuoteId = randomUUID();

    const revisedQuote = {
      id: revisedQuoteId,
      tenantId,
      quoteNumber: prevQuote.quoteNumber,
      version: nextVersion,
      parentQuoteId: prevQuote.id,
      customerId: prevQuote.customerId,
      leadId: prevQuote.leadId,
      status: 'SENT',
      subTotal: this.roundMoney(subTotal),
      taxTotal: this.roundMoney(taxTotal),
      discountTotal: this.roundMoney(discount),
      grandTotal: this.roundMoney(grandTotal),
      termsAndConditions: dto.termsAndConditions || prevQuote.termsAndConditions,
      customData: dto.customData || prevQuote.customData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    globalMemoryQuotations.unshift(revisedQuote);

    const items = computedItems.map((item) => ({
      ...item,
      id: randomUUID(),
      quotationId: revisedQuoteId,
    }));
    globalMemoryQuotationItems.push(...items);

    globalMemoryActivities.unshift({
      id: randomUUID(),
      tenantId,
      actorId: userId || null,
      entityType: 'QUOTATION',
      entityId: revisedQuote.id,
      action: `QUOTATION_REVISED_V${nextVersion}`,
      metadata: { previousQuoteId: prevQuote.id, grandTotal: revisedQuote.grandTotal },
      createdAt: new Date(),
    });

    return { ...revisedQuote, items };
  }

  /**
   * 3. One-Click Convert Accepted Quotation into an Active Production Order
   */
  async convertQuoteToOrder(
    tenantId: string,
    userId: string,
    industryKey: string,
    quotationId: string,
    advanceReceived: number = 0,
    expectedDeliveryAt?: string,
    idempotencyKey?: string,
    paymentDetails?: { mode?: string; reference?: string; notes?: string }
  ) {
    const advance = Number(advanceReceived || 0);
    if (isNaN(advance) || advance < 0) {
      throw new BadRequestException('Advance amount cannot be negative');
    }

    const key = idempotencyKey;
    if (key) {
      const cached = getIdempotentResult(tenantId, 'convert-quote', key);
      if (cached) {
        return { ...cached, isIdempotent: true };
      }
    }

    const template = getIndustryTemplate(industryKey);
    const firstStage = template.orderStages[0]?.id || 'ORDER_CONFIRMED';

    try {
      const activeDb = this.getDb();

      if (typeof activeDb?.transaction === 'function') {
        return await activeDb.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          const [quote] = await tx
            .select()
            .from(quotations)
            .where(and(eq(quotations.id, quotationId), eq(quotations.tenantId, tenantId)))
            .limit(1);

          if (!quote) throw new NotFoundException('Quotation not found in this tenant');

          if (quote.status === 'CONVERTED') {
            if (key) {
              const [existingOrder] = await tx
                .select()
                .from(orders)
                .where(and(eq(orders.quotationId, quote.id), eq(orders.tenantId, tenantId)))
                .limit(1);
              if (existingOrder) {
                return {
                  success: true,
                  orderId: existingOrder.id,
                  orderNumber: existingOrder.orderNumber,
                  ...existingOrder,
                  quotation: quote,
                  isIdempotent: true,
                };
              }
            }
            throw new BadRequestException('Quotation is already converted to an order');
          }
          if (quote.status === 'REJECTED') {
            throw new BadRequestException('Cannot convert a rejected or superseded quotation');
          }
          if (quote.status === 'CANCELLED') {
            throw new BadRequestException('Cannot convert a cancelled quotation');
          }

          const total = parseFloat(quote.grandTotal);
          if (advance > total) {
            throw new BadRequestException(
              `Advance received (₹${advance}) cannot exceed quotation grand total (₹${total})`
            );
          }
          const balance = total - advance;

          const orderNumber = await getNextDbDocumentNumber(tx, orders, orders.orderNumber, 'ORD', tenantId);

          const items = await tx
            .select()
            .from(quotationItems)
            .where(and(eq(quotationItems.quotationId, quote.id), eq(quotationItems.tenantId, tenantId)));

          const [order] = await tx
            .insert(orders)
            .values({
              tenantId,
              orderNumber,
              customerId: quote.customerId,
              quotationId: quote.id,
              productionStage: firstStage,
              totalAmount: this.roundMoney(total),
              advanceReceived: this.roundMoney(advance),
              balanceDue: this.roundMoney(balance),
              expectedDeliveryAt: expectedDeliveryAt ? new Date(expectedDeliveryAt) : null,
              customData: quote.customData,
            })
            .returning();

          if (items.length > 0) {
            await tx.insert(orderItems).values(
              items.map((item) => ({
                tenantId,
                orderId: order.id,
                itemName: item.itemName,
                description: item.description,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice,
                taxPercent: item.taxPercent,
                lineTotal: item.lineTotal,
              }))
            );
          }

          // Mark quote as CONVERTED
          await tx
            .update(quotations)
            .set({ status: 'CONVERTED' })
            .where(and(eq(quotations.id, quote.id), eq(quotations.tenantId, tenantId)));

          // Mark linked lead as WON
          if (quote.leadId) {
            await tx
              .update(leads)
              .set({ stage: 'WON' })
              .where(and(eq(leads.id, quote.leadId), eq(leads.tenantId, tenantId)));
          }

          if (advance > 0) {
            const receiptNumber = await getNextDbDocumentNumber(tx, payments, payments.receiptNumber, 'RCP', tenantId);
            await tx.insert(payments).values({
              tenantId,
              receiptNumber,
              customerId: quote.customerId,
              orderId: order.id,
              amount: this.roundMoney(advance),
              mode: paymentDetails?.mode || 'UPI',
              referenceNo: paymentDetails?.reference || `REF-${Date.now().toString().slice(-6)}`,
              receivedById: userId || null,
              notes: paymentDetails?.notes || 'Advance received at quotation conversion',
              paidAt: new Date(),
            });
          }

          // Update Customer Receivable
          const [customer] = await tx
            .select()
            .from(customers)
            .where(and(eq(customers.id, quote.customerId), eq(customers.tenantId, tenantId)))
            .limit(1);
          if (customer) {
            const currentRec = parseFloat(customer.totalReceivable || '0.00');
            await tx
              .update(customers)
              .set({ totalReceivable: this.roundMoney(currentRec + balance) })
              .where(eq(customers.id, customer.id));
          }

          await tx.insert(activities).values({
            tenantId,
            actorId: userId || null,
            entityType: 'ORDER',
            entityId: order.id,
            action: 'QUOTE_CONVERTED_TO_ORDER',
            metadata: { orderNumber, quotationId: quote.id, totalAmount: order.totalAmount },
          });

          const result = {
            success: true,
            orderId: order.id,
            orderNumber: order.orderNumber,
            ...order,
            quotation: { ...quote, status: 'CONVERTED' },
          };

          if (key) {
            setIdempotentResult(tenantId, 'convert-quote', key, result);
          }

          if (this.notificationOutboxService && customer?.phone) {
            this.notificationOutboxService.enqueueNotification({
              tenantId,
              recipient: customer.phone,
              templateKey: 'ORDER_CONFIRMED',
              params: {
                customerName: customer.name,
                orderNumber: order.orderNumber,
                stageName: firstStage,
                expectedDelivery: expectedDeliveryAt || 'Scheduled soon',
              },
            }).catch((notifErr: any) => this.logger.warn(`Failed to enqueue order confirmation: ${notifErr.message}`));
          }

          return result;
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for convertQuoteToOrder: ${err.message}`);
    }

    // Unified Memory Fallback
    const quote = globalMemoryQuotations.find(
      (q) => q.id === quotationId && q.tenantId === tenantId
    );
    if (!quote) throw new NotFoundException('Quotation not found in this tenant');

    if (quote.status === 'CONVERTED') {
      if (key) {
        const existingOrder = globalMemoryOrders.find(
          (o) => o.quotationId === quote.id && o.tenantId === tenantId
        );
        if (existingOrder) {
          return {
            success: true,
            orderId: existingOrder.id,
            orderNumber: existingOrder.orderNumber,
            ...existingOrder,
            quotation: quote,
            isIdempotent: true,
          };
        }
      }
      throw new BadRequestException('Quotation is already converted to an order');
    }
    if (quote.status === 'REJECTED') {
      throw new BadRequestException('Cannot convert a rejected or superseded quotation');
    }
    if (quote.status === 'CANCELLED') {
      throw new BadRequestException('Cannot convert a cancelled quotation');
    }

    const total = parseFloat(quote.grandTotal);
    if (advance > total) {
      throw new BadRequestException(
        `Advance received (₹${advance}) cannot exceed quotation grand total (₹${total})`
      );
    }
    const balance = total - advance;

    quote.status = 'CONVERTED';
    const items = globalMemoryQuotationItems.filter(
      (i) => i.quotationId === quotationId && i.tenantId === tenantId
    );

    const orderNumber = getNextMemoryDocumentNumber(globalMemoryOrders, 'orderNumber', 'ORD', tenantId);
    const orderId = randomUUID();

    const order = {
      id: orderId,
      tenantId,
      orderNumber,
      customerId: quote.customerId,
      quotationId: quote.id,
      productionStage: firstStage,
      totalAmount: this.roundMoney(total),
      advanceReceived: this.roundMoney(advance),
      balanceDue: this.roundMoney(balance),
      expectedDeliveryAt: expectedDeliveryAt ? new Date(expectedDeliveryAt) : null,
      customData: quote.customData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    globalMemoryOrders.unshift(order);

    const copyItems = items.map((item) => ({
      ...item,
      id: randomUUID(),
      orderId,
      tenantId,
    }));
    globalMemoryOrderItems.push(...copyItems);

    if (advance > 0) {
      const receiptNumber = getNextMemoryDocumentNumber(globalMemoryPayments, 'receiptNumber', 'RCP', tenantId);
      globalMemoryPayments.unshift({
        id: randomUUID(),
        tenantId,
        receiptNumber,
        customerId: quote.customerId,
        orderId,
        amount: this.roundMoney(advance),
        mode: paymentDetails?.mode || 'UPI',
        referenceNo: paymentDetails?.reference || `REF-${Date.now().toString().slice(-6)}`,
        receivedById: userId || null,
        paidAt: new Date(),
        notes: paymentDetails?.notes || 'Advance received at quotation conversion',
      });
    }

    // Update customer active orders
    const customer = globalMemoryCustomers.find(
      (c) => c.id === quote.customerId && c.tenantId === tenantId
    );
    if (customer) {
      customer.activeOrdersCount = (customer.activeOrdersCount || 0) + 1;
      const currentReceivable = parseFloat(customer.totalReceivable || '0');
      customer.totalReceivable = this.roundMoney(currentReceivable + balance);
    }

    // Mark lead WON
    if (quote.leadId) {
      const lead = globalMemoryLeads.find((l) => l.id === quote.leadId && l.tenantId === tenantId);
      if (lead) {
        lead.stage = 'WON';
      }
    }

    globalMemoryActivities.unshift({
      id: randomUUID(),
      tenantId,
      actorId: userId || null,
      entityType: 'ORDER',
      entityId: orderId,
      action: 'QUOTE_CONVERTED_TO_ORDER',
      metadata: { orderNumber, quotationId: quote.id, totalAmount: order.totalAmount },
      createdAt: new Date(),
    });

    const result = {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      ...order,
      quotation: quote,
    };

    if (this.notificationOutboxService && customer?.phone) {
      this.notificationOutboxService.enqueueNotification({
        tenantId,
        recipient: customer.phone,
        templateKey: 'ORDER_CONFIRMED',
        params: {
          customerName: customer.name,
          orderNumber: order.orderNumber,
          stageName: firstStage,
          expectedDelivery: expectedDeliveryAt || 'Scheduled soon',
        },
      }).catch((notifErr: any) => this.logger.warn(`Failed to enqueue order confirmation: ${notifErr.message}`));
    }

    if (key) {
      setIdempotentResult(tenantId, 'convert-quote', key, result);
    }

    return result;
  }

  /**
   * 4. Retrieve Full Quotation Details with Customer, Items, and Tenant
   */
  async getQuotationById(id: string, tenantId?: string, userRole?: TenantRole) {
    const canSeePayments = userRole ? hasPermission(userRole, 'payment:view') : true;
    try {
      const activeDb = this.getDb();

      const whereConditions = [eq(quotations.id, id)];
      if (tenantId) {
        whereConditions.push(eq(quotations.tenantId, tenantId));
      }

      const [quote] = await activeDb
        .select()
        .from(quotations)
        .where(and(...whereConditions))
        .limit(1);

      if (!quote) throw new NotFoundException(`Quotation with id '${id}' not found`);

      const [customer] = await activeDb
        .select()
        .from(customers)
        .where(and(eq(customers.id, quote.customerId), eq(customers.tenantId, quote.tenantId)))
        .limit(1);

      const items = await activeDb
        .select()
        .from(quotationItems)
        .where(and(eq(quotationItems.quotationId, quote.id), eq(quotationItems.tenantId, quote.tenantId)));

      const [tenant] = await activeDb
        .select()
        .from(tenants)
        .where(eq(tenants.id, quote.tenantId))
        .limit(1);

      const industryKey = (tenant?.industryKey || 'printing') as IndustryKey;
      const template = getIndustryTemplate(industryKey);

      const maskedQuote = canSeePayments
        ? quote
        : {
            ...quote,
            subTotal: null,
            taxTotal: null,
            discountTotal: null,
            grandTotal: null,
          };

      const maskedItems = items.map((item: any) =>
        canSeePayments
          ? item
          : {
              ...item,
              unitPrice: null,
              lineTotal: null,
            }
      );

      return {
        quote: maskedQuote,
        customer: customer || {
          id: quote.customerId,
          name: 'Direct Customer',
          phone: '+919840123456',
          companyName: null,
          billingAddress: null,
          gstin: null,
        },
        items: maskedItems,
        tenant: tenant || {
          name: 'Business Tenant',
          phone: '+91 98400 11223',
          gstNumber: null,
          industryKey,
        },
        industryTemplate: template,
      };
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for getQuotationById: ${err.message}`);
    }

    // Unified Memory Fallback — STRICT TENANT SCOPE, NO FALLBACK TO FIRST DEMO QUOTE!
    const quote = globalMemoryQuotations.find(
      (q) => q.id === id && (!tenantId || q.tenantId === tenantId)
    );
    if (!quote) {
      throw new NotFoundException(`Quotation with id '${id}' not found`);
    }

    const customer = globalMemoryCustomers.find(
      (c) => c.id === quote.customerId && c.tenantId === quote.tenantId
    );
    const items = globalMemoryQuotationItems.filter(
      (i) => i.quotationId === quote.id && i.tenantId === quote.tenantId
    );
    const tenant = globalMemoryTenants.get(quote.tenantId);
    const industryKey = (tenant?.industryKey || 'printing') as IndustryKey;
    const template = getIndustryTemplate(industryKey);

    const maskedQuote = canSeePayments
      ? quote
      : {
          ...quote,
          subTotal: null,
          taxTotal: null,
          discountTotal: null,
          grandTotal: null,
        };

    const maskedItems = items.map((item: any) =>
      canSeePayments
        ? item
        : {
            ...item,
            unitPrice: null,
            lineTotal: null,
          }
    );

    return {
      quote: maskedQuote,
      customer: customer || {
        id: quote.customerId,
        name: 'Direct Customer',
        phone: '+919840123456',
        companyName: null,
        billingAddress: null,
        gstin: null,
      },
      items: maskedItems,
      tenant: tenant || {
        name: 'Tenant ' + quote.tenantId.slice(0, 8),
        phone: '+91 98400 11223',
        gstNumber: null,
        industryKey,
      },
      industryTemplate: template,
    };
  }

  /**
   * 5. Get list of quotations for tenant
   */
  async getQuotations(tenantId: string, userRole?: TenantRole) {
    const canSeePayments = userRole ? hasPermission(userRole, 'payment:view') : true;
    try {
      const activeDb = this.getDb();
      const rows = await activeDb
        .select()
        .from(quotations)
        .where(eq(quotations.tenantId, tenantId))
        .orderBy(desc(quotations.createdAt));

      const maskedRows = rows.map((q: any) =>
        canSeePayments
          ? q
          : {
              ...q,
              subTotal: null,
              taxTotal: null,
              discountTotal: null,
              grandTotal: null,
            }
      );

      return { data: maskedRows, total: rows.length };
    } catch {
      const rows = globalMemoryQuotations.filter((q) => q.tenantId === tenantId);
      const maskedRows = rows.map((q: any) =>
        canSeePayments
          ? q
          : {
              ...q,
              subTotal: null,
              taxTotal: null,
              discountTotal: null,
              grandTotal: null,
            }
      );
      return { data: maskedRows, total: rows.length };
    }
  }

  /**
   * 6. Generate Quotation PDF Buffer using PdfEngineService
   */
  async generateQuotationPdf(id: string, tenantId: string, userRole: TenantRole): Promise<Buffer> {
    const data = await this.getQuotationById(id, tenantId, userRole);
    return this.pdfEngine.generateQuotationPdf({
      quoteNumber: data.quote.quoteNumber,
      validUntil: data.quote.validUntil,
      subTotal: data.quote.subTotal,
      taxTotal: data.quote.taxTotal,
      discountTotal: data.quote.discountTotal,
      grandTotal: data.quote.grandTotal,
      items: data.items.map((i: any) => ({
        description: i.description || i.itemName,
        quantity: Number(i.quantity),
        unitPrice: i.unitPrice,
        total: i.lineTotal,
        lineTotal: i.lineTotal,
      })),
    });
  }
}
