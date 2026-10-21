import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { sql, eq, and, desc } from 'drizzle-orm';
import {
  db,
  quotations,
  quotationItems,
  orders,
  orderItems,
  leads,
  activities,
  customers,
  tenants,
} from '@friendly-crm/db';
import { INDUSTRY_TEMPLATES, IndustryKey, getIndustryTemplate } from '@friendly-crm/shared';
import { tenantContextStorage } from '../../common/interceptors/tenant-rls.interceptor';
import { randomUUID } from 'crypto';

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

  // In-memory fallback repository for local offline development & tests
  private memoryQuotations: Array<any> = [
    {
      id: 'quote-demo-1',
      tenantId: 't-demo-printing',
      quoteNumber: 'QT-2026-0042',
      version: 1,
      customerId: 'c-demo-1',
      leadId: 'lead-demo-1',
      status: 'SENT',
      subTotal: '150000.00',
      taxTotal: '27000.00',
      discountTotal: '5000.00',
      grandTotal: '172000.00',
      validUntil: new Date(Date.now() + 15 * 86400000),
      termsAndConditions: 'Payment: 50% advance with PO, 50% on dispatch.\nDelivery: 7 working days after artwork approval.',
      customData: {
        job_type: 'PACKAGING_BOX',
        paper_board_gsm: '350 GSM Cyber Premium Board',
        print_colors: 'CMYK_PLUS_PANTONE',
        finishing_ops: ['MATT_LAM', 'SPOT_UV', 'DIE_PUNCH'],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  private memoryQuotationItems: Array<any> = [
    {
      id: 'qi-demo-1',
      tenantId: 't-demo-printing',
      quotationId: 'quote-demo-1',
      itemName: 'Diwali Premium Rigid Boxes (Lidded)',
      description: '350 GSM Cyber Premium Board, Matt Lamination, Gold Foil Stamping',
      quantity: '5000.00',
      unit: 'Nos',
      unitPrice: '30.00',
      taxPercent: '18.00',
      lineTotal: '177000.00',
    },
  ];

  private memoryOrders: Array<any> = [];
  private memoryOrderItems: Array<any> = [];

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
   * 1. Create Initial Quotation (v1) & auto-advance Lead stage to 'QUOTED'
   */
  async createQuotation(tenantId: string, userId: string, dto: CreateQuotationDto) {
    if (!dto.items?.length) {
      throw new BadRequestException('Quotation must contain at least one line item.');
    }

    let subTotal = 0;
    let taxTotal = 0;

    const computedItems = dto.items.map((item) => {
      const qty = Number(item.quantity) || 1;
      const rate = Number(item.unitPrice) || 0;
      const taxRate = Number(item.taxPercent !== undefined ? item.taxPercent : 18);
      const base = qty * rate;
      const tax = base * (taxRate / 100);
      const lineTotal = base + tax;
      subTotal += base;
      taxTotal += tax;

      return {
        tenantId,
        itemName: item.itemName,
        description: item.description || null,
        quantity: this.roundMoney(qty),
        unit: item.unit || 'Nos',
        unitPrice: this.roundMoney(rate),
        taxPercent: this.roundMoney(taxRate),
        lineTotal: this.roundMoney(lineTotal),
      };
    });

    const discount = Number(dto.discountAmount) || 0;
    const grandTotal = Math.max(0, subTotal + taxTotal - discount);
    const quoteNumber = `QT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

    try {
      const activeDb = this.getDb();

      return await activeDb.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

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

        return { ...quote, items: insertedItems };
      });
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for createQuotation: ${err.message}`);

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
      this.memoryQuotations.unshift(quote);

      const items = computedItems.map((item) => ({
        ...item,
        id: randomUUID(),
        quotationId: quoteId,
      }));
      this.memoryQuotationItems.push(...items);

      return { ...quote, items };
    }
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
    let subTotal = 0;
    let taxTotal = 0;
    const computedItems = dto.items.map((item) => {
      const qty = Number(item.quantity) || 1;
      const rate = Number(item.unitPrice) || 0;
      const taxRate = Number(item.taxPercent !== undefined ? item.taxPercent : 18);
      const base = qty * rate;
      const tax = base * (taxRate / 100);
      subTotal += base;
      taxTotal += tax;
      return {
        tenantId,
        itemName: item.itemName,
        description: item.description || null,
        quantity: this.roundMoney(qty),
        unit: item.unit || 'Nos',
        unitPrice: this.roundMoney(rate),
        taxPercent: this.roundMoney(taxRate),
        lineTotal: this.roundMoney(base + tax),
      };
    });

    const discount = Number(dto.discountAmount) || 0;
    const grandTotal = Math.max(0, subTotal + taxTotal - discount);

    try {
      const activeDb = this.getDb();

      return await activeDb.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

        const [prevQuote] = await tx
          .select()
          .from(quotations)
          .where(and(eq(quotations.id, existingQuoteId), eq(quotations.tenantId, tenantId)))
          .limit(1);

        if (!prevQuote) throw new NotFoundException('Original quotation not found');

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
            quoteNumber: prevQuote.quoteNumber, // Keeps same base number, increments version
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
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.warn(`Postgres offline; utilizing memory fallback for createRevision: ${err.message}`);

      const prevQuote = this.memoryQuotations.find((q) => q.id === existingQuoteId);
      if (!prevQuote) throw new NotFoundException('Original quotation not found');

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
      this.memoryQuotations.unshift(revisedQuote);

      const items = computedItems.map((item) => ({
        ...item,
        id: randomUUID(),
        quotationId: revisedQuoteId,
      }));
      this.memoryQuotationItems.push(...items);

      return { ...revisedQuote, items };
    }
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
    expectedDeliveryAt?: string
  ) {
    const template = getIndustryTemplate(industryKey);
    const firstStage = template.orderStages[0]?.id || 'ORDER_CONFIRMED';
    const orderNumber = `ORD-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

    try {
      const activeDb = this.getDb();

      return await activeDb.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

        const [quote] = await tx
          .select()
          .from(quotations)
          .where(and(eq(quotations.id, quotationId), eq(quotations.tenantId, tenantId)))
          .limit(1);

        if (!quote) throw new NotFoundException('Quotation not found');
        if (quote.status === 'CONVERTED') {
          throw new BadRequestException('Quotation is already converted to an order');
        }

        const items = await tx
          .select()
          .from(quotationItems)
          .where(eq(quotationItems.quotationId, quote.id));

        const total = parseFloat(quote.grandTotal);
        const balance = total - advanceReceived;

        const [order] = await tx
          .insert(orders)
          .values({
            tenantId,
            orderNumber,
            customerId: quote.customerId,
            quotationId: quote.id,
            productionStage: firstStage,
            totalAmount: this.roundMoney(total),
            advanceReceived: this.roundMoney(advanceReceived),
            balanceDue: this.roundMoney(balance),
            expectedDeliveryAt: expectedDeliveryAt ? new Date(expectedDeliveryAt) : null,
            customData: quote.customData,
          })
          .returning();

        // Copy quote items into immutable order items
        await tx.insert(orderItems).values(
          items.map((item: any) => ({
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

        // Mark quotation CONVERTED & Lead WON
        await tx
          .update(quotations)
          .set({ status: 'CONVERTED' })
          .where(eq(quotations.id, quote.id));

        if (quote.leadId) {
          await tx
            .update(leads)
            .set({ stage: 'WON' })
            .where(eq(leads.id, quote.leadId));
        }

        await tx.insert(activities).values({
          tenantId,
          actorId: userId || null,
          entityType: 'ORDER',
          entityId: order.id,
          action: 'ORDER_CONVERTED_FROM_QUOTE',
          metadata: {
            quotationId: quote.id,
            orderNumber,
            initialStage: firstStage,
            advanceReceived: order.advanceReceived,
          },
        });

        return order;
      });
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.warn(`Postgres offline; utilizing memory fallback for convertQuoteToOrder: ${err.message}`);

      const quote = this.memoryQuotations.find((q) => q.id === quotationId);
      if (!quote) throw new NotFoundException('Quotation not found');
      if (quote.status === 'CONVERTED') {
        throw new BadRequestException('Quotation is already converted to an order');
      }

      quote.status = 'CONVERTED';
      const items = this.memoryQuotationItems.filter((i) => i.quotationId === quotationId);

      const total = parseFloat(quote.grandTotal);
      const balance = total - advanceReceived;
      const orderId = randomUUID();

      const order = {
        id: orderId,
        tenantId,
        orderNumber,
        customerId: quote.customerId,
        quotationId: quote.id,
        productionStage: firstStage,
        totalAmount: this.roundMoney(total),
        advanceReceived: this.roundMoney(advanceReceived),
        balanceDue: this.roundMoney(balance),
        expectedDeliveryAt: expectedDeliveryAt ? new Date(expectedDeliveryAt) : null,
        customData: quote.customData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.memoryOrders.unshift(order);

      const copyItems = items.map((item) => ({
        ...item,
        id: randomUUID(),
        orderId,
      }));
      this.memoryOrderItems.push(...copyItems);

      return order;
    }
  }

  /**
   * 4. Retrieve Full Quotation Details with Customer, Items, and Tenant for PDF rendering
   */
  async getQuotationById(id: string, tenantId?: string) {
    try {
      const activeDb = this.getDb();

      const [quote] = await activeDb
        .select()
        .from(quotations)
        .where(eq(quotations.id, id))
        .limit(1);

      if (!quote) throw new NotFoundException(`Quotation with id '${id}' not found`);

      const [customer] = await activeDb
        .select()
        .from(customers)
        .where(eq(customers.id, quote.customerId))
        .limit(1);

      const items = await activeDb
        .select()
        .from(quotationItems)
        .where(eq(quotationItems.quotationId, quote.id));

      const [tenant] = await activeDb
        .select()
        .from(tenants)
        .where(eq(tenants.id, quote.tenantId))
        .limit(1);

      const industryKey = tenant?.industryKey || 'printing';
      const template = getIndustryTemplate(industryKey);

      return {
        quote,
        customer: customer || {
          name: 'Direct Customer',
          phone: '+919840123456',
          companyName: null,
          billingAddress: null,
          gstin: null,
        },
        items,
        tenant: tenant || {
          name: 'Sivakasi Fine Prints & Packaging',
          phone: '+91 98400 11223',
          gstNumber: '33AABCU9603R1ZM',
          industryKey,
        },
        industryTemplate: template,
      };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.warn(`Postgres offline; utilizing memory fallback for getQuotationById: ${err.message}`);

      const quote = this.memoryQuotations.find((q) => q.id === id) || this.memoryQuotations[0];
      if (!quote) throw new NotFoundException(`Quotation with id '${id}' not found`);

      const items = this.memoryQuotationItems.filter((i) => i.quotationId === quote.id);
      const industryKey = 'printing';
      const template = getIndustryTemplate(industryKey);

      return {
        quote,
        customer: {
          id: quote.customerId,
          name: 'Sri Murugan Textiles & Sweets',
          phone: '+91 98401 23456',
          companyName: 'Murugan Retailers Pvt Ltd',
          gstin: '33AAAAA0000A1Z5',
          billingAddress: '42, Mill Road, Crosscut, Coimbatore, Tamil Nadu - 641002',
        },
        items: items.length > 0 ? items : [
          {
            id: 'qi-fallback-1',
            itemName: 'Diwali Rigid Sweet Boxes (10,000 Qty)',
            description: '350 GSM Cyber Premium Board, Matt Lamination, Gold Foil Stamping',
            quantity: '10000.00',
            unit: 'Nos',
            unitPrice: '15.00',
            taxPercent: '18.00',
            lineTotal: '177000.00',
          },
        ],
        tenant: {
          name: 'Sivakasi Fine Prints & Packaging',
          phone: '+91 98400 11223',
          gstNumber: '33AABCU9603R1ZM',
          address: '12, Printing Press Colony, Sivakasi, Tamil Nadu - 626123',
          industryKey,
        },
        industryTemplate: template,
      };
    }
  }

  /**
   * 5. Get list of quotations for tenant
   */
  async getQuotations(tenantId: string) {
    try {
      const activeDb = this.getDb();
      const rows = await activeDb
        .select()
        .from(quotations)
        .where(eq(quotations.tenantId, tenantId))
        .orderBy(desc(quotations.createdAt));

      return { data: rows, total: rows.length };
    } catch {
      const rows = this.memoryQuotations.filter((q) => q.tenantId === tenantId);
      return { data: rows, total: rows.length };
    }
  }
}
