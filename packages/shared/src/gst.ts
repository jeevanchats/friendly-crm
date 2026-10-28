/**
 * GST helpers for Indian tax invoices. Pure and dependency-free so the API, the web app and the tests share
 * one implementation. All money here is integer paise: never add or compare rupee floats.
 */

/** GST state / union-territory codes (the first two digits of a GSTIN). */
export const GST_STATES: Readonly<Record<string, string>> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

export const isValidStateCode = (code: unknown): code is string =>
  typeof code === 'string' && Object.prototype.hasOwnProperty.call(GST_STATES, code);

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Check character of a GSTIN (mod-36 weighted sum over the first 14 characters). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** Shape, known state code, and check character. Does not prove the GSTIN is active on the GST portal. */
export function isValidGstin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const g = value.trim().toUpperCase();
  return GSTIN_SHAPE.test(g) && isValidStateCode(g.slice(0, 2)) && gstinCheckChar(g.slice(0, 14)) === g[14];
}

export const normalizeGstin = (value: string): string => value.trim().toUpperCase();

/** State code from a GSTIN, or null. */
export const stateCodeFromGstin = (gstin: string | null | undefined): string | null =>
  gstin && isValidGstin(gstin) ? normalizeGstin(gstin).slice(0, 2) : null;

/** HSN (goods) or SAC (services) code: 4, 6 or 8 digits are used on invoices; 2 is allowed for chapter-level. */
export const isValidHsn = (value: unknown): value is string => typeof value === 'string' && /^\d{4}(\d{2}(\d{2})?)?$/.test(value);

/** Indian financial year of a date, e.g. 2026-10-25 -> "2026-27", 2027-02-01 -> "2026-27". */
export function financialYear(date: Date): string {
  const y = date.getFullYear();
  const start = date.getMonth() >= 3 ? y : y - 1; // April starts the year
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Invoice number: INV/2026-27/0001. GST rules cap the serial number at 16 characters (letters, digits, "/" and
 * "-"), which this fits exactly for sequences up to 9999; longer sequences are rejected rather than truncated.
 */
export function formatInvoiceNumber(fy: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error('Invoice sequence must be a positive integer');
  const n = `INV/${fy}/${String(seq).padStart(4, '0')}`;
  if (n.length > 16) throw new Error(`Invoice number ${n} exceeds the 16 character GST limit`);
  return n;
}

// ---------------- tax computation ----------------

export interface GstLineInput {
  itemName: string;
  description?: string | null;
  hsnCode: string;
  quantity: number;
  unit: string;
  /** Rate per unit before tax, in rupees (as stored on the order line). */
  unitPrice: number;
  /** Total GST rate for the line, e.g. 18. */
  taxPercent: number;
}

export interface GstLine extends GstLineInput {
  lineNo: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** taxable + tax for the line, before round-off. */
  totalPaise: number;
}

export interface GstComputation {
  supplyType: 'INTRA' | 'INTER';
  lines: GstLine[];
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Difference between the agreed total and the sum of line totals (a few paise at most). May be negative. */
  roundOffPaise: number;
  /** Equals the agreed total exactly. */
  grandTotalPaise: number;
}

const roundHalfUp = (n: number) => Math.round(n + 1e-9);

/**
 * Splits an order into GST invoice lines.
 *
 * `agreedTotalPaise` is what the customer actually owes (after any discount). The lines' taxable values are
 * scaled by the same factor so a discount reduces the taxable value (as GST requires), tax is computed on the
 * reduced value, and the few-paise rounding gap is shown as a round-off line, so the invoice total always
 * equals the order total and receivables stay consistent.
 *
 * Intra-state supply splits tax equally into CGST and SGST; inter-state supply charges IGST.
 */
export function computeGstInvoice(args: {
  lines: GstLineInput[];
  agreedTotalPaise: number;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
}): GstComputation {
  const { lines, agreedTotalPaise, supplierStateCode, placeOfSupplyStateCode } = args;
  if (lines.length === 0) throw new Error('An invoice needs at least one line');
  if (!isValidStateCode(supplierStateCode) || !isValidStateCode(placeOfSupplyStateCode)) {
    throw new Error('Supplier and place-of-supply state codes must be valid GST state codes');
  }
  if (!Number.isInteger(agreedTotalPaise) || agreedTotalPaise < 0) throw new Error('Agreed total must be whole paise');

  const supplyType = supplierStateCode === placeOfSupplyStateCode ? 'INTRA' : 'INTER';

  const bases = lines.map((l) => roundHalfUp(l.quantity * l.unitPrice * 100));
  const undiscounted = lines.reduce((sum, l, i) => sum + roundHalfUp(bases[i] * (1 + l.taxPercent / 100)), 0);
  // A discount can only lower the total. A total above the lines means the order data is inconsistent: refuse
  // rather than invent extra taxable value.
  if (agreedTotalPaise > undiscounted + 2 * lines.length + 2) {
    throw new Error(`Order total (${agreedTotalPaise} paise) is higher than its lines (${undiscounted} paise)`);
  }
  const factor = undiscounted > 0 ? Math.min(1, agreedTotalPaise / undiscounted) : 1;

  const out: GstLine[] = lines.map((l, i) => {
    const taxablePaise = roundHalfUp(bases[i] * factor);
    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;
    if (supplyType === 'INTRA') {
      cgstPaise = roundHalfUp((taxablePaise * l.taxPercent) / 200);
      sgstPaise = cgstPaise; // CGST and SGST are always equal
    } else {
      igstPaise = roundHalfUp((taxablePaise * l.taxPercent) / 100);
    }
    return {
      ...l,
      lineNo: i + 1,
      taxablePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      totalPaise: taxablePaise + cgstPaise + sgstPaise + igstPaise,
    };
  });

  const sum = (pick: (l: GstLine) => number) => out.reduce((s, l) => s + pick(l), 0);
  const linesTotal = sum((l) => l.totalPaise);
  const roundOffPaise = agreedTotalPaise - linesTotal;
  // Per-line rounding can only drift by about a paisa per line plus the tax halves; anything bigger means the
  // lines and the agreed total disagree and the invoice must not be issued.
  if (Math.abs(roundOffPaise) > 2 * lines.length + 2) {
    throw new Error(`Invoice lines (${linesTotal} paise) do not reconcile with the order total (${agreedTotalPaise} paise)`);
  }

  return {
    supplyType,
    lines: out,
    taxablePaise: sum((l) => l.taxablePaise),
    cgstPaise: sum((l) => l.cgstPaise),
    sgstPaise: sum((l) => l.sgstPaise),
    igstPaise: sum((l) => l.igstPaise),
    roundOffPaise,
    grandTotalPaise: agreedTotalPaise,
  };
}

// ---------------- amount in words ----------------

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

/** "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Paise Only" (Indian digit grouping). */
export function amountInWords(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) throw new Error('Amount must be whole, non-negative paise');
  const rupees = Math.floor(paise / 100);
  const ps = paise % 100;
  const parts: string[] = [];
  let rest = rupees;
  for (const [unit, label] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']] as const) {
    if (rest >= unit) {
      const q = Math.floor(rest / unit);
      // Crores can themselves exceed 99, so they recurse through the same grouping.
      parts.push(`${unit === 10_000_000 && q >= 100 ? amountInWords(q * 100).replace(/^Rupees | Only$/g, '') : below1000(q)} ${label}`);
      rest %= unit;
    }
  }
  if (rest > 0) parts.push(below1000(rest));
  const rupeeText = parts.length ? parts.join(' ') : 'Zero';
  return `Rupees ${rupeeText}${ps ? ` and ${below1000(ps)} Paise` : ''} Only`;
}
