import {
  BadRequestException,
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
  invoices,
  invoiceItems,
  creditNotes,
  creditNoteItems,
  creditNoteCounters,
  type InvoiceParty,
} from '@friendly-crm/db';
import {
  CREDIT_NOTE_REASONS,
  CREDIT_NOTE_REASON_LABELS,
  CreditNoteReason,
  CreditableLine,
  CreditRequestLine,
  GST_STATES,
  computeCreditNote,
  financialYear,
  formatCreditNoteNumber,
  fullCreditRequests,
  remainingOf,
} from '@friendly-crm/shared';
import {
  globalMemoryOrders,
  globalMemoryInvoices,
  globalMemoryInvoiceItems,
  globalMemoryCreditNotes,
  globalMemoryCreditNoteItems,
  globalMemoryCreditNoteCounters,
} from '../crm/memory-store';

export interface IssueCreditNoteDto {
  reason?: string;
  note?: string;
  /** Credit everything still left on the invoice (a cancellation). */
  full?: boolean;
  /** Work out the credit note without issuing it: nothing is saved and no number is used. */
  dryRun?: boolean;
  lines?: Array<{ lineNo?: unknown; quantity?: unknown; taxableAmount?: unknown }>;
}

export interface CreditNoteLineView {
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

export interface CreditNoteView {
  id: string;
  creditNoteNumber: string;
  financialYear: string;
  issuedAt: string;
  invoice: { id: string; invoiceNumber: string; issuedAt: string };
  orderId: string;
  orderNumber: string;
  reason: CreditNoteReason;
  reasonLabel: string;
  reasonNote: string | null;
  supplyType: 'INTRA' | 'INTER';
  placeOfSupply: { stateCode: string; stateName: string };
  supplier: InvoiceParty;
  buyer: InvoiceParty;
  lines: CreditNoteLineView[];
  totals: { taxableValue: string; cgst: string; sgst: string; igst: string; roundOff: string; grandTotal: string };
  /** After issuing: what the order's balance now is. Negative means the customer is in credit. */
  orderBalanceAfter?: string;
}

export interface CreditNoteSummary {
  id: string;
  creditNoteNumber: string;
  issuedAt: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  reason: CreditNoteReason;
  reasonLabel: string;
  grandTotal: string;
}

export interface CreditablePreparation {
  invoice: { id: string; invoiceNumber: string; issuedAt: string; orderId: string; orderNumber: string; customerName: string; total: string };
  supplyType: 'INTRA' | 'INTER';
  lines: Array<{
    lineNo: number;
    itemName: string;
    hsnCode: string;
    unit: string;
    unitPrice: string;
    taxPercent: string;
    quantity: string;
    taxableValue: string;
    remainingQuantity: string;
    remainingTaxableValue: string;
    remainingTotal: string;
  }>;
  creditedTotal: string;
  remainingTotal: string;
  /** The order's current balance: what the customer still owes (negative: they are in credit). */
  orderBalance: string;
  creditNotes: CreditNoteSummary[];
}

const toPaise = (v: unknown) => Math.round(Number(v) * 100);
const money = (paise: number) => (paise / 100).toFixed(2);
const stateName = (code: string) => GST_STATES[code] ?? code;

interface Loaded {
  inv: any;
  lines: any[];
  order: any;
  /** invoice_item_id -> already credited */
  credited: Map<string, { qty: number; taxable: number; cgst: number; sgst: number; igst: number }>;
  creditedRoundOff: number;
}

/**
 * GST credit notes against issued invoices. A credit note is a snapshot with a gapless number of its own per
 * business per April-March year and is never edited afterwards. Issuing one lowers the order's total (and so
 * its balance) by the note's amount; when the invoice was already paid the balance goes negative, which means
 * the customer is in credit with you.
 */
@Injectable()
export class CreditNotesService {
  private readonly logger = new Logger(CreditNotesService.name);

  // ---------------------------------------------------------------- public API

  /** What can still be credited on an invoice, and the credit notes already issued. */
  async prepare(tenantId: string, invoiceId: string): Promise<CreditablePreparation> {
    return this.withStore(tenantId, async (tx) => {
      const L = tx ? await this.loadDb(tx, tenantId, invoiceId) : this.loadMemory(tenantId, invoiceId);
      const notes = await this.summaries(tx, tenantId, invoiceId);
      const creditable = this.creditableLines(L);
      const creditedPaise = notes.reduce((s, n) => s + toPaise(n.grandTotal), 0);
      return {
        invoice: {
          id: L.inv.id,
          invoiceNumber: L.inv.invoiceNumber,
          issuedAt: new Date(L.inv.issuedAt).toISOString(),
          orderId: L.inv.orderId,
          orderNumber: L.order?.orderNumber ?? '',
          customerName: (L.inv.buyer as InvoiceParty | null)?.name ?? '',
          total: String(L.inv.amount),
        },
        supplyType: L.inv.supplyType,
        lines: creditable.map((c) => {
          const rem = remainingOf(c);
          return {
            lineNo: c.lineNo,
            itemName: c.itemName,
            hsnCode: c.hsnCode,
            unit: c.unit,
            unitPrice: String(c.unitPrice),
            taxPercent: String(c.taxPercent),
            quantity: String(c.quantity),
            taxableValue: money(c.taxablePaise),
            remainingQuantity: String(rem.quantity),
            remainingTaxableValue: money(rem.taxablePaise),
            remainingTotal: money(rem.taxablePaise + rem.cgstPaise + rem.sgstPaise + rem.igstPaise),
          };
        }),
        creditedTotal: money(creditedPaise),
        remainingTotal: money(Math.max(0, toPaise(L.inv.amount) - creditedPaise)),
        orderBalance: String(L.order?.balanceDue ?? '0.00'),
        creditNotes: notes,
      };
    });
  }

  async issue(tenantId: string, actorId: string | null, invoiceId: string, dto: IssueCreditNoteDto, now = new Date()): Promise<CreditNoteView> {
    const reason = this.parseReason(dto);
    const note = typeof dto?.note === 'string' ? dto.note.trim() : '';
    if (note.length > 300) throw new BadRequestException('The note can be at most 300 characters.');
    if (reason === 'OTHER' && !note) throw new BadRequestException('Say what the credit note is for in the note.');

    return this.withStore(tenantId, async (tx) => {
      // Two people crediting the same invoice at once would both see the same "remaining": serialise on the order row.
      if (tx) {
        const [inv0] = await tx.select({ orderId: invoices.orderId }).from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
        if (!inv0) throw new NotFoundException('Invoice not found');
        await tx.execute(dsql`SELECT id FROM orders WHERE id = ${inv0.orderId} AND tenant_id = ${tenantId} FOR UPDATE`);
      }
      const L = tx ? await this.loadDb(tx, tenantId, invoiceId) : this.loadMemory(tenantId, invoiceId);
      const lines = this.creditableLines(L);

      let requests: CreditRequestLine[];
      if (dto?.full === true) {
        requests = fullCreditRequests(lines);
        if (requests.length === 0) {
          throw new ConflictException({ statusCode: 409, error: 'AlreadyCredited', message: `Invoice ${L.inv.invoiceNumber} is already fully credited.` });
        }
      } else {
        requests = this.parseRequests(dto?.lines);
      }

      let computation;
      try {
        computation = computeCreditNote({
          supplyType: L.inv.supplyType,
          lines,
          requests,
          invoiceRoundOffPaise: toPaise(L.inv.roundOff ?? 0),
          creditedRoundOffPaise: L.creditedRoundOff,
        });
      } catch (err: any) {
        throw new UnprocessableEntityException({ statusCode: 422, error: 'CreditNoteInvalid', message: err.message });
      }

      const fy = financialYear(now);
      const preview = dto?.dryRun === true;
      let creditNoteNumber = '(preview)';
      if (!preview) {
        const serial = tx ? await this.nextSerialDb(tx, tenantId, fy) : this.nextSerialMemory(tenantId, fy);
        try {
          creditNoteNumber = formatCreditNoteNumber(fy, serial);
        } catch (err: any) {
          throw new UnprocessableEntityException({ statusCode: 422, error: 'CreditNoteNumberExhausted', message: err.message });
        }
      }

      const itemByLine = new Map<number, any>(L.lines.map((l) => [l.lineNo, l]));
      const row = {
        id: randomUUID(),
        tenantId,
        creditNoteNumber,
        financialYear: fy,
        invoiceId,
        orderId: L.inv.orderId,
        customerId: L.inv.customerId,
        reason,
        reasonNote: note || null,
        supplyType: L.inv.supplyType,
        placeOfSupply: L.inv.placeOfSupply,
        taxableValue: money(computation.taxablePaise),
        cgstAmount: money(computation.cgstPaise),
        sgstAmount: money(computation.sgstPaise),
        igstAmount: money(computation.igstPaise),
        roundOff: money(computation.roundOffPaise),
        amount: money(computation.totalPaise),
        supplier: L.inv.supplier,
        buyer: L.inv.buyer,
        issuedById: actorId,
        issuedAt: now,
      };
      const itemRows = computation.lines.map((l) => ({
        id: randomUUID(),
        tenantId,
        creditNoteId: row.id,
        invoiceItemId: itemByLine.get(l.lineNo).id,
        lineNo: l.lineNo,
        itemName: l.itemName,
        description: l.description,
        hsnCode: l.hsnCode,
        quantity: String(l.quantity),
        unit: l.unit,
        unitPrice: String(l.unitPrice),
        taxPercent: String(l.taxPercent),
        taxableValue: money(l.taxablePaise),
        cgstAmount: money(l.cgstPaise),
        sgstAmount: money(l.sgstPaise),
        igstAmount: money(l.igstPaise),
        lineTotal: money(l.totalPaise),
      }));

      if (preview) {
        const view = this.toView(row, itemRows, L.inv, L.order);
        view.orderBalanceAfter = money(toPaise(L.order?.balanceDue ?? 0) - computation.totalPaise);
        return view;
      }

      let orderBalanceAfter: string;
      if (tx) {
        await tx.insert(creditNotes).values(row);
        await tx.insert(creditNoteItems).values(itemRows);
        // The order is now worth less by the amount credited; its balance follows (negative = customer in credit).
        const [updated] = await tx
          .update(orders)
          .set({
            totalAmount: dsql`${orders.totalAmount} - ${row.amount}::numeric`,
            balanceDue: dsql`${orders.totalAmount} - ${row.amount}::numeric - ${orders.advanceReceived}`,
            updatedAt: now,
          })
          .where(and(eq(orders.id, L.inv.orderId), eq(orders.tenantId, tenantId)))
          .returning({ balanceDue: orders.balanceDue });
        orderBalanceAfter = String(updated.balanceDue);
      } else {
        globalMemoryCreditNotes.unshift({ ...row });
        globalMemoryCreditNoteItems.push(...itemRows);
        const o = globalMemoryOrders.find((x) => x.id === L.inv.orderId && x.tenantId === tenantId);
        if (o) {
          o.totalAmount = money(toPaise(o.totalAmount) - computation.totalPaise);
          o.balanceDue = money(toPaise(o.totalAmount) - toPaise(o.advanceReceived ?? 0));
          orderBalanceAfter = o.balanceDue;
        } else orderBalanceAfter = '0.00';
      }
      const view = this.toView(row, itemRows, L.inv, L.order);
      view.orderBalanceAfter = orderBalanceAfter;
      return view;
    });
  }

  async getById(tenantId: string, id: string): Promise<CreditNoteView> {
    const v = await this.withStore(tenantId, async (tx) => {
      let cn: any;
      let items: any[];
      let inv: any;
      let order: any;
      if (tx) {
        [cn] = await tx.select().from(creditNotes).where(and(eq(creditNotes.id, id), eq(creditNotes.tenantId, tenantId))).limit(1);
        if (!cn) return null;
        items = await tx.select().from(creditNoteItems).where(and(eq(creditNoteItems.creditNoteId, id), eq(creditNoteItems.tenantId, tenantId)));
        [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, cn.invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
        [order] = await tx.select().from(orders).where(and(eq(orders.id, cn.orderId), eq(orders.tenantId, tenantId))).limit(1);
      } else {
        cn = globalMemoryCreditNotes.find((c) => c.id === id && c.tenantId === tenantId);
        if (!cn) return null;
        items = globalMemoryCreditNoteItems.filter((i) => i.creditNoteId === id);
        inv = globalMemoryInvoices.find((i) => i.id === cn.invoiceId && i.tenantId === tenantId);
        order = globalMemoryOrders.find((o) => o.id === cn.orderId && o.tenantId === tenantId);
      }
      return this.toView(cn, items, inv, order);
    });
    if (!v) throw new NotFoundException('Credit note not found');
    return v;
  }

  async list(tenantId: string, opts: { invoiceId?: string; limit?: number } = {}): Promise<{ data: CreditNoteSummary[] }> {
    const data = await this.withStore(tenantId, (tx) => this.summaries(tx, tenantId, opts.invoiceId, opts.limit ?? 100));
    return { data };
  }

  /**
   * Total credited per invoice, in paise. Used by invoices to show what is left of them.
   * Runs inside the caller's store, so pass the same `tx` the caller is using (null for the memory store).
   */
  async creditedTotals(tx: any | null, tenantId: string, invoiceIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (invoiceIds.length === 0) return out;
    if (tx) {
      const rows = await tx
        .select({ invoiceId: creditNotes.invoiceId, total: dsql<string>`sum(${creditNotes.amount})` })
        .from(creditNotes)
        .where(and(eq(creditNotes.tenantId, tenantId), inArray(creditNotes.invoiceId, invoiceIds)))
        .groupBy(creditNotes.invoiceId);
      for (const r of rows) out.set(r.invoiceId, toPaise(r.total));
    } else {
      for (const c of globalMemoryCreditNotes) {
        if (c.tenantId === tenantId && invoiceIds.includes(c.invoiceId)) out.set(c.invoiceId, (out.get(c.invoiceId) ?? 0) + toPaise(c.amount));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- helpers

  private parseReason(dto: IssueCreditNoteDto): CreditNoteReason {
    if (dto?.reason === undefined || dto.reason === '') {
      if (dto?.full === true) return 'CANCELLATION';
      throw new BadRequestException(`Choose a reason: ${CREDIT_NOTE_REASONS.join(', ')}.`);
    }
    if (!(CREDIT_NOTE_REASONS as readonly string[]).includes(dto.reason)) {
      throw new BadRequestException(`Reason must be one of: ${CREDIT_NOTE_REASONS.join(', ')}.`);
    }
    return dto.reason as CreditNoteReason;
  }

  private parseRequests(raw: IssueCreditNoteDto['lines']): CreditRequestLine[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('Choose at least one line to credit, or credit the whole invoice.');
    if (raw.length > 200) throw new BadRequestException('Too many lines.');
    return raw.map((r, i) => {
      const lineNo = Number(r?.lineNo);
      if (!Number.isInteger(lineNo) || lineNo < 1) throw new BadRequestException(`Row ${i + 1}: line number is missing.`);
      const out: CreditRequestLine = { lineNo };
      if (r.quantity !== undefined && r.quantity !== null && r.quantity !== '') out.quantity = Number(r.quantity);
      if (r.taxableAmount !== undefined && r.taxableAmount !== null && r.taxableAmount !== '') out.taxableAmount = Number(r.taxableAmount);
      return out;
    });
  }

  private creditableLines(L: Loaded): CreditableLine[] {
    return [...L.lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => {
        const c = L.credited.get(l.id) ?? { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        return {
          lineNo: l.lineNo,
          itemName: l.itemName,
          description: l.description ?? null,
          hsnCode: l.hsnCode,
          unit: l.unit,
          unitPrice: Number(l.unitPrice),
          taxPercent: Number(l.taxPercent),
          quantity: Number(l.quantity),
          taxablePaise: toPaise(l.taxableValue),
          cgstPaise: toPaise(l.cgstAmount),
          sgstPaise: toPaise(l.sgstAmount),
          igstPaise: toPaise(l.igstAmount),
          creditedQuantity: c.qty,
          creditedTaxablePaise: c.taxable,
          creditedCgstPaise: c.cgst,
          creditedSgstPaise: c.sgst,
          creditedIgstPaise: c.igst,
        };
      });
  }

  private toView(cn: any, items: any[], inv: any, order: any): CreditNoteView {
    return {
      id: cn.id,
      creditNoteNumber: cn.creditNoteNumber,
      financialYear: cn.financialYear,
      issuedAt: new Date(cn.issuedAt).toISOString(),
      invoice: { id: cn.invoiceId, invoiceNumber: inv?.invoiceNumber ?? '', issuedAt: inv ? new Date(inv.issuedAt).toISOString() : '' },
      orderId: cn.orderId,
      orderNumber: order?.orderNumber ?? '',
      reason: cn.reason,
      reasonLabel: CREDIT_NOTE_REASON_LABELS[cn.reason as CreditNoteReason] ?? cn.reason,
      reasonNote: cn.reasonNote ?? null,
      supplyType: cn.supplyType,
      placeOfSupply: { stateCode: cn.placeOfSupply, stateName: stateName(cn.placeOfSupply) },
      supplier: cn.supplier,
      buyer: cn.buyer,
      lines: [...items]
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
        taxableValue: String(cn.taxableValue),
        cgst: String(cn.cgstAmount),
        sgst: String(cn.sgstAmount),
        igst: String(cn.igstAmount),
        roundOff: String(cn.roundOff),
        grandTotal: String(cn.amount),
      },
    };
  }

  private async summaries(tx: any | null, tenantId: string, invoiceId?: string, limit = 100): Promise<CreditNoteSummary[]> {
    let rows: any[];
    let invById: Map<string, any>;
    if (tx) {
      const cond = invoiceId ? and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.invoiceId, invoiceId)) : eq(creditNotes.tenantId, tenantId);
      rows = await tx.select().from(creditNotes).where(cond).orderBy(desc(creditNotes.issuedAt)).limit(limit);
      const ids = [...new Set(rows.map((r) => r.invoiceId))];
      const invs = ids.length ? await tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, ids))) : [];
      invById = new Map(invs.map((i: any) => [i.id, i]));
    } else {
      rows = globalMemoryCreditNotes
        .filter((c) => c.tenantId === tenantId && (!invoiceId || c.invoiceId === invoiceId))
        .sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))
        .slice(0, limit);
      invById = new Map(globalMemoryInvoices.filter((i) => i.tenantId === tenantId).map((i) => [i.id, i]));
    }
    return rows.map((r) => ({
      id: r.id,
      creditNoteNumber: r.creditNoteNumber,
      issuedAt: new Date(r.issuedAt).toISOString(),
      invoiceId: r.invoiceId,
      invoiceNumber: invById.get(r.invoiceId)?.invoiceNumber ?? '',
      customerName: (r.buyer as InvoiceParty | null)?.name ?? '',
      reason: r.reason,
      reasonLabel: CREDIT_NOTE_REASON_LABELS[r.reason as CreditNoteReason] ?? r.reason,
      grandTotal: String(r.amount),
    }));
  }

  // ---------------------------------------------------------------- storage

  /** Same rule as invoices: a tax document must never be issued into memory in production and then vanish. */
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
          this.logger.error(`Credit note storage failed: ${err.message}`);
          throw new ServiceUnavailableException('Credit notes are temporarily unavailable. Please try again.');
        }
        this.logger.warn(`Postgres offline; using the in-memory credit note store: ${err.message}`);
      }
    }
    return fn(null);
  }

  private async loadDb(tx: any, tenantId: string, invoiceId: string): Promise<Loaded> {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
    if (!inv) throw new NotFoundException('Invoice not found');
    const lines = await tx.select().from(invoiceItems).where(and(eq(invoiceItems.invoiceId, invoiceId), eq(invoiceItems.tenantId, tenantId)));
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, inv.orderId), eq(orders.tenantId, tenantId))).limit(1);
    const rows = await tx
      .select({
        id: creditNoteItems.invoiceItemId,
        qty: dsql<string>`coalesce(sum(${creditNoteItems.quantity}), 0)`,
        taxable: dsql<string>`coalesce(sum(${creditNoteItems.taxableValue}), 0)`,
        cgst: dsql<string>`coalesce(sum(${creditNoteItems.cgstAmount}), 0)`,
        sgst: dsql<string>`coalesce(sum(${creditNoteItems.sgstAmount}), 0)`,
        igst: dsql<string>`coalesce(sum(${creditNoteItems.igstAmount}), 0)`,
      })
      .from(creditNoteItems)
      .innerJoin(creditNotes, eq(creditNotes.id, creditNoteItems.creditNoteId))
      .where(and(eq(creditNoteItems.tenantId, tenantId), eq(creditNotes.invoiceId, invoiceId)))
      .groupBy(creditNoteItems.invoiceItemId);
    const credited = new Map<string, { qty: number; taxable: number; cgst: number; sgst: number; igst: number }>();
    for (const r of rows) credited.set(r.id, { qty: Number(r.qty), taxable: toPaise(r.taxable), cgst: toPaise(r.cgst), sgst: toPaise(r.sgst), igst: toPaise(r.igst) });
    const [ro] = await tx
      .select({ total: dsql<string>`coalesce(sum(${creditNotes.roundOff}), 0)` })
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.invoiceId, invoiceId)));
    return { inv, lines, order, credited, creditedRoundOff: toPaise(ro?.total ?? 0) };
  }

  private loadMemory(tenantId: string, invoiceId: string): Loaded {
    const inv = globalMemoryInvoices.find((i) => i.id === invoiceId && i.tenantId === tenantId);
    if (!inv) throw new NotFoundException('Invoice not found');
    const lines = globalMemoryInvoiceItems.filter((l) => l.invoiceId === invoiceId && l.tenantId === tenantId);
    const order = globalMemoryOrders.find((o) => o.id === inv.orderId && o.tenantId === tenantId);
    const credited = new Map<string, { qty: number; taxable: number; cgst: number; sgst: number; igst: number }>();
    let creditedRoundOff = 0;
    for (const cn of globalMemoryCreditNotes.filter((c) => c.tenantId === tenantId && c.invoiceId === invoiceId)) {
      creditedRoundOff += toPaise(cn.roundOff);
      for (const it of globalMemoryCreditNoteItems.filter((i) => i.creditNoteId === cn.id)) {
        const c = credited.get(it.invoiceItemId) ?? { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        c.qty += Number(it.quantity);
        c.taxable += toPaise(it.taxableValue);
        c.cgst += toPaise(it.cgstAmount);
        c.sgst += toPaise(it.sgstAmount);
        c.igst += toPaise(it.igstAmount);
        credited.set(it.invoiceItemId, c);
      }
    }
    return { inv, lines, order, credited, creditedRoundOff };
  }

  private async nextSerialDb(tx: any, tenantId: string, fy: string): Promise<number> {
    const [row] = await tx
      .insert(creditNoteCounters)
      .values({ tenantId, financialYear: fy, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [creditNoteCounters.tenantId, creditNoteCounters.financialYear],
        set: { lastNumber: dsql`${creditNoteCounters.lastNumber} + 1` },
      })
      .returning({ n: creditNoteCounters.lastNumber });
    return row.n;
  }

  private nextSerialMemory(tenantId: string, fy: string): number {
    const key = `${tenantId}:${fy}`;
    const n = (globalMemoryCreditNoteCounters.get(key) ?? 0) + 1;
    globalMemoryCreditNoteCounters.set(key, n);
    return n;
  }
}
