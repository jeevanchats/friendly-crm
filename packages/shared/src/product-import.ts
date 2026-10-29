/**
 * Product master import: column matching and row validation for a product / service list.
 * Pure and shared by the browser (live preview) and the API (the real check), like customer-import.
 */
import { cleanDisplayName } from './duplicates';
import { isValidHsn } from './gst';
import { parseDelimited, parseMoneyToPaise } from './customer-import';
import { getIndustryExamples } from './templates';

/** GST rates in force for goods and services in India. Anything else is almost certainly a typo. */
export const GST_RATE_SLABS: readonly number[] = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28];
export const DEFAULT_GST_PERCENT = 18;

export type ProductField = 'name' | 'code' | 'description' | 'hsnCode' | 'unit' | 'unitPrice' | 'taxPercent';

export const PRODUCT_FIELDS: ReadonlyArray<{ field: ProductField; label: string; example: string }> = [
  { field: 'name', label: 'Name', example: 'Wall Calendar 12 sheet' },
  { field: 'code', label: 'Code', example: 'CAL-12' },
  { field: 'description', label: 'Description', example: '300 GSM art board, matt lamination' },
  { field: 'hsnCode', label: 'HSN/SAC', example: '4910' },
  { field: 'unit', label: 'Unit', example: 'Nos' },
  { field: 'unitPrice', label: 'Rate', example: '85' },
  { field: 'taxPercent', label: 'GST %', example: '12' },
];

const ALIASES: Record<ProductField, string[]> = {
  name: ['name', 'productname', 'product', 'item', 'itemname', 'particulars', 'service', 'servicename', 'goods'],
  code: ['code', 'itemcode', 'productcode', 'sku', 'partno', 'partnumber', 'itemno'],
  description: ['description', 'desc', 'details', 'specification', 'specifications', 'remarks'],
  hsnCode: ['hsn', 'hsncode', 'hsnsac', 'hsnsaccode', 'sac', 'saccode', 'hsnno'],
  unit: ['unit', 'uom', 'unitofmeasure', 'units', 'per'],
  unitPrice: ['rate', 'price', 'unitprice', 'sellingprice', 'saleprice', 'salesrate', 'rateperunit', 'mrp'],
  taxPercent: ['gst', 'gstpercent', 'gstrate', 'gstpct', 'tax', 'taxpercent', 'taxrate', 'gst%'],
};

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9%]/g, '');

export interface ParsedProductSheet {
  mapping: Partial<Record<ProductField, number>>;
  ignoredHeaders: string[];
  rows: Array<Partial<Record<ProductField, string>>>;
}

/** Reads a product sheet: matches headers to fields (case and punctuation ignored) and maps every row. */
export function parseProductSheet(text: string): ParsedProductSheet {
  const cells = parseDelimited(text);
  if (cells.length === 0) return { mapping: {}, ignoredHeaders: [], rows: [] };
  const [header, ...body] = cells;
  const mapping: Partial<Record<ProductField, number>> = {};
  const ignored: string[] = [];
  header.forEach((h, idx) => {
    const key = headerKey(h);
    const field = (Object.keys(ALIASES) as ProductField[]).find((f) => ALIASES[f].includes(key));
    if (field && mapping[field] === undefined) mapping[field] = idx;
    else if (h.trim() !== '') ignored.push(h.trim());
  });
  const rows = body.map((r) => {
    const o: Partial<Record<ProductField, string>> = {};
    for (const [field, idx] of Object.entries(mapping) as Array<[ProductField, number]>) o[field] = (r[idx] ?? '').trim();
    return o;
  });
  return { mapping, ignoredHeaders: ignored, rows };
}

/** A ready-to-fill CSV with the recognised columns and one example row from the given trade (or a neutral one). */
export function productTemplateCsv(industryKey?: string): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const e = getIndustryExamples(industryKey ?? '').product;
  const sample: Record<ProductField, string> = industryKey
    ? { name: e.name, code: '', description: e.description, hsnCode: e.hsnCode, unit: e.unit, unitPrice: e.unitPrice, taxPercent: e.taxPercent }
    : (Object.fromEntries(PRODUCT_FIELDS.map((f) => [f.field, f.example])) as Record<ProductField, string>);
  return [PRODUCT_FIELDS.map((f) => f.label).join(','), PRODUCT_FIELDS.map((f) => q(sample[f.field])).join(',')].join('\r\n') + '\r\n';
}

export interface CleanProduct {
  name: string;
  code: string | null;
  description: string | null;
  hsnCode: string | null;
  unit: string;
  unitPricePaise: number;
  taxPercent: number;
}

/** `value` is set exactly when `ok` is true. */
export interface ProductCheck {
  ok: boolean;
  value: CleanProduct | null;
  errors: string[];
  warnings: string[];
}

/** Common spellings people use for units, folded to one form so reports and invoices stay tidy. */
const UNIT_ALIASES: Record<string, string> = {
  nos: 'Nos', no: 'Nos', number: 'Nos', numbers: 'Nos', pcs: 'Nos', pc: 'Nos', piece: 'Nos', pieces: 'Nos', each: 'Nos', unit: 'Nos', units: 'Nos',
  kg: 'Kg', kgs: 'Kg', kilogram: 'Kg', kilograms: 'Kg',
  gm: 'Gm', gms: 'Gm', gram: 'Gm', grams: 'Gm',
  ltr: 'Ltr', ltrs: 'Ltr', litre: 'Ltr', litres: 'Ltr', liter: 'Ltr', liters: 'Ltr',
  mtr: 'Meters', mtrs: 'Meters', m: 'Meters', meter: 'Meters', meters: 'Meters', metre: 'Meters', metres: 'Meters',
  sqft: 'Sq.Ft', 'sq.ft': 'Sq.Ft', 'sq ft': 'Sq.Ft', sft: 'Sq.Ft',
  set: 'Sets', sets: 'Sets', bale: 'Bales', bales: 'Bales', box: 'Box', boxes: 'Box', bag: 'Bags', bags: 'Bags',
  ton: 'Ton', tons: 'Ton', tonne: 'Ton', tonnes: 'Ton', mt: 'Ton', hrs: 'Hours', hr: 'Hours', hour: 'Hours', hours: 'Hours',
};

/** The standard unit for a word like "boxes" or "pcs"; null when the word is not a unit. */
export function lookupUnit(word: string): string | null {
  return UNIT_ALIASES[word.trim().toLowerCase()] ?? null;
}

export function normalizeUnit(raw: string): string {
  const t = raw.trim();
  if (!t) return 'Nos';
  return UNIT_ALIASES[t.toLowerCase()] ?? t;
}

/** "18", "18%", "18.0", "GST 18" -> 18. Null when it is not a number. */
export function parseGstPercent(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).replace(/,/g, '').match(/^\s*(?:gst\s*)?(\d+(?:\.\d+)?)\s*%?\s*$/i);
  return m ? Number(m[1]) : null;
}

/** Validates one raw product row. Collects every problem so they can be fixed together. */
export function validateProductRow(raw: Partial<Record<ProductField, unknown>>): ProductCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = (k: ProductField) => (raw[k] === undefined || raw[k] === null ? '' : String(raw[k]).trim());

  const name = cleanDisplayName(text('name'));
  if (!name) errors.push('Name is missing');
  else if (name.length > 200) errors.push('Name is longer than 200 characters');

  const code = text('code');
  if (code.length > 50) errors.push('Code is longer than 50 characters');

  const description = text('description');
  if (description.length > 1000) errors.push('Description is longer than 1000 characters');

  const hsnRaw = text('hsnCode').replace(/[\s.]/g, '');
  if (hsnRaw && !isValidHsn(hsnRaw)) errors.push(`HSN/SAC "${text('hsnCode')}" must be 4, 6 or 8 digits`);

  const unit = normalizeUnit(text('unit'));
  if (unit.length > 30) errors.push('Unit is longer than 30 characters');

  let unitPricePaise = 0;
  const price = parseMoneyToPaise(raw.unitPrice);
  if ('error' in price) errors.push(`Rate: ${price.error}`);
  else if (price.paise < 0) errors.push('Rate cannot be negative');
  else unitPricePaise = price.paise;
  if (!text('unitPrice')) warnings.push('No rate: it will be 0 until you set one');

  let taxPercent = DEFAULT_GST_PERCENT;
  if (text('taxPercent')) {
    const t = parseGstPercent(raw.taxPercent);
    if (t === null) errors.push(`GST % "${text('taxPercent')}" is not a number`);
    else if (!GST_RATE_SLABS.includes(t)) errors.push(`GST % ${t} is not a GST rate (use ${GST_RATE_SLABS.join(', ')})`);
    else taxPercent = t;
  } else {
    warnings.push(`No GST %: ${DEFAULT_GST_PERCENT}% will be used`);
  }

  if (errors.length > 0) return { ok: false, value: null, errors, warnings };
  return {
    ok: true,
    errors: [],
    warnings,
    value: { name, code: code || null, description: description || null, hsnCode: hsnRaw || null, unit, unitPricePaise, taxPercent },
  };
}
