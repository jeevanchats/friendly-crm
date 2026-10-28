/**
 * Turning what a customer asked for (notes, photos, PDFs, a voice note) into quotation lines.
 * The reading itself is done by a model on the server; everything here is the deterministic part that checks
 * its answer and fills the gaps from the business's own product list.
 */

export interface ProductRef {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  hsnCode?: string | null;
  unit: string;
  unitPrice: string | number;
  taxPercent: string | number;
}

/** What the reader says the customer asked for. Every field but the name may be missing. */
export interface RawSuggestedLine {
  itemName?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
  productId?: unknown;
  sourceNote?: unknown;
}

/** A quotation line ready to drop into the form. A field the customer did not give and the product list could not supply is listed in `missing`. */
export interface SuggestedLine {
  itemName: string;
  description: string;
  hsnCode: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxPercent: number;
  productId: string | null;
  /** The product-list entry this line was matched to, if any. */
  matchedProduct: string | null;
  /** Fields staff still have to fill in: any of 'quantity' | 'rate'. */
  missing: Array<'quantity' | 'rate'>;
  /** Where in the customer's words this came from (a short quote), for the person checking it. */
  sourceNote: string;
}

export const MAX_SUGGESTED_LINES = 30;

export function normalizeItemName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Singular-ish form so "calendars" matches "calendar". */
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokens = (s: string): string[] => normalizeItemName(s).split(' ').filter(Boolean).map(stem);

/** How well a requested item name matches a product name, 0 to 1. */
export function nameScore(requested: string, productName: string): number {
  const a = tokens(requested);
  const b = tokens(productName);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 1;
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  if (!shared) return 0;
  const containsAll = b.every((t) => a.includes(t)) || a.every((t) => setB.has(t));
  const jaccard = shared / (new Set([...a, ...b]).size);
  return containsAll ? Math.max(0.8, jaccard) : jaccard;
}

/** The best product for a requested name, only when it is a convincing match. */
export function matchProduct<P extends ProductRef>(requested: string, products: P[], threshold = 0.6): P | null {
  let best: P | null = null;
  let bestScore = 0;
  let tie = false;
  for (const p of products) {
    const s = Math.max(nameScore(requested, p.name), p.code ? (normalizeItemName(requested) === normalizeItemName(p.code) ? 1 : 0) : 0);
    if (s > bestScore) {
      best = p;
      bestScore = s;
      tie = false;
    } else if (s === bestScore && s > 0) {
      tie = true;
    }
  }
  // Two products equally good: do not guess which one the customer meant
  return best && bestScore >= threshold && !tie ? best : null;
}

const asText = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const asPositive = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n : null;
};

/**
 * Check the reader's answer and complete each line from the product list.
 * What the customer stated (quantity, unit, rate) always wins; the product list only fills what is missing.
 */
export function buildSuggestedLines(raw: unknown, products: ProductRef[]): SuggestedLine[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: SuggestedLine[] = [];
  for (const entry of raw.slice(0, MAX_SUGGESTED_LINES)) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as RawSuggestedLine;
    const itemName = asText(r.itemName, 200);
    if (!itemName) continue;

    const claimed = typeof r.productId === 'string' ? byId.get(r.productId) : undefined;
    // Trust the reader's pick only if it really is a product of this business and the names are not unrelated
    const product = claimed && nameScore(itemName, claimed.name) >= 0.3 ? claimed : matchProduct(itemName, products);

    const quantity = asPositive(r.quantity);
    const statedRate = asPositive(r.unitPrice);
    const productRate = product ? Number(product.unitPrice) : 0;
    const rate = statedRate ?? (productRate > 0 ? productRate : null);
    const unit = asText(r.unit, 30) || product?.unit || 'Nos';
    const description = asText(r.description, 500) || product?.description || '';

    const missing: SuggestedLine['missing'] = [];
    if (quantity === null) missing.push('quantity');
    if (rate === null) missing.push('rate');

    out.push({
      itemName: product ? product.name : itemName,
      description,
      hsnCode: product?.hsnCode ?? '',
      quantity: quantity ?? 0,
      unit,
      unitPrice: rate ?? 0,
      taxPercent: product ? Number(product.taxPercent) : 18,
      productId: product?.id ?? null,
      matchedProduct: product?.name ?? null,
      missing,
      sourceNote: asText(r.sourceNote, 200),
    });
  }
  return out;
}
