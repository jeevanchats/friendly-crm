import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/friendly_crm';

const postgresFn: any = typeof postgres === 'function' ? postgres : (postgres as any)?.default || postgres;

// Standard pooled connection for app
export const pgClient: any = typeof postgresFn === 'function' ? postgresFn(connectionString, { max: 10 }) : null;
export const db: any = pgClient ? drizzle(pgClient, { schema }) : ({} as any);

// Helper to execute tenant-scoped queries with RLS session setting
export async function withTenantContext<T>(
  tenantId: string,
  callback: (tx: typeof db) => Promise<T>
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Set PostgreSQL config variable for Row-Level Security policy
    await tx.execute(sql.raw(`SET LOCAL app.current_tenant_id = '${tenantId}'`));
    return await callback(tx as unknown as typeof db);
  });
}

export { sql };
