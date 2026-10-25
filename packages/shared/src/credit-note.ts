/**
 * GST credit notes (section 34): a document that reduces an issued invoice, for goods returned, a discount given
 * after the sale, a correction, or a cancellation. All money here is integer paise.
 */

export const CREDIT_NOTE_REASONS = ['SALES_RETURN', 'POST_SALE_DISCOUNT', 'CORRECTION', 'CANCELLATION', 'OTHER'] as const;
export type CreditNoteReason = (typeof CREDIT_NOTE_REASONS)[number];

export const CREDIT_NOTE_REASON_LABELS: Record<CreditNoteReason, string> = {
  SALES_RETURN: 'Goods returned',
  POST_SALE_DISCOUNT: 'Discount after sale',
  CORRECTION: 'Correction of value or rate',
  CANCELLATION: 'Invoice cancelled',
  OTHER: 'Other',
};

/** Credit note number: CN/2026-27/0001, its own series, 15 characters (the GST limit is 16). */
export function formatCreditNoteNumber(fy: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error('Credit note sequence must be a positive integer');
  const n = `CN/${fy}/${String(seq).padStart(4, '0')}`;
  if (n.length > 16) throw new Error(`Credit note number ${n} exceeds the 16 character GST limit`);
  return n;
}

/** One invoice line with how much of it earlier credit notes have already taken back. */
export interface CreditableLine {
  lineNo: number;
  itemName: string;
  description: string | null;
  hsnCode: string;
  unit: string;
  unitPrice: number;
  taxPercent: number;
  /** As invoiced */
  quantity: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Already credited by earlier credit notes */
  creditedQuantity: number;
  creditedTaxablePaise: number;
  creditedCgstPaise: number;
  creditedSgstPaise: number;
  creditedIgstPaise: number;
}

/** Ask to credit part of a line: give `quantity` (goods returned) or `taxableAmount` in rupees (a value reduction). */
export interface CreditRequestLine {
  lineNo: number;
  quantity?: number;
  taxableAmount?: number;
}

export interface CreditNoteLine {
  lineNo: number;
  itemName: string;
  description: string | null;
  hsnCode: string;
  /** Quantity taken back; 0 for a value-only credit. */
  quantity: number;
  unit: string;
  unitPrice: number;
  taxPercent: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface CreditNoteComputation {
  lines: CreditNoteLine[];
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  /** True when, after this note, nothing of the invoice is left to credit. */
  settlesInvoice: boolean;
}

const roundHalfUp = (n: number) => Math.floor(n + 0.5 + 1e-9);
const qtyEq = (a: number, b: number) => Math.abs(a - b) < 0.0005;

export function remainingOf(l: CreditableLine) {
  return {
    quantity: Math.max(0, Math.round((l.quantity - l.creditedQuantity) * 1000) / 1000),
    taxablePaise: l.taxablePaise - l.creditedTaxablePaise,
    cgstPaise: l.cgstPaise - l.creditedCgstPaise,
    sgstPaise: l.sgstPaise - l.creditedSgstPaise,
    igstPaise: l.igstPaise - l.creditedIgstPaise,
  };
}

/**
 * Works out the amounts of a credit note. Rules:
 *  - a line can be credited by quantity (goods returned) or by taxable value (a discount or correction), not both;
 *  - never more than what is left of the line after earlier credit notes;
 *  - crediting everything that is left takes exactly the remaining amounts, so a full cancellation reverses the
 *    invoice to the paisa and the rounding is never left behind;
 *  - the invoice's round-off is credited only by the note that settles the whole invoice.
 * Throws an Error with a plain-words message when a request cannot be honoured.
 */
export function computeCreditNote(args: {
  supplyType: 'INTRA' | 'INTER';
  lines: CreditableLine[];
  requests: CreditRequestLine[];
  invoiceRoundOffPaise: number;
  creditedRoundOffPaise: number;
}): CreditNoteComputation {
  const { supplyType, lines, requests } = args;
  if (requests.length === 0) throw new Error('Choose at least one line to credit.');
  const byNo = new Map(lines.map((l) => [l.lineNo, l]));
  const seen = new Set<number>();
  const out: CreditNoteLine[] = [];

  for (const r of requests) {
    const line = byNo.get(r.lineNo);
    if (!line) throw new Error(`Line ${r.lineNo} is not on this invoice.`);
    if (seen.has(r.lineNo)) throw new Error(`Line ${r.lineNo} is listed twice.`);
    seen.add(r.lineNo);
    const hasQty = r.quantity !== undefined && r.quantity !== null;
    const hasAmt = r.taxableAmount !== undefined && r.taxableAmount !== null;
    if (hasQty === hasAmt) throw new Error(`Line ${r.lineNo}: give either a quantity returned or an amount to reduce, not both.`);

    const rem = remainingOf(line);
    const label = `Line ${r.lineNo} (${line.itemName})`;
    let creditQty = 0;
    let taxable: number;
    let cgst: number;
    let sgst: number;
    let igst: number;

    if (hasQty) {
      const q = Number(r.quantity);
      if (!Number.isFinite(q) || q <= 0) throw new Error(`${label}: quantity must be more than zero.`);
      if (Math.round(q * 100) / 100 !== q) throw new Error(`${label}: quantity can have at most 2 decimals.`);
      if (q > rem.quantity + 0.0005) throw new Error(`${label}: only ${rem.quantity} ${line.unit} left to credit.`);
      creditQty = q;
      if (qtyEq(q, rem.quantity)) {
        ({ taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst } = rem);
      } else {
        taxable = Math.min(rem.taxablePaise, roundHalfUp((line.taxablePaise * q) / line.quantity));
        cgst = Math.min(rem.cgstPaise, roundHalfUp((line.cgstPaise * q) / line.quantity));
        sgst = supplyType === 'INTRA' ? cgst : 0; // CGST and SGST stay equal
        igst = Math.min(rem.igstPaise, roundHalfUp((line.igstPaise * q) / line.quantity));
      }
    } else {
      const amt = Number(r.taxableAmount);
      const t = Math.round(amt * 100);
      if (!Number.isFinite(amt) || t <= 0) throw new Error(`${label}: the amount must be more than zero.`);
      if (Math.abs(amt * 100 - t) > 1e-6) throw new Error(`${label}: the amount can have at most 2 decimals.`);
      if (t > rem.taxablePaise) throw new Error(`${label}: only Rs. ${(rem.taxablePaise / 100).toFixed(2)} of value left to credit.`);
      taxable = t;
      if (t === rem.taxablePaise) {
        cgst = rem.cgstPaise;
        sgst = rem.sgstPaise;
        igst = rem.igstPaise;
      } else if (supplyType === 'INTRA') {
        cgst = Math.min(rem.cgstPaise, roundHalfUp((t * line.taxPercent) / 200));
        sgst = cgst;
        igst = 0;
      } else {
        cgst = 0;
        sgst = 0;
        igst = Math.min(rem.igstPaise, roundHalfUp((t * line.taxPercent) / 100));
      }
    }
    out.push({
      lineNo: line.lineNo,
      itemName: line.itemName,
      description: line.description,
      hsnCode: line.hsnCode,
      quantity: creditQty,
      unit: line.unit,
      unitPrice: line.unitPrice,
      taxPercent: line.taxPercent,
      taxablePaise: taxable,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      totalPaise: taxable + cgst + sgst + igst,
    });
  }

  // Does this note leave anything of the invoice uncredited?
  const takenNow = new Map(out.map((l) => [l.lineNo, l]));
  const settlesInvoice = lines.every((l) => {
    const rem = remainingOf(l);
    const now = takenNow.get(l.lineNo);
    return rem.taxablePaise - (now?.taxablePaise ?? 0) <= 0 && rem.quantity - (now?.quantity ?? 0) <= 0.0005;
  });
  const roundOffPaise = settlesInvoice ? args.invoiceRoundOffPaise - args.creditedRoundOffPaise : 0;

  const sum = (pick: (l: CreditNoteLine) => number) => out.reduce((s, l) => s + pick(l), 0);
  const total = sum((l) => l.totalPaise) + roundOffPaise;
  if (total <= 0) throw new Error('This credit note would be for nothing.');
  return {
    lines: out,
    taxablePaise: sum((l) => l.taxablePaise),
    cgstPaise: sum((l) => l.cgstPaise),
    sgstPaise: sum((l) => l.sgstPaise),
    igstPaise: sum((l) => l.igstPaise),
    roundOffPaise,
    totalPaise: total,
    settlesInvoice,
  };
}

/** Request lines that credit everything still left on every line: used for a cancellation. */
export function fullCreditRequests(lines: CreditableLine[]): CreditRequestLine[] {
  const reqs: CreditRequestLine[] = [];
  for (const l of lines) {
    const rem = remainingOf(l);
    if (rem.taxablePaise <= 0 && rem.quantity <= 0) continue;
    // Goods still to take back, otherwise just the value that is left
    if (rem.quantity > 0) reqs.push({ lineNo: l.lineNo, quantity: rem.quantity });
    else reqs.push({ lineNo: l.lineNo, taxableAmount: rem.taxablePaise / 100 });
  }
  return reqs;
}
