import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, sql as dsql } from 'drizzle-orm';
import {
  db,
  sql,
  orders,
  orderItems,
  customers,
  tenants,
  invoices,
  invoiceItems,
  invoiceCounters,
  products,
  type InvoiceParty,
} from '@friendly-crm/db';
import {
  GST_STATES,
  GstComputation,
  computeGstInvoice,
  financialYear,
  formatInvoiceNumber,
  isValidGstin,
  isValidHsn,
  isValidStateCode,
  normalizeGstin,
  stateCodeFromGstin,
} from '@friendly-crm/shared';
import {
  globalMemoryOrders,
  globalMemoryCustomers,
  globalMemoryTenants,
  globalMemoryOrderItems,
  globalMemoryInvoices,
  globalMemoryInvoiceItems,
  globalMemoryInvoiceCounters,
  globalMemoryProducts,
} from '../crm/memory-store';

export type PlaceOfSupplySource = 'OVERRIDE' | 'CUSTOMER_GSTIN' | 'CUSTOMER_STATE' | 'DEFAULT_SUPPLIER_STATE';

export interface IssueInvoiceDto {
  /** HSN/SAC per order line, keyed by order item id. Overrides what is stored on the line. */
  hsn?: Record<string, string>;
  /** GST state code to treat as the place of supply instead of the customer's own. */
  placeOfSupply?: string;
}

export interface PreparedLine {
  orderItemId: string;
  itemName: string;
  description: string | null;
  hsnCode: string | null;
  /** HSN last used for an item with this name in this business, offered when the line has none. */
  suggestedHsn: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxPercent: string;
}

export interface InvoicePreparation {
  orderId: string;
  orderNumber: string;
  /** Reasons the invoice cannot be issued yet. Empty means it can. */
  problems: string[];
  existingInvoice: { id: string; invoiceNumber: string } | null;
  supplier: InvoiceParty | null;
  buyer: InvoiceParty;
  placeOfSupply: { stateCode: string; stateName: string; source: PlaceOfSupplySource } | null;
  lines: PreparedLine[];
  /** Totals as they would be issued; null while there are problems. */
  preview: InvoiceTotals | null;
}

export interface InvoiceTotals {
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  roundOff: string;
  grandTotal: string;
}

export interface InvoiceLineView {
  lineNo: number;
  itemName: string;
  description: string | null;
  hsnCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  taxPercent: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  lineTotal: string;
}

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  financialYear: string;
  issuedAt: string;
  orderId: string;
  orderNumber: string;
  supplyType: 'INTRA' | 'INTER';
  placeOfSupply: { stateCode: string; stateName: string };
  reverseCharge: false;
  supplier: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLineView[];
  totals: InvoiceTotals;
  /** Derived from the order's balance, not stored on the invoice. */
  payment: { paid: string; balanceDue: string; status: 'UNPAID' | 'PARTIAL' | 'PAID' };
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  orderId: string;
  customerName: string;
  grandTotal: string;
  balanceDue: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
}

interface Ctx {
  order: any;
  items: any[];
  customer: any;
  tenant: any;
  existing: any | null;
}

const toPaise = (v: unknown) => Math.round(Number(v) * 100);
const money = (paise: number) => (paise / 100).toFixed(2);
const stateName = (code: string) => GST_STATES[code] ?? code;
const payStatus = (totalPaise: number, balancePaise: number): 'UNPAID' | 'PARTIAL' | 'PAID' =>
  balancePaise <= 0 ? 'PAID' : balancePaise >= totalPaise ? 'UNPAID' : 'PARTIAL';

/**
 * Issues GST tax invoices from orders. An issued invoice is a snapshot (business, buyer and lines as they were)
 * with a gapless number per business per April-March year, and is never edited afterwards.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  // ---------------------------------------------------------------- public API

  /** Everything the "issue invoice" screen needs: what is missing, what will be charged, and which HSN to suggest. */
  async prepare(tenantId: string, orderId: string, dto: IssueInvoiceDto = {}): Promise<InvoicePreparation> {
    const run = async (tx: any | null) => {
      const ctx = tx ? await this.loadCtxDb(tx, tenantId, orderId) : this.loadCtxMemory(tenantId, orderId);
      const suggest = tx ? (n: string) => this.suggestHsnDb(tx, tenantId, n) : (n: string) => this.suggestHsnMemory(tenantId, n);
      const suggestions = new Map<string, string | null>();
      for (const it of ctx.items) {
        if (!it.hsnCode) suggestions.set(it.id, await suggest(it.itemName));
      }
      return this.assess(ctx, dto, suggestions);
    };
    const a = await this.withStore(tenantId, run);
    return {
      orderId,
      orderNumber: a.ctx.order.orderNumber,
      problems: a.problems,
      existingInvoice: a.ctx.existing ? { id: a.ctx.existing.id, invoiceNumber: a.ctx.existing.invoiceNumber } : null,
      supplier: a.supplier,
      buyer: a.buyer,
      placeOfSupply: a.placeOfSupply
        ? { stateCode: a.placeOfSupply.code, stateName: stateName(a.placeOfSupply.code), source: a.placeOfSupply.source }
        : null,
      lines: a.lines,
      preview: a.computation ? this.totals(a.computation) : null,
    };
  }

  async issue(tenantId: string, actorId: string | null, orderId: string, dto: IssueInvoiceDto = {}, now = new Date()): Promise<InvoiceView> {
    const run = async (tx: any | null) => {
      const ctx = tx ? await this.loadCtxDb(tx, tenantId, orderId) : this.loadCtxMemory(tenantId, orderId);
      if (ctx.existing) {
        throw new ConflictException({
          statusCode: 409,
          error: 'InvoiceExists',
          message: `Order ${ctx.order.orderNumber} already has invoice ${ctx.existing.invoiceNumber}.`,
          invoiceId: ctx.existing.id,
          invoiceNumber: ctx.existing.invoiceNumber,
        });
      }
      const a = this.assess(ctx, dto, new Map());
      if (a.problems.length > 0 || !a.computation || !a.supplier || !a.placeOfSupply) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'InvoiceNotReady',
          message: 'This invoice cannot be issued yet.',
          problems: a.problems,
        });
      }
      const fy = financialYear(now);
      const serial = tx ? await this.nextSerialDb(tx, tenantId, fy) : this.nextSerialMemory(tenantId, fy);
      let invoiceNumber: string;
      try {
        invoiceNumber = formatInvoiceNumber(fy, serial);
      } catch (err: any) {
        throw new UnprocessableEntityException({ statusCode: 422, error: 'InvoiceNumberExhausted', message: err.message });
      }
      const row = {
        id: randomUUID(),
        tenantId,
        invoiceNumber,
        financialYear: fy,
        orderId,
        customerId: ctx.order.customerId,
        supplyType: a.computation.supplyType,
        placeOfSupply: a.placeOfSupply.code,
        taxableValue: money(a.computation.taxablePaise),
        cgstAmount: money(a.computation.cgstPaise),
        sgstAmount: money(a.computation.sgstPaise),
        igstAmount: money(a.computation.igstPaise),
        roundOff: money(a.computation.roundOffPaise),
        amount: money(a.computation.grandTotalPaise),
        supplier: a.supplier,
        buyer: a.buyer,
        issuedById: actorId,
        issuedAt: now,
      };
      const lineRows = a.computation.lines.map((l, i) => ({
        id: randomUUID(),
        tenantId,
        invoiceId: row.id,
        lineNo: l.lineNo,
        itemName: l.itemName,
        description: l.description ?? null,
        hsnCode: l.hsnCode,
        quantity: String(a.lines[i].quantity),
        unit: l.unit,
        unitPrice: a.lines[i].unitPrice,
        taxPercent: a.lines[i].taxPercent,
        taxableValue: money(l.taxablePaise),
        cgstAmount: money(l.cgstPaise),
        sgstAmount: money(l.sgstPaise),
        igstAmount: money(l.igstPaise),
        lineTotal: money(l.totalPaise),
      }));
      const hsnByItem = new Map(a.lines.map((l) => [l.orderItemId, l.hsnCode as string]));

      if (tx) {
        await tx.insert(invoices).values(row);
        await tx.insert(invoiceItems).values(lineRows);
        // Remember the HSN on the order line so the next invoice for this item starts filled in.
        for (const it of ctx.items) {
          const h = hsnByItem.get(it.id);
          if (h && it.hsnCode !== h) {
            await tx.update(orderItems).set({ hsnCode: h }).where(and(eq(orderItems.id, it.id), eq(orderItems.tenantId, tenantId)));
          }
        }
      } else {
        globalMemoryInvoices.unshift({ ...row, status: 'UNPAID', paidAmount: '0.00', createdAt: now, updatedAt: now });
        globalMemoryInvoiceItems.push(...lineRows);
        for (const it of ctx.items) {
          const h = hsnByItem.get(it.id);
          if (h) it.hsnCode = h;
        }
      }
      return this.toView(row, lineRows, ctx.order);
    };

    try {
      return await this.withStore(tenantId, run);
    } catch (err: any) {
      // Two people issuing the same order at once: the unique (tenant, order) index rejects the loser.
      if (err?.code === '23505') {
        throw new ConflictException({ statusCode: 409, error: 'InvoiceExists', message: 'This order was just invoiced by someone else.' });
      }
      throw err;
    }
  }

  async getById(tenantId: string, invoiceId: string): Promise<InvoiceView> {
    const v = await this.withStore(tenantId, async (tx) => (tx ? this.readDb(tx, tenantId, { id: invoiceId }) : this.readMemory(tenantId, { id: invoiceId })));
    if (!v) throw new NotFoundException('Invoice not found');
    return v;
  }

  async getByOrder(tenantId: string, orderId: string): Promise<InvoiceView> {
    const v = await this.withStore(tenantId, async (tx) => (tx ? this.readDb(tx, tenantId, { orderId }) : this.readMemory(tenantId, { orderId })));
    if (!v) throw new NotFoundException('This order has no invoice yet');
    return v;
  }

  async list(tenantId: string, limit = 100): Promise<{ data: InvoiceSummary[] }> {
    const data = await this.withStore(tenantId, async (tx): Promise<InvoiceSummary[]> => {
      let inv: any[];
      let orderById: Map<string, any>;
      if (tx) {
        inv = await tx.select().from(invoices).where(eq(invoices.tenantId, tenantId)).orderBy(desc(invoices.issuedAt)).limit(limit);
        const ords = inv.length
          ? await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), inArray(orders.id, inv.map((i: any) => i.orderId))))
          : [];
        orderById = new Map(ords.map((o: any) => [o.id, o]));
      } else {
        inv = globalMemoryInvoices
          .filter((i) => i.tenantId === tenantId)
          .sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))
          .slice(0, limit);
        orderById = new Map(globalMemoryOrders.filter((o) => o.tenantId === tenantId).map((o) => [o.id, o]));
      }
      return inv.map((i) => {
        const total = toPaise(i.amount);
        const balance = toPaise(orderById.get(i.orderId)?.balanceDue ?? i.amount);
        return {
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          issuedAt: new Date(i.issuedAt).toISOString(),
          orderId: i.orderId,
          customerName: (i.buyer as InvoiceParty | null)?.name ?? '',
          grandTotal: money(total),
          balanceDue: money(Math.max(0, balance)),
          status: payStatus(total, balance),
        };
      });
    });
    return { data };
  }

  // ---------------------------------------------------------------- assessment (pure)

  private assess(ctx: Ctx, dto: IssueInvoiceDto, suggestions: Map<string, string | null>) {
    const problems: string[] = [];
    const { order, items, customer, tenant } = ctx;

    if (order.productionStage === 'CANCELLED') problems.push('This order is cancelled.');
    if (items.length === 0) problems.push('This order has no line items.');

    // Supplier: the business's own GST registration
    const gstin = tenant.gstNumber ? normalizeGstin(String(tenant.gstNumber)) : '';
    const supplierState = isValidGstin(gstin) ? stateCodeFromGstin(gstin) : null;
    if (!gstin) problems.push('Add your business GSTIN in Settings before issuing GST invoices.');
    else if (!supplierState) problems.push('The business GSTIN in Settings is not valid.');
    const supplierAddress = (tenant.address ?? '').trim();
    if (!supplierAddress) problems.push('Add your business address in Settings.');
    const supplier: InvoiceParty | null =
      supplierState && gstin
        ? {
            name: (tenant.legalName ?? '').trim() || tenant.name,
            gstin,
            address: supplierAddress || null,
            stateCode: supplierState,
            phone: tenant.phone ?? null,
          }
        : null;

    // Buyer
    const buyerGstin = customer.gstin ? normalizeGstin(String(customer.gstin)) : null;
    if (buyerGstin && !isValidGstin(buyerGstin)) {
      problems.push(`${customer.name}'s GSTIN is not valid. Correct it on the customer, or clear it if they are unregistered.`);
    }
    const buyerGstinState = buyerGstin && isValidGstin(buyerGstin) ? stateCodeFromGstin(buyerGstin) : null;
    const buyerState = buyerGstinState ?? (isValidStateCode(customer.stateCode) ? customer.stateCode : null);
    const buyer: InvoiceParty = {
      name: (customer.companyName ?? '').trim() || customer.name,
      gstin: buyerGstin && isValidGstin(buyerGstin) ? buyerGstin : null,
      address: (customer.billingAddress ?? '').trim() || null,
      stateCode: buyerState,
      phone: customer.whatsappNumber || customer.phone || null,
    };

    // Place of supply
    let placeOfSupply: { code: string; source: PlaceOfSupplySource } | null = null;
    if (dto.placeOfSupply !== undefined && dto.placeOfSupply !== '') {
      if (isValidStateCode(dto.placeOfSupply)) placeOfSupply = { code: dto.placeOfSupply, source: 'OVERRIDE' };
      else problems.push('The place of supply is not a valid GST state code.');
    } else if (buyerGstinState) placeOfSupply = { code: buyerGstinState, source: 'CUSTOMER_GSTIN' };
    else if (buyerState) placeOfSupply = { code: buyerState, source: 'CUSTOMER_STATE' };
    else if (supplierState) placeOfSupply = { code: supplierState, source: 'DEFAULT_SUPPLIER_STATE' };

    // Lines
    const lines: PreparedLine[] = items.map((it: any) => {
      const override = dto.hsn?.[it.id];
      const hsn = (override ?? it.hsnCode ?? '').toString().trim();
      if (override !== undefined && !isValidHsn(hsn)) problems.push(`HSN/SAC "${override}" for "${it.itemName}" must be 4, 6 or 8 digits.`);
      else if (!hsn) problems.push(`Enter an HSN/SAC code for "${it.itemName}".`);
      else if (!isValidHsn(hsn)) problems.push(`The HSN/SAC code on "${it.itemName}" must be 4, 6 or 8 digits.`);
      return {
        orderItemId: it.id,
        itemName: it.itemName,
        description: it.description ?? null,
        hsnCode: isValidHsn(hsn) ? hsn : null,
        suggestedHsn: !hsn ? suggestions.get(it.id) ?? null : null,
        quantity: String(it.quantity),
        unit: it.unit,
        unitPrice: String(it.unitPrice),
        taxPercent: String(it.taxPercent),
      };
    });

    let computation: GstComputation | null = null;
    if (problems.length === 0 && supplierState && placeOfSupply) {
      try {
        computation = computeGstInvoice({
          lines: lines.map((l) => ({
            itemName: l.itemName,
            description: l.description,
            hsnCode: l.hsnCode as string,
            quantity: Number(l.quantity),
            unit: l.unit,
            unitPrice: Number(l.unitPrice),
            taxPercent: Number(l.taxPercent),
          })),
          agreedTotalPaise: toPaise(order.totalAmount),
          supplierStateCode: supplierState,
          placeOfSupplyStateCode: placeOfSupply.code,
        });
      } catch (err: any) {
        problems.push(err.message);
      }
    }

    return { ctx, problems, supplier, buyer, placeOfSupply, lines, computation };
  }

  private totals(c: GstComputation): InvoiceTotals {
    return {
      taxableValue: money(c.taxablePaise),
      cgst: money(c.cgstPaise),
      sgst: money(c.sgstPaise),
      igst: money(c.igstPaise),
      roundOff: money(c.roundOffPaise),
      grandTotal: money(c.grandTotalPaise),
    };
  }

  private toView(inv: any, lines: any[], order: any): InvoiceView {
    const total = toPaise(inv.amount);
    const balance = toPaise(order?.balanceDue ?? inv.amount);
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      financialYear: inv.financialYear,
      issuedAt: new Date(inv.issuedAt).toISOString(),
      orderId: inv.orderId,
      orderNumber: order?.orderNumber ?? '',
      supplyType: inv.supplyType,
      placeOfSupply: { stateCode: inv.placeOfSupply, stateName: stateName(inv.placeOfSupply) },
      reverseCharge: false,
      supplier: inv.supplier,
      buyer: inv.buyer,
      lines: [...lines]
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((l) => ({
          lineNo: l.lineNo,
          itemName: l.itemName,
          description: l.description ?? null,
          hsnCode: l.hsnCode,
          quantity: String(l.quantity),
          unit: l.unit,
          unitPrice: String(l.unitPrice),
          taxPercent: String(l.taxPercent),
          taxableValue: String(l.taxableValue),
          cgst: String(l.cgstAmount),
          sgst: String(l.sgstAmount),
          igst: String(l.igstAmount),
          lineTotal: String(l.lineTotal),
        })),
      totals: {
        taxableValue: String(inv.taxableValue),
        cgst: String(inv.cgstAmount),
        sgst: String(inv.sgstAmount),
        igst: String(inv.igstAmount),
        roundOff: String(inv.roundOff),
        grandTotal: String(inv.amount),
      },
      payment: { paid: money(Math.max(0, total - Math.max(0, balance))), balanceDue: money(Math.max(0, balance)), status: payStatus(total, balance) },
    };
  }

  // ---------------------------------------------------------------- storage

  /**
   * Runs `fn` inside a tenant-scoped transaction on Postgres, or with `null` on the in-memory store.
   * The memory fallback exists for local development without a database. In production a database failure
   * must surface as an error: a tax invoice number must never be issued into memory and then vanish.
   */
  private async withStore<T>(tenantId: string, fn: (tx: any | null) => Promise<T>): Promise<T> {
    if (db && typeof db.transaction === 'function') {
      try {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          return fn(tx);
        });
      } catch (err: any) {
        if (err instanceof HttpException || err?.code === '23505') throw err;
        if (process.env.NODE_ENV === 'production') {
          this.logger.error(`Invoice storage failed: ${err.message}`);
          throw new ServiceUnavailableException('Invoices are temporarily unavailable. Please try again.');
        }
        this.logger.warn(`Postgres offline; using the in-memory invoice store: ${err.message}`);
      }
    }
    return fn(null);
  }

  private async loadCtxDb(tx: any, tenantId: string, orderId: string): Promise<Ctx> {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId))).limit(1);
    if (!order) throw new NotFoundException('Order not found');
    const items = await tx.select().from(orderItems).where(and(eq(orderItems.orderId, orderId), eq(orderItems.tenantId, tenantId)));
    const [customer] = await tx.select().from(customers).where(and(eq(customers.id, order.customerId), eq(customers.tenantId, tenantId))).limit(1);
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const [existing] = await tx.select().from(invoices).where(and(eq(invoices.orderId, orderId), eq(invoices.tenantId, tenantId))).limit(1);
    if (!customer || !tenant) throw new NotFoundException('Order not found');
    return { order, items, customer, tenant, existing: existing ?? null };
  }

  private loadCtxMemory(tenantId: string, orderId: string): Ctx {
    const order = globalMemoryOrders.find((o) => o.id === orderId && o.tenantId === tenantId);
    if (!order) throw new NotFoundException('Order not found');
    const customer = globalMemoryCustomers.find((c) => c.id === order.customerId && c.tenantId === tenantId);
    const tenant = globalMemoryTenants.get(tenantId) as any;
    if (!customer || !tenant) throw new NotFoundException('Order not found');
    return {
      order,
      items: globalMemoryOrderItems.filter((i) => i.orderId === orderId && i.tenantId === tenantId),
      customer,
      tenant,
      existing: globalMemoryInvoices.find((i) => i.orderId === orderId && i.tenantId === tenantId) ?? null,
    };
  }

  /** Atomically takes the next serial. Held until the issuing transaction commits, so numbers have no gaps. */
  private async nextSerialDb(tx: any, tenantId: string, fy: string): Promise<number> {
    const [row] = await tx
      .insert(invoiceCounters)
      .values({ tenantId, financialYear: fy, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [invoiceCounters.tenantId, invoiceCounters.financialYear],
        set: { lastNumber: dsql`${invoiceCounters.lastNumber} + 1` },
      })
      .returning({ n: invoiceCounters.lastNumber });
    return row.n;
  }

  private nextSerialMemory(tenantId: string, fy: string): number {
    const key = `${tenantId}:${fy}`;
    const n = (globalMemoryInvoiceCounters.get(key) ?? 0) + 1;
    globalMemoryInvoiceCounters.set(key, n);
    return n;
  }

  private async suggestHsnDb(tx: any, tenantId: string, itemName: string): Promise<string | null> {
    // The product master is the deliberate source: use its HSN first.
    const [master] = await tx
      .select({ hsn: products.hsnCode })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true), dsql`lower(${products.name}) = lower(${itemName})`, dsql`${products.hsnCode} is not null`))
      .limit(1);
    if (master?.hsn) return master.hsn;
    const rows = await tx
      .select({ hsn: invoiceItems.hsnCode })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(and(eq(invoiceItems.tenantId, tenantId), dsql`lower(${invoiceItems.itemName}) = lower(${itemName})`))
      .orderBy(desc(invoices.issuedAt))
      .limit(1);
    if (rows[0]?.hsn) return rows[0].hsn;
    const fromOrders = await tx
      .select({ hsn: orderItems.hsnCode })
      .from(orderItems)
      .where(and(eq(orderItems.tenantId, tenantId), dsql`lower(${orderItems.itemName}) = lower(${itemName})`, dsql`${orderItems.hsnCode} is not null`))
      .limit(1);
    return fromOrders[0]?.hsn ?? null;
  }

  private async suggestHsnMemory(tenantId: string, itemName: string): Promise<string | null> {
    const n = itemName.toLowerCase();
    const master = globalMemoryProducts.find((p) => p.tenantId === tenantId && p.isActive !== false && p.hsnCode && String(p.name).toLowerCase() === n);
    if (master) return master.hsnCode;
    const inv = globalMemoryInvoiceItems.find((i) => i.tenantId === tenantId && String(i.itemName).toLowerCase() === n);
    if (inv?.hsnCode) return inv.hsnCode;
    return globalMemoryOrderItems.find((i) => i.tenantId === tenantId && i.hsnCode && String(i.itemName).toLowerCase() === n)?.hsnCode ?? null;
  }

  private async readDb(tx: any, tenantId: string, by: { id?: string; orderId?: string }): Promise<InvoiceView | null> {
    const cond = by.id ? eq(invoices.id, by.id) : eq(invoices.orderId, by.orderId as string);
    const [inv] = await tx.select().from(invoices).where(and(cond, eq(invoices.tenantId, tenantId))).limit(1);
    if (!inv) return null;
    const lines = await tx.select().from(invoiceItems).where(and(eq(invoiceItems.invoiceId, inv.id), eq(invoiceItems.tenantId, tenantId)));
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, inv.orderId), eq(orders.tenantId, tenantId))).limit(1);
    return this.toView(inv, lines, order);
  }

  private async readMemory(tenantId: string, by: { id?: string; orderId?: string }): Promise<InvoiceView | null> {
    const inv = globalMemoryInvoices.find((i) => i.tenantId === tenantId && (by.id ? i.id === by.id : i.orderId === by.orderId));
    if (!inv) return null;
    const lines = globalMemoryInvoiceItems.filter((l) => l.invoiceId === inv.id && l.tenantId === tenantId);
    const order = globalMemoryOrders.find((o) => o.id === inv.orderId && o.tenantId === tenantId);
    return this.toView(inv, lines, order);
  }
}
