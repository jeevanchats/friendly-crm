import { and, gt, sql } from 'drizzle-orm';
import { db, pgClient, otpVerifications, sessions } from '@friendly-crm/db';

/**
 * AuthService falls back to an in-memory store on any database error, so a broken expiry query
 * does not fail the other suites: sessions silently stop working against a real Postgres instead.
 * These run the same query shapes directly and are skipped when no database is reachable.
 */
describe('Auth expiry queries against a real Postgres', () => {
  let dbReachable = false;

  beforeAll(async () => {
    try {
      await db.execute(sql`SELECT 1`);
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
  });

  afterAll(async () => {
    await pgClient?.end?.({ timeout: 1 });
  });

  it('selects unexpired, unrevoked sessions with a Date bound by gt()', async () => {
    if (!dbReachable) return;
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(sql`${sessions.revokedAt} IS NULL`, gt(sessions.expiresAt, new Date())))
      .limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('selects unexpired, unconsumed OTP records with a Date bound by gt()', async () => {
    if (!dbReachable) return;
    const rows = await db
      .select({ id: otpVerifications.id })
      .from(otpVerifications)
      .where(and(sql`${otpVerifications.consumedAt} IS NULL`, gt(otpVerifications.expiresAt, new Date())))
      .limit(1);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('shows why raw sql with a Date fails (the original bug)', async () => {
    if (!dbReachable) return;
    await expect(
      db
        .select({ id: sessions.id })
        .from(sessions)
        .where(sql`${sessions.expiresAt} > ${new Date()}`)
        .limit(1),
    ).rejects.toThrow();
  });
});
