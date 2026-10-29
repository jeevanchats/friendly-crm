import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/friendly_crm';

// `import postgres` is undefined when the importing project has no esModuleInterop (the API's Jest setup compiles this
// file with its own tsconfig), which silently left `db` empty and every test on the in-memory store. Fall back to require.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const postgresFn: any = typeof postgres === 'function' ? postgres : (postgres as any)?.default || require('postgres');

// Under Jest the API suites run on the in-memory store (they use made-up business ids), so no pool is opened unless a
// spec asks for a real database: `npm run test:db` sets TEST_REAL_DB=true.
const useDatabase = process.env.NODE_ENV !== 'test' || process.env.TEST_REAL_DB === 'true';

// Standard pooled connection for app
export const pgClient: any = useDatabase && typeof postgresFn === 'function' ? postgresFn(connectionString, {
  max: 10,
  // drizzle-orm already (de)serialises json/jsonb; without this, postgres.js
  // encodes the stringified value a second time and jsonb columns store a JSON string.
  types: {
    json: { to: 114, from: [114], serialize: (v: unknown) => v, parse: (v: unknown) => v },
    jsonb: { to: 3802, from: [3802], serialize: (v: unknown) => v, parse: (v: unknown) => v },
  },
}) : null;
export const db: any = pgClient ? drizzle(pgClient, { schema }) : ({} as any);

// Helper to execute tenant-scoped queries with RLS session setting
export async function withTenantContext<T>(
  tenantId: string,
  callback: (tx: typeof db) => Promise<T>
): Promise<T> {
  return await db.transaction(async (tx: any) => {
    // Set PostgreSQL config variable for Row-Level Security policy
    if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      throw new Error('Invalid tenantId format');
    }
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    return await callback(tx as unknown as typeof db);
  });
}

export { sql };
