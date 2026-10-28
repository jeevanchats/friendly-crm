import { lookupUnit } from './product-import';
import { normalizeItemName, ProductRef, RawSuggestedLine } from './quote-suggest';

/**
 * Pulls quotation lines out of plain words (the enquiry text, notes, the written text of a voice note, text read
 * from a PDF or a printed photo) without any AI service: "500 wall calendars", "visiting cards - 20 box @ 350".
 * It finds the products the business already sells first; anything else is taken only from short, list-like lines.
 * What it cannot make sense of it leaves alone, and staff fill the quote in by hand.
 */

const FILLER = new Set([
  'a', 'an', 'the', 'of', 'for', 'to', 'me', 'us', 'we', 'i', 'need', 'needs', 'needed', 'want', 'wants', 'please', 'pls', 'kindly',
  'also', 'send', 'quote', 'quotation', 'required', 'require', 'requirement', 'order', 'about', 'around', 'approx', 'nearly', 'total',
  'nos', 'no', 'pcs', 'pc', 'qty', 'quantity', 'with', 'and', 'plus', 'only', 'each', 'per', 'at', 'rate', 'price', 'is', 'are', 'as',
]);
/** Words that mean a line is about delivery, contact or dates, not about something to quote. */
const NOISE = new Set(['delivery', 'deliver', 'call', 'phone', 'mobile', 'contact', 'whatsapp', 'tel', 'date', 'by', 'before', 'after', 'on', 'in', 'within', 'tomorrow', 'today', 'urgent', 'ph']);
/** A number followed by one of these is a date, time or percentage, not a quantity. */
const NOT_A_QUANTITY_NEXT = /^(am|pm|days?|weeks?|months?|years?|o'?clock|st|nd|rd|th|%|percent|gsm|mm|cm|inch|inches|x)$/i;
const NUMBER = '(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
const toNumber = (s: string): number => Number(s.replace(/,/g, ''));
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s: string): string[] => normalizeItemName(s).split(' ').filter(Boolean);

/** Splits free text into one request per line, comma, semicolon, "and" or "+". */
function segments(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n|;|\s\+\s|,(?=\s*[\d(])|\band\b|\bplus\b|\balso\b/i)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '').trim())
    .filter((s) => /[a-z]/i.test(s));
}

/** "@ 350", "at rs 350", "rate 350", "₹350", "350/-" -> 350, and the text without it. */
function takePrice(seg: string): { rest: string; price: number | null } {
  const unitSuffix = '(?:\\s*/-)?(?:\\s*(?:each|per\\s+\\w+|/\\s*\\w+))?';
  const m =
    seg.match(new RegExp(`(?:@|\\bat\\b|\\brate\\b|\\bprice\\b)\\s*(?:\\brs\\.?|\\binr|₹)?\\s*${NUMBER}${unitSuffix}`, 'i')) ||
    seg.match(new RegExp(`(?:\\brs\\.?|\\binr|₹)\\s*${NUMBER}${unitSuffix}`, 'i'));
  if (!m) return { rest: seg, price: null };
  const at = m.index ?? 0;
  return { rest: (seg.slice(0, at) + ' ' + seg.slice(at + m[0].length)).replace(/\s+/g, ' ').trim(), price: toNumber(m[1]) };
}

function plausibleQty(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n < 1_000_000;
}

/** Products the business sells that are named in this segment, each with the number written next to it. */
function productLines(seg: string, price: number | null, products: ProductRef[]): RawSuggestedLine[] {
  const rawToks = words(seg);
  const toks = rawToks.map(stem);
  const taken = new Array(toks.length).fill(false);
  const found: Array<{ product: ProductRef; at: number; len: number }> = [];
  // Longest names first so "Table Calendar" is claimed before a product called just "Calendar"
  const sorted = [...products].sort((a, b) => words(b.name).length - words(a.name).length);
  for (const p of sorted) {
    const pt = words(p.name).map(stem);
    if (!pt.length) continue;
    for (let i = 0; i + pt.length <= toks.length; i++) {
      if (pt.every((t, k) => toks[i + k] === t && !taken[i + k])) {
        found.push({ product: p, at: i, len: pt.length });
        for (let k = 0; k < pt.length; k++) taken[i + k] = true;
        break;
      }
    }
  }
  if (!found.length) return [];
  found.sort((a, b) => a.at - b.at);

  const raw = seg.replace(/\s+/g, ' ');
  const out: RawSuggestedLine[] = [];
  const usedNumber = new Set<number>();
  const isNum = (i: number) => /^\d+(\.\d+)?$/.test(rawToks[i]) && plausibleQty(Number(rawToks[i]));
  for (const f of found) {
    let quantity: number | undefined;
    let unit: string | undefined;
    const claim = (i: number) => {
      quantity = Number(rawToks[i]);
      usedNumber.add(i);
      const u = rawToks[i + 1] && !taken[i + 1] ? lookupUnit(rawToks[i + 1]) : null;
      if (u) unit = u;
    };
    // nearest number to the left ("500 wall calendars", "20 boxes of visiting cards"), never crossing another product
    for (let i = f.at - 1; i >= Math.max(0, f.at - 4) && quantity === undefined; i--) {
      if (taken[i] || usedNumber.has(i)) break;
      if (isNum(i)) claim(i);
    }
    // otherwise the number just after it ("wall calendar x 300")
    for (let i = f.at + f.len; i < Math.min(toks.length, f.at + f.len + 3) && quantity === undefined; i++) {
      if (taken[i] || usedNumber.has(i)) break;
      if (isNum(i) && !NOT_A_QUANTITY_NEXT.test(rawToks[i + 1] ?? '')) claim(i);
    }
    out.push({
      itemName: f.product.name,
      productId: f.product.id,
      quantity,
      unit,
      unitPrice: found.length === 1 ? price ?? undefined : undefined,
      sourceNote: raw.slice(0, 200),
    });
  }
  return out;
}

/** A short list-style line that names something not in the product list: "250 steel almirah", "tea cups - 12 box". */
function genericLine(seg: string, price: number | null): RawSuggestedLine | null {
  const lead = seg.match(new RegExp(`^\\s*${NUMBER}\\s*([a-z.]+)?\\s+(?:of\\s+)?(.+)$`, 'i'));
  const tail = seg.match(new RegExp(`^(.+?)\\s*[-:=x×]?\\s*${NUMBER}\\s*([a-z.]+)?\\s*$`, 'i'));
  let name: string;
  let qty: number;
  let unit: string | null = null;
  if (lead && plausibleQty(toNumber(lead[1])) && lead[1].replace(/\D/g, '').length < 7) {
    if (NOT_A_QUANTITY_NEXT.test(lead[2] ?? '')) return null;
    const maybeUnit = lead[2] ? lookupUnit(lead[2]) : null;
    qty = toNumber(lead[1]);
    unit = maybeUnit;
    name = maybeUnit ? lead[3] : `${lead[2] ?? ''} ${lead[3]}`;
  } else if (tail && plausibleQty(toNumber(tail[2])) && tail[2].replace(/\D/g, '').length < 7 && (!tail[3] || lookupUnit(tail[3]))) {
    qty = toNumber(tail[2]);
    unit = tail[3] ? lookupUnit(tail[3]) : null;
    name = tail[1];
  } else {
    return null;
  }
  const kept = words(name).filter((w) => !FILLER.has(w));
  // Only short, list-like names: a long sentence is not an item
  if (kept.length < 1 || kept.length > 6 || kept.some((w) => /^\d+$/.test(w) || NOISE.has(w))) return null;
  const itemName = kept.join(' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { itemName, quantity: qty, unit: unit ?? undefined, unitPrice: price ?? undefined, sourceNote: seg.slice(0, 200) };
}

export function parseRequestText(text: string, products: ProductRef[] = []): RawSuggestedLine[] {
  const out: RawSuggestedLine[] = [];
  for (const seg of segments(text.slice(0, 20_000))) {
    const { rest, price } = takePrice(seg);
    const known = productLines(rest, price, products);
    if (known.length) out.push(...known);
    else {
      const g = genericLine(rest, price);
      if (g) out.push(g);
    }
  }
  return mergeRepeats(out);
}

/** The same product mentioned twice (title and voice note) is one line: keep the one with the most detail. */
function mergeRepeats(lines: RawSuggestedLine[]): RawSuggestedLine[] {
  const score = (l: RawSuggestedLine) => ['quantity', 'unit', 'unitPrice'].filter((k) => (l as any)[k] !== undefined).length;
  const byKey = new Map<string, RawSuggestedLine>();
  for (const l of lines) {
    const key = typeof l.productId === 'string' ? l.productId : normalizeItemName(String(l.itemName));
    const prev = byKey.get(key);
    if (!prev || score(l) > score(prev)) byKey.set(key, l);
  }
  return [...byKey.values()];
}
