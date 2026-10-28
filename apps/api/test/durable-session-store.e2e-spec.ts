import { DurableSessionStore, SessionTable } from '../src/modules/whatsapp/bot/session-store';
import { postgresSessionTable } from '../src/modules/whatsapp/bot/session-table';
import { db, pgClient, sql } from '@friendly-crm/db';

/** An in-memory stand-in for the table, so the store's rules are tested without a database. */
function fakeTable(): SessionTable & { rows: Map<string, { value: unknown; expiresAt: Date }>; broken: boolean } {
  const rows = new Map<string, { value: unknown; expiresAt: Date }>();
  const t: any = {
    rows,
    broken: false,
    async get(k: string) { if (t.broken) throw new Error('db down'); return rows.get(k); },
    async upsert(k: string, v: unknown, e: Date) { if (t.broken) throw new Error('db down'); rows.set(k, { value: v, expiresAt: e }); },
    async remove(k: string) { if (t.broken) throw new Error('db down'); rows.delete(k); },
    async sweep(now: Date) { for (const [k, r] of rows) if (r.expiresAt <= now) rows.delete(k); },
  };
  return t;
}

describe('DurableSessionStore', () => {
  let now = 1_000_000;
  const clock = () => now;
  beforeEach(() => { now = 1_000_000; });

  it('keeps a conversation in the table, so a second store (a restart or another instance) can continue it', async () => {
    const table = fakeTable();
    await new DurableSessionStore<any>(table, undefined, clock).set('919840000001', { state: { step: 'ASK_NAME' } }, 60_000);
    const other = new DurableSessionStore<any>(table, undefined, clock);
    expect(await other.get('919840000001')).toEqual({ state: { step: 'ASK_NAME' } });
  });

  it('forgets a conversation after its time is up, and removes the row', async () => {
    const table = fakeTable();
    const store = new DurableSessionStore<any>(table, undefined, clock);
    await store.set('k', { state: { step: 'IDLE' } }, 60_000);
    now += 60_001;
    expect(await store.get('k')).toBeUndefined();
    expect(table.rows.has('k')).toBe(false);
  });

  it('deletes a conversation everywhere', async () => {
    const table = fakeTable();
    const store = new DurableSessionStore<any>(table, undefined, clock);
    await store.set('k', { state: { step: 'IDLE' } }, 60_000);
    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
    expect(table.rows.size).toBe(0);
  });

  it('sweeps expired rows of people who never came back', async () => {
    const table = fakeTable();
    const store = new DurableSessionStore<any>(table, undefined, clock, 1000);
    await store.set('gone', { state: { step: 'IDLE' } }, 10);
    now += 5000;
    await store.set('new', { state: { step: 'IDLE' } }, 60_000);
    expect(table.rows.has('gone')).toBe(false);
    expect(table.rows.has('new')).toBe(true);
  });

  it('keeps the bot working from memory when the database is down, and says so', async () => {
    const table = fakeTable();
    table.broken = true;
    const warnings: string[] = [];
    const store = new DurableSessionStore<any>(table, (m) => warnings.push(m), clock);
    await store.set('k', { state: { step: 'ASK_NAME' } }, 60_000);
    expect(await store.get('k')).toEqual({ state: { step: 'ASK_NAME' } });
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('postgresSessionTable against a real Postgres', () => {
  let reachable = false;
  const KEY = 'zz-test-session';

  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT 1 FROM bot_sessions LIMIT 1`);
      reachable = true;
    } catch {
      reachable = false; // no database, or migration 0018 not applied
    }
  });

  afterAll(async () => {
    if (reachable) await postgresSessionTable.remove(KEY);
    await pgClient?.end?.({ timeout: 1 });
  });

  it('stores, updates, reads back and removes a conversation', async () => {
    if (!reachable) return;
    const later = new Date(Date.now() + 60_000);
    await postgresSessionTable.upsert(KEY, { state: { step: 'ASK_NAME' }, verified: ['t1'] }, later);
    await postgresSessionTable.upsert(KEY, { state: { step: 'DONE' } }, later);
    const row = await postgresSessionTable.get(KEY);
    expect(row?.value).toEqual({ state: { step: 'DONE' } });
    expect(row?.expiresAt.getTime()).toBe(later.getTime());
    await postgresSessionTable.remove(KEY);
    expect(await postgresSessionTable.get(KEY)).toBeUndefined();
  });
});
