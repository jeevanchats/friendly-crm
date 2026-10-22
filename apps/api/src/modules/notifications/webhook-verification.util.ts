import * as crypto from 'crypto';

/**
 * In-memory deduplication cache for webhook events (15 minute TTL)
 */
class WebhookDeduplicationCache {
  private seenEvents = new Map<string, number>();
  private readonly ttlMs = 15 * 60 * 1000; // 15 minutes

  isDuplicate(eventId: string): boolean {
    const now = Date.now();
    this.cleanup(now);

    if (this.seenEvents.has(eventId)) {
      return true;
    }

    this.seenEvents.set(eventId, now);
    return false;
  }

  private cleanup(now: number) {
    if (this.seenEvents.size > 2000) {
      for (const [key, timestamp] of this.seenEvents.entries()) {
        if (now - timestamp > this.ttlMs) {
          this.seenEvents.delete(key);
        }
      }
    }
  }

  clear() {
    this.seenEvents.clear();
  }
}

export const webhookDeduplication = new WebhookDeduplicationCache();

/**
 * Verifies webhook HMAC-SHA256 signature against secret
 */
export function verifyHmacSha256(
  payload: string | Buffer,
  signature: string | undefined | null,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  try {
    const cleanSignature = signature.replace(/^sha256=/i, '').trim();
    const hmac = crypto.createHmac('sha256', secret);
    const expected = hmac.update(payload).digest('hex');

    const expectedBuffer = Buffer.from(expected, 'hex');
    const signatureBuffer = Buffer.from(cleanSignature, 'hex');

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}
