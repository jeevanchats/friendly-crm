export interface SessionStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Process-local session store with TTL and a hard size cap.
 * NOTE: replace with Redis / a DB table before running more than one API instance,
 * otherwise a conversation can break when consecutive messages hit different instances.
 */
export class InMemorySessionStore<T> implements SessionStore<T> {
  private readonly items = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly maxEntries = 5000, private readonly clock: () => number = Date.now) {}

  async get(key: string): Promise<T | undefined> {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.clock()) {
      this.items.delete(key);
      return undefined;
    }
    return hit.value;
  }

  async set(key: string, value: T, ttlMs: number): Promise<void> {
    if (this.items.size >= this.maxEntries && !this.items.has(key)) this.evict();
    this.items.set(key, { value, expiresAt: this.clock() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.items.delete(key);
  }

  private evict() {
    const now = this.clock();
    for (const [k, v] of this.items) if (v.expiresAt <= now) this.items.delete(k);
    // still full: drop the oldest insertion
    if (this.items.size >= this.maxEntries) {
      const first = this.items.keys().next().value;
      if (first !== undefined) this.items.delete(first);
    }
  }
}

/** The slice of the database client the store needs; the real one is Drizzle over Postgres. */
export interface SessionTable {
  get(key: string): Promise<{ value: unknown; expiresAt: Date } | undefined>;
  upsert(key: string, value: unknown, expiresAt: Date): Promise<void>;
  remove(key: string): Promise<void>;
  sweep(now: Date): Promise<void>;
}

/**
 * Conversations kept in Postgres so a restart, or a second API instance, does not drop anyone mid-flow.
 * If the database is unreachable the bot keeps working from process memory (with a warning), exactly as before.
 */
export class DurableSessionStore<T> implements SessionStore<T> {
  private readonly fallback: InMemorySessionStore<T>;
  private lastSweep = 0;

  constructor(
    private readonly table: SessionTable,
    private readonly onFallback: (message: string) => void = () => undefined,
    private readonly clock: () => number = Date.now,
    private readonly sweepEveryMs = 10 * 60 * 1000
  ) {
    this.fallback = new InMemorySessionStore<T>(5000, clock);
  }

  async get(key: string): Promise<T | undefined> {
    try {
      const row = await this.table.get(key);
      if (!row) return undefined;
      if (row.expiresAt.getTime() <= this.clock()) {
        await this.table.remove(key);
        return undefined;
      }
      return row.value as T;
    } catch (err: any) {
      this.onFallback(`bot session read failed, using memory: ${err.message}`);
      return this.fallback.get(key);
    }
  }

  async set(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      await this.table.upsert(key, value, new Date(this.clock() + ttlMs));
      await this.maybeSweep();
    } catch (err: any) {
      this.onFallback(`bot session write failed, using memory: ${err.message}`);
      await this.fallback.set(key, value, ttlMs);
    }
  }

  async delete(key: string): Promise<void> {
    await this.fallback.delete(key);
    try {
      await this.table.remove(key);
    } catch (err: any) {
      this.onFallback(`bot session delete failed: ${err.message}`);
    }
  }

  private async maybeSweep() {
    const now = this.clock();
    if (now - this.lastSweep < this.sweepEveryMs) return;
    this.lastSweep = now;
    await this.table.sweep(new Date(now)).catch(() => undefined);
  }
}
