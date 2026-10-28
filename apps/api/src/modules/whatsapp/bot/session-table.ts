import { eq, lt } from 'drizzle-orm';
import { db, botSessions } from '@friendly-crm/db';
import { SessionTable } from './session-store';

/** The bot's conversation rows in Postgres (see migration 0018_bot_sessions.sql). */
export const postgresSessionTable: SessionTable = {
  async get(key) {
    const [row] = await db.select().from(botSessions).where(eq(botSessions.key, key)).limit(1);
    return row ? { value: row.value, expiresAt: row.expiresAt } : undefined;
  },
  async upsert(key, value, expiresAt) {
    await db
      .insert(botSessions)
      .values({ key, value: value as Record<string, unknown>, expiresAt })
      .onConflictDoUpdate({ target: botSessions.key, set: { value: value as Record<string, unknown>, expiresAt, updatedAt: new Date() } });
  },
  async remove(key) {
    await db.delete(botSessions).where(eq(botSessions.key, key));
  },
  async sweep(now) {
    await db.delete(botSessions).where(lt(botSessions.expiresAt, now));
  },
};
