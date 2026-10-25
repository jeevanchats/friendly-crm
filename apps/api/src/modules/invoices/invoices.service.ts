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
  globalMemoryCreditNotes,
} from '../crm/memory-store';
import { CreditNotesService } from './credit-notes.service';
import { PaymentDetails } from '@friendly-crm/shared';
import { paymentFromTenantRow } from '../payments/payment-info';

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
  /**
   * Set when the order's earlier invoice was cancelled in full by a credit note: this new invoice replaces it, and the
   * order's total (which the credit note lowered) is restored when it is issued.
   */
  replaces: { id: string; invoiceNumber: string } | null;
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
  /** Total of credit notes issued against this invoice. */
  credited: string;
  /** What the invoice is worth after credit notes (grand total minus credited). */
  netTotal: string;
  /** Derived from the order's balance, not stored on the invoice. `customerCredit` is set when credit notes exceed what is owed. */
  payment: { paid: string; balanceDue: string; customerCredit: string; status: InvoicePayStatus };
}

/** CREDITED: credit notes have taken back the whole invoice. */
export type InvoicePayStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'CREDITED';

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  orderId: string;
  customerName: string;
  grandTotal: string;
  balanceDue: string;
  credited: string;
  status: InvoicePayStatus;
}

interface Ctx {
  order: any;
  items: any[];
  customer: any;
  tenant: any;
  /** The invoice that is currently in force for this order (not fully credited), if any. */
  existing: any | null;
  /** When there is none: the latest invoice, which credit notes have taken back in full. */
  reissueOf: any | null;
}

const toPaise = (v: unknown) => Math.round(Number(v) * 100);
const money = (paise: number) => (paise / 100).toFixed(2);
const stateName = (code: string) => GST_STATES[code] ?? code;
const payStatus = (netPaise: number, balancePaise: number): InvoicePayStatus =>
  netPaise <= 0 ? 'CREDITED' : balancePaise <= 0 ? 'PAID' : balancePaise >= netPaise ? 'UNPAID' : 'PARTIAL';

/**
 * Issues GST tax invoices from orders. An issued invoice is a snapshot (business, buyer and lines as they were)
 * with a gapless number per business per April-March year, and is never edited afterwards.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(private readonly creditNotes: CreditNotesService) {}

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
      replaces: a.ctx.reissueOf ? { id: a.ctx.reissueOf.id, invoiceNumber: a.ctx.reissueOf.invoiceNumber } : null,
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
      // There is no longer a database rule of one invoice per order (a cancelled one can be replaced), so two people
      // issuing the same order at once are made to take turns here instead.
      if (tx) await tx.execute(dsql`SELECT id FROM orders WHERE id = ${orderId} AND tenant_id = ${tenantId} FOR UPDATE`);
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
      if (ctx.reissueOf) {
        // The credit note that cancelled the earlier invoice lowered the order total; this invoice is worth it again.
        if (tx) {
          const [updated] = await tx
            .update(orders)
            .set({
              totalAmount: dsql`${orders.totalAmount} + ${row.amount}::numeric`,
              balanceDue: dsql`${orders.totalAmount} + ${row.amount}::numeric - ${orders.advanceReceived}`,
              updatedAt: now,
            })
            .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
            .returning();
          ctx.order = updated;
        } else {
          const o = globalMemoryOrders.find((x) => x.id === orderId && x.tenantId === tenantId);
          if (o) {
            o.totalAmount = money(toPaise(o.totalAmount) + toPaise(row.amount));
            o.balanceDue = money(toPaise(o.totalAmount) - toPaise(o.advanceReceived ?? 0));
            ctx.order = o;
          }
        }
      }
      return this.toView(row, lineRows, ctx.order, 0);
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

  /** What the business has set to be paid into (bank account and UPI ID), for the "how to pay" block of the PDF. */
  async getPaymentDetails(tenantId: string): Promise<PaymentDetails> {
    return this.withStore(tenantId, async (tx) => {
      if (tx) {
        const [row] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return paymentFromTenantRow(row);
      }
      return paymentFromTenantRow(globalMemoryTenants.get(tenantId));
    });
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
      const credited = await this.creditNotes.creditedTotals(tx, tenantId, inv.map((i) => i.id));
      return inv.map((i) => {
        const total = toPaise(i.amount);
        const creditedPaise = credited.get(i.id) ?? 0;
        const balance = toPaise(orderById.get(i.orderId)?.balanceDue ?? i.amount);
        return {
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          issuedAt: new Date(i.issuedAt).toISOString(),
          orderId: i.orderId,
          customerName: (i.buyer as InvoiceParty | null)?.name ?? '',
          grandTotal: money(total),
          balanceDue: money(Math.max(0, balance)),
          credited: money(creditedPaise),
          status: payStatus(total - creditedPaise, balance),
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
          // A replacement invoice is for what the cancelled one was for: the credit note took the order total down to nothing.
          agreedTotalPaise: ctx.reissueOf ? toPaise(ctx.reissueOf.amount) : toPaise(order.totalAmount),
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

  private toView(inv: any, lines: any[], order: any, creditedPaise: number): InvoiceView {
    const total = toPaise(inv.amount);
    const net = total - creditedPaise;
    // The order's balance already has credit notes taken off its total; negative means the customer is in credit.
    const balance = toPaise(order?.balanceDue ?? net);
    // Received = what the invoice is worth minus what is still owed. When credit notes exceed what was owed, balance is
    // negative and this comes out as the full amount the customer paid.
    const paid = Math.max(0, net - balance);
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
      credited: money(creditedPaise),
      netTotal: money(net),
      payment: { paid: money(paid), balanceDue: money(Math.max(0, balance)), customerCredit: money(Math.max(0, -balance)), status: payStatus(net, balance) },
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
    const all = await tx.select().from(invoices).where(and(eq(invoices.orderId, orderId), eq(invoices.tenantId, tenantId))).orderBy(desc(invoices.issuedAt));
    if (!customer || !tenant) throw new NotFoundException('Order not found');
    const { active, latest } = await this.pickInForce(tx, tenantId, all);
    return { order, items, customer, tenant, existing: active, reissueOf: active ? null : latest };
  }

  private loadCtxMemory(tenantId: string, orderId: string): Ctx {
    const order = globalMemoryOrders.find((o) => o.id === orderId && o.tenantId === tenantId);
    if (!order) throw new NotFoundException('Order not found');
    const customer = globalMemoryCustomers.find((c) => c.id === order.customerId && c.tenantId === tenantId);
    const tenant = globalMemoryTenants.get(tenantId) as any;
    if (!customer || !tenant) throw new NotFoundException('Order not found');
    const forced = this.pickInForceMemory(tenantId, globalMemoryInvoices.filter((i) => i.orderId === orderId && i.tenantId === tenantId));
    return {
      order,
      items: globalMemoryOrderItems.filter((i) => i.orderId === orderId && i.tenantId === tenantId),
      customer,
      tenant,
      existing: forced.existing,
      reissueOf: forced.reissueOf,
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

  /**
   * Of an order's invoices (newest first), the one in force: the newest that credit notes have not taken back in full.
   * When there is none, `latest` is the newest cancelled one (what a replacement invoice replaces).
   */
  private async pickInForce(tx: any, tenantId: string, newestFirst: any[]): Promise<{ active: any | null; latest: any | null }> {
    if (newestFirst.length === 0) return { active: null, latest: null };
    const credited = await this.creditNotes.creditedTotals(tx, tenantId, newestFirst.map((i) => i.id));
    const active = newestFirst.find((i) => toPaise(i.amount) - (credited.get(i.id) ?? 0) > 0) ?? null;
    return { active, latest: newestFirst[0] };
  }

  private pickInForceMemory(tenantId: string, invs: any[]): { existing: any | null; reissueOf: any | null } {
    const newestFirst = [...invs].sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt));
    if (newestFirst.length === 0) return { existing: null, reissueOf: null };
    const creditedOf = (id: string) => globalMemoryCreditNotes.filter((c) => c.tenantId === tenantId && c.invoiceId === id).reduce((t, c) => t + toPaise(c.amount), 0);
    const active = newestFirst.find((i) => toPaise(i.amount) - creditedOf(i.id) > 0) ?? null;
    return { existing: active, reissueOf: active ? null : newestFirst[0] };
  }

  private async readDb(tx: any, tenantId: string, by: { id?: string; orderId?: string }): Promise<InvoiceView | null> {
    let inv: any;
    if (by.id) {
      [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, by.id), eq(invoices.tenantId, tenantId))).limit(1);
    } else {
      // By order: the invoice in force, or failing that the latest cancelled one (so the screen can offer a replacement)
      const all = await tx.select().from(invoices).where(and(eq(invoices.orderId, by.orderId as string), eq(invoices.tenantId, tenantId))).orderBy(desc(invoices.issuedAt));
      const { active, latest } = await this.pickInForce(tx, tenantId, all);
      inv = active ?? latest;
    }
    if (!inv) return null;
    const lines = await tx.select().from(invoiceItems).where(and(eq(invoiceItems.invoiceId, inv.id), eq(invoiceItems.tenantId, tenantId)));
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, inv.orderId), eq(orders.tenantId, tenantId))).limit(1);
    const credited = (await this.creditNotes.creditedTotals(tx, tenantId, [inv.id])).get(inv.id) ?? 0;
    return this.toView(inv, lines, order, credited);
  }

  private async readMemory(tenantId: string, by: { id?: string; orderId?: string }): Promise<InvoiceView | null> {
    let inv: any;
    if (by.id) inv = globalMemoryInvoices.find((i) => i.tenantId === tenantId && i.id === by.id);
    else {
      const f = this.pickInForceMemory(tenantId, globalMemoryInvoices.filter((i) => i.tenantId === tenantId && i.orderId === by.orderId));
      inv = f.existing ?? f.reissueOf;
    }
    if (!inv) return null;
    const lines = globalMemoryInvoiceItems.filter((l) => l.invoiceId === inv.id && l.tenantId === tenantId);
    const order = globalMemoryOrders.find((o) => o.id === inv.orderId && o.tenantId === tenantId);
    const credited = (await this.creditNotes.creditedTotals(null, tenantId, [inv.id])).get(inv.id) ?? 0;
    return this.toView(inv, lines, order, credited);
  }
}
