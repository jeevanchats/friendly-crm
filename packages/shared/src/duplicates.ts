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

/**
 * Edit distance, giving up as soon as it must exceed `max` (returns max + 1). Only a band of width 2*max+1 around the
 * diagonal is computed, so a comparison costs O(length * max) instead of O(length^2).
 */
function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  const INF = max + 1;
  let prev = new Int32Array(m + 1).fill(INF);
  let cur = new Int32Array(m + 1);
  for (let j = 0; j <= Math.min(m, max); j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur.fill(INF);
    const lo = Math.max(1, i - max);
    const hi = Math.min(m, i + max);
    if (i <= max) cur[0] = i;
    let rowMin = cur[0];
    const ai = a.charCodeAt(i - 1);
    for (let j = lo; j <= hi; j++) {
      let v = prev[j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 1);
      const up = prev[j] + 1;
      const left = cur[j - 1] + 1;
      if (up < v) v = up;
      if (left < v) v = left;
      if (v > INF) v = INF;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return INF;
    const t = prev;
    prev = cur;
    cur = t;
  }
  return Math.min(prev[m], INF);
}

/** A name prepared for comparison: its words, its joined key, and the set of its 3-letter pieces. */
interface PreparedName {
  tokens: string[];
  key: string;
  grams: Set<string>;
  /** How many 3-letter pieces repeat inside the key (the set under-counts the key by this much). */
  repeats: number;
}

function prepare(raw: string): PreparedName {
  const tokens = nameTokens(raw);
  const key = tokens.join('');
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= key.length; i++) grams.add(key.slice(i, i + 3));
  return { tokens, key, grams, repeats: Math.max(0, key.length - 2 - grams.size) };
}

/**
 * 0..1: how alike two prepared names are. With `minScore`, anything that cannot reach it is answered with its word
 * overlap only, without the costly comparison (a necessary-condition check on length and shared 3-letter pieces, then
 * a bounded edit distance).
 */
function similarity(a: PreparedName, b: PreparedName, minScore = 0): number {
  if (!a.tokens.length || !b.tokens.length) return 0;
  if (a.key === b.key) return 1;

  const shared = a.tokens.filter((t) => b.tokens.includes(t)).length;
  let best = (2 * shared) / (a.tokens.length + b.tokens.length);

  const longest = Math.max(a.key.length, b.key.length);
  const maxDist = minScore > 0 ? Math.floor((1 - minScore) * longest) : longest;
  if (Math.abs(a.key.length - b.key.length) > maxDist) return best;

  if (minScore > 0 && longest > 6) {
    // Strings within edit distance d share at least (length - 2 - 3d) 3-letter pieces; allow for repeated pieces.
    const need = longest - 2 - 3 * maxDist - a.repeats - b.repeats;
    if (need > 0) {
      const [small, large] = a.grams.size <= b.grams.size ? [a.grams, b.grams] : [b.grams, a.grams];
      let common = 0;
      for (const g of small) if (large.has(g)) common++;
      if (common < need) return best;
    }
  }

  const d = boundedLevenshtein(a.key, b.key, maxDist);
  if (d <= maxDist) best = Math.max(best, 1 - d / longest);
  return best;
}

/** 0..1: how alike two names are (1 = the same once tidied). */
export function nameSimilarity(a: unknown, b: unknown): number {
  return similarity(prepare(String(a ?? '')), prepare(String(b ?? '')));
}

export type DuplicateReason = 'gstin' | 'code' | 'same-name' | 'similar-name';

export interface DuplicateHit<T> {
  item: T;
  reason: DuplicateReason;
  /** 0..1, 1 = certain */
  score: number;
}

export const SIMILAR_THRESHOLD = 0.82;

/** Score given when one name is the other with more words added ("Chris Graphic" and "Chris Graphic Design Studio"). */
export const CONTAINED_SCORE = 0.85;

/** Options for finding look-alikes. `contained`: also count a name whose (two or more) words are all in the other name. */
export interface FindOptions {
  threshold?: number;
  limit?: number;
  excludeId?: string;
  contained?: boolean;
}

/** True when the shorter name has at least two words and every one of them is also in the longer name. */
function isContained(a: PreparedName, b: PreparedName): boolean {
  const [small, large] = a.tokens.length <= b.tokens.length ? [a, b] : [b, a];
  const words = new Set(small.tokens);
  if (words.size < 2 || large.tokens.length <= small.tokens.length) return false;
  return [...words].every((t) => large.tokens.includes(t));
}

interface Rankable {
  id: string;
  name: string;
  companyName?: string | null;
  gstin?: string | null;
  code?: string | null;
}

/**
 * Prepares a pool of records once so many names can be checked against it quickly (an import checks every row).
 * `find` gives the records that look like the thing entered, best first: a shared GSTIN or product code is a certain
 * match, otherwise names are compared (a customer's company name counts too).
 */
export function makeSimilarFinder<T extends Rankable>(pool: T[]) {
  const prepared = pool.map((item) => ({
    item,
    names: [item.name, item.companyName].filter((n): n is string => !!n).map(prepare),
  }));

  return {
    find(
      query: { name?: string; companyName?: string; gstin?: string; code?: string },
      opts: FindOptions = {}
    ): DuplicateHit<T>[] {
      const threshold = opts.threshold ?? SIMILAR_THRESHOLD;
      const gstin = (query.gstin ?? '').replace(/\s+/g, '').toUpperCase();
      const code = (query.code ?? '').trim().toLowerCase();
      const queryNames = [query.name, query.companyName]
        .filter((n): n is string => !!n)
        .map(prepare)
        .filter((q) => q.tokens.length > 0);

      const hits: DuplicateHit<T>[] = [];
      for (const { item, names } of prepared) {
        if (item.id === opts.excludeId) continue;
        if (gstin && item.gstin && item.gstin.toUpperCase() === gstin) {
          hits.push({ item, reason: 'gstin', score: 1 });
          continue;
        }
        if (code && item.code && item.code.trim().toLowerCase() === code) {
          hits.push({ item, reason: 'code', score: 1 });
          continue;
        }
        let best = 0;
        for (const q of queryNames) {
          for (const n of names) {
            best = Math.max(best, similarity(q, n, threshold));
            if (opts.contained && best < CONTAINED_SCORE && isContained(q, n)) best = CONTAINED_SCORE;
          }
        }
        if (best >= 1) hits.push({ item, reason: 'same-name', score: 1 });
        else if (best >= threshold) hits.push({ item, reason: 'similar-name', score: Math.round(best * 100) / 100 });
      }
      const rank = (h: DuplicateHit<T>) => (h.reason === 'gstin' || h.reason === 'code' ? 2 : 0) + h.score;
      return hits.sort((a, b) => rank(b) - rank(a)).slice(0, opts.limit ?? 5);
    },
  };
}

/** The records in `pool` that look like the thing being entered, best first. See makeSimilarFinder to check many at once. */
export function rankSimilar<T extends Rankable>(
  query: { name?: string; companyName?: string; gstin?: string; code?: string },
  pool: T[],
  opts: FindOptions = {}
): DuplicateHit<T>[] {
  return makeSimilarFinder(pool).find(query, opts);
}

/** Fuzzy comparison of every file row against the whole master costs rows x master; beyond this, only identical names are compared. */
export const FUZZY_PAIR_BUDGET = 250_000;

/**
 * For a file of new rows, the record each one most resembles in `pool` (or undefined), for an import preview.
 * Names that are identical once tidied are always found, instantly. Names that merely look alike are found too, unless
 * the file is so large against the master that comparing every pair would be slow: then `fuzzy` is false and the caller
 * should say that only identical names were compared.
 */
export function findImportNameClashes<T extends Rankable>(
  rows: Array<{ name: string; companyName?: string | null }>,
  pool: T[],
  opts: { budget?: number; contained?: boolean } = {}
): { hits: Array<DuplicateHit<T> | undefined>; fuzzy: boolean } {
  const fuzzy = rows.length * pool.length <= (opts.budget ?? FUZZY_PAIR_BUDGET);
  if (fuzzy) {
    const finder = makeSimilarFinder(pool);
    return { hits: rows.map((r) => finder.find({ name: r.name, companyName: r.companyName ?? undefined }, { limit: 1, contained: opts.contained })[0]), fuzzy };
  }
  const byKey = new Map<string, T>();
  for (const item of pool) {
    for (const n of [item.name, item.companyName]) {
      const k = n ? nameKey(n) : '';
      if (k && !byKey.has(k)) byKey.set(k, item);
    }
  }
  return {
    hits: rows.map((r) => {
      const item = [r.name, r.companyName].map((n) => (n ? nameKey(n) : '')).map((k) => (k ? byKey.get(k) : undefined)).find(Boolean);
      return item ? { item, reason: 'same-name' as const, score: 1 } : undefined;
    }),
    fuzzy,
  };
}
