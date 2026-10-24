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
