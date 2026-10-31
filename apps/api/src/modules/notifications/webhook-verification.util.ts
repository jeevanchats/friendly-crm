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

/**
 * Verifies Twilio's X-Twilio-Signature: base64(HMAC-SHA1(auth token, full URL + every POST field name and value, fields
 * sorted by name)). `url` must be exactly the address configured in Twilio (scheme, host, path and any query).
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, unknown>,
  signature: string | undefined | null,
  authToken: string
): boolean {
  if (!signature || !authToken || !url) return false;
  try {
    let data = url;
    for (const key of Object.keys(params ?? {}).sort()) {
      const value = (params as any)[key];
      data += key + (Array.isArray(value) ? [...value].sort().join(key) : String(value ?? ''));
    }
    const expected = crypto.createHmac('sha1', authToken).update(data, 'utf8').digest();
    const given = Buffer.from(signature.trim(), 'base64');
    return given.length === expected.length && crypto.timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}
