/**
 * Duplicate control for master records (customers, products).
 *
 * Layer 1 of 2: cheap, certain, no network. It tidies names on save and finds likely duplicates when something is typed.
 * Layer 2 (an AI second opinion on the few candidates found here) is built on top of these candidates.
 */

/** Words that say nothing about WHICH business it is: legal forms and honorifics (Tvl. is the Tamil Nadu GST form of M/s). */
const NOISE_WORDS = new Set([
  'pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'company', 'corp', 'inc', 'and', 'the',
  'ms', 'mr', 'mrs', 'sri', 'shri', 'sree', 'thiru', 'tvl', 'tmt',
]);

/** What the user sees stored: trimmed, with runs of spaces collapsed. Case and punctuation are left as typed. */
export function cleanDisplayName(raw: unknown): string {
  return String(raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Lower-case words with punctuation, legal forms, honorifics and a plural "s" removed. */
export function nameTokens(raw: unknown): string[] {
  const s = cleanDisplayName(raw)
    .toLowerCase()
    .replace(/\bm\s*\/\s*s\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\p{M}\s]+/gu, ' ');
  return s
    .split(/\s+/)
    .filter((t) => t && !NOISE_WORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

/** Words joined with no spaces: "Anand Traders Pvt. Ltd." and "anand-trader" give the same key. */
export const nameKey = (raw: unknown): string => nameTokens(raw).join('');

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1: how alike two names are (1 = the same once tidied). */
export function nameSimilarity(a: unknown, b: unknown): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const ka = ta.join('');
  const kb = tb.join('');
  if (ka === kb) return 1;
  const spelling = 1 - levenshtein(ka, kb) / Math.max(ka.length, kb.length);
  const shared = ta.filter((t) => tb.includes(t)).length;
  const words = (2 * shared) / (ta.length + tb.length);
  return Math.max(spelling, words);
}

export type DuplicateReason = 'gstin' | 'code' | 'same-name' | 'similar-name';

export interface DuplicateHit<T> {
  item: T;
  reason: DuplicateReason;
  /** 0..1, 1 = certain */
  score: number;
}

export const SIMILAR_THRESHOLD = 0.82;

interface Rankable {
  id: string;
  name: string;
  companyName?: string | null;
  gstin?: string | null;
  code?: string | null;
}

/**
 * The records in `pool` that look like the thing being entered, best first.
 * A shared GSTIN or product code is a certain match; otherwise names are compared (a customer's company name counts too).
 */
export function rankSimilar<T extends Rankable>(
  query: { name?: string; companyName?: string; gstin?: string; code?: string },
  pool: T[],
  opts: { threshold?: number; limit?: number; excludeId?: string } = {}
): DuplicateHit<T>[] {
  const threshold = opts.threshold ?? SIMILAR_THRESHOLD;
  const gstin = (query.gstin ?? '').replace(/\s+/g, '').toUpperCase();
  const code = (query.code ?? '').trim().toLowerCase();
  const queryNames = [query.name, query.companyName].filter((n): n is string => !!n && nameTokens(n).length > 0);

  const hits: DuplicateHit<T>[] = [];
  for (const item of pool) {
    if (item.id === opts.excludeId) continue;
    if (gstin && item.gstin && item.gstin.toUpperCase() === gstin) {
      hits.push({ item, reason: 'gstin', score: 1 });
      continue;
    }
    if (code && item.code && item.code.trim().toLowerCase() === code) {
      hits.push({ item, reason: 'code', score: 1 });
      continue;
    }
    const itemNames = [item.name, item.companyName].filter((n): n is string => !!n);
    let best = 0;
    for (const q of queryNames) for (const n of itemNames) best = Math.max(best, nameSimilarity(q, n));
    if (best >= 1) hits.push({ item, reason: 'same-name', score: 1 });
    else if (best >= threshold) hits.push({ item, reason: 'similar-name', score: Math.round(best * 100) / 100 });
  }
  const rank = (h: DuplicateHit<T>) => (h.reason === 'gstin' || h.reason === 'code' ? 2 : 0) + h.score;
  return hits.sort((a, b) => rank(b) - rank(a)).slice(0, opts.limit ?? 5);
}
