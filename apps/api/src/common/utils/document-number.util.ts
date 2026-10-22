import { sql, and, eq } from 'drizzle-orm';

interface IdempotentEntry {
  tenantId: string;
  operation: string;
  key: string;
  response: any;
  createdAt: number;
}

const idempotencyCache = new Map<string, IdempotentEntry>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getIdempotentResult(tenantId: string, operation: string, key: string): any | null {
  if (!key) return null;
  const storeKey = `${tenantId}:${operation}:${key}`;
  const entry = idempotencyCache.get(storeKey);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > IDEMPOTENCY_TTL_MS) {
    idempotencyCache.delete(storeKey);
    return null;
  }
  return entry.response;
}

export function setIdempotentResult(tenantId: string, operation: string, key: string, response: any): void {
  if (!key) return;
  const storeKey = `${tenantId}:${operation}:${key}`;
  idempotencyCache.set(storeKey, {
    tenantId,
    operation,
    key,
    response,
    createdAt: Date.now(),
  });
}

/**
 * Generates the next sequential document number scoped per tenant & year:
 * e.g., QT-2026-0001, ORD-2026-0001, RCP-2026-0001
 */
export async function getNextDbDocumentNumber(
  tx: any,
  table: any,
  column: any,
  prefix: 'QT' | 'ORD' | 'RCP',
  tenantId: string
): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-%`;

  try {
    const rows = await tx
      .select({ num: column })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), sql`${column} LIKE ${pattern}`));

    let maxSeq = 0;
    for (const row of rows) {
      if (row.num && typeof row.num === 'string') {
        const parts = row.num.split('-');
        if (parts.length >= 3) {
          const numPart = parseInt(parts[2], 10);
          if (!isNaN(numPart) && numPart > maxSeq) {
            maxSeq = numPart;
          }
        }
      }
    }
    return `${prefix}-${year}-${String(maxSeq + 1).padStart(4, '0')}`;
  } catch {
    return `${prefix}-${year}-0001`;
  }
}

/**
 * Generates next sequential document number from memory store scoped per tenant & year
 */
export function getNextMemoryDocumentNumber(
  items: Array<{ tenantId: string; [key: string]: any }>,
  field: string,
  prefix: 'QT' | 'ORD' | 'RCP',
  tenantId: string
): string {
  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-`;

  const tenantItems = items.filter(
    (i) => i.tenantId === tenantId && typeof i[field] === 'string' && (i[field] as string).startsWith(pattern)
  );

  let maxSeq = 0;
  for (const item of tenantItems) {
    const parts = (item[field] as string).split('-');
    if (parts.length >= 3) {
      const numPart = parseInt(parts[2], 10);
      if (!isNaN(numPart) && numPart > maxSeq) {
        maxSeq = numPart;
      }
    }
  }
  return `${prefix}-${year}-${String(maxSeq + 1).padStart(4, '0')}`;
}

/**
 * Exact 2-decimal money rounding to avoid floating point drift
 */
export function roundMoney(val: number): string {
  return (Math.round((val + Number.EPSILON) * 100) / 100).toFixed(2);
}
