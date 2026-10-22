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
