import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

/** How long a quote link keeps working after it is made. Quotes are valid for 15 days by default. */
export const QUOTE_LINK_TTL_MS = 60 * 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_VERSION = 1;
/** version(1) + tenant uuid(16) + quote uuid(16) + expiry seconds(5) */
const COMPACT_PAYLOAD_BYTES = 38;
/** A truncated HMAC-SHA256: 128 bits is far beyond guessable, and keeps the link short. */
const COMPACT_SIG_BYTES = 16;

const uuidBytes = (id: string) => Buffer.from(id.replace(/-/g, ''), 'hex');
const bytesUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/**
 * Makes and checks the link a customer taps to open their quotation PDF.
 *
 * The staff screens need a login, but a customer on WhatsApp has none, so the link itself is the key: it carries
 * the business id, the quote id and an expiry, signed with a server secret (HMAC-SHA256). It cannot be guessed or
 * altered, it opens exactly one quote, and it stops working after the expiry. Nothing is stored for it.
 *
 * Tokens are packed in binary (about 70 characters). Ids that are not UUIDs (only seen in tests and the in-memory
 * development store) use an older, longer text form; both forms are still accepted, so links already sent keep working.
 *
 * Needs QUOTE_LINK_SECRET and PUBLIC_API_URL (the address customers can reach, e.g. https://api.yourshop.in) in
 * production. Without them no link is made, rather than sending a broken or unsigned one. In development the
 * secret defaults to a fixed value and the address to http://localhost:4000 (only reachable from this computer).
 */
@Injectable()
export class QuoteLinkService {
  private readonly logger = new Logger(QuoteLinkService.name);
  private warned = false;

  private secret(): string | null {
    const s = process.env.QUOTE_LINK_SECRET;
    if (s && s.length >= 16) return s;
    if (process.env.NODE_ENV === 'production') return null;
    return 'dev-only-quote-link-secret-do-not-use-in-production';
  }

  private baseUrl(): string | null {
    const u = (process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
    if (u) return u;
    return process.env.NODE_ENV === 'production' ? null : 'http://localhost:4000';
  }

  private mac(data: Buffer | string, secret: string): Buffer {
    return createHmac('sha256', secret).update(data).digest();
  }

  /** A signed token for one quote, or null when the server is not configured to make links. */
  createToken(tenantId: string, quoteId: string, now = Date.now(), ttlMs = QUOTE_LINK_TTL_MS): string | null {
    const secret = this.secret();
    if (!secret) return null;

    if (UUID.test(tenantId) && UUID.test(quoteId)) {
      const payload = Buffer.alloc(COMPACT_PAYLOAD_BYTES);
      payload.writeUInt8(COMPACT_VERSION, 0);
      uuidBytes(tenantId).copy(payload, 1);
      uuidBytes(quoteId).copy(payload, 17);
      payload.writeUIntBE(Math.ceil((now + ttlMs) / 1000), 33, 5); // never earlier than asked
      return Buffer.concat([payload, this.mac(payload, secret).subarray(0, COMPACT_SIG_BYTES)]).toString('base64url');
    }

    const payload = Buffer.from(`${tenantId}.${quoteId}.${now + ttlMs}`).toString('base64url');
    return `${payload}.${this.mac(payload, secret).toString('base64url')}`;
  }

  /** The tenant and quote a token opens, or null if it is forged, malformed or expired. */
  verify(token: string, now = Date.now()): { tenantId: string; quoteId: string } | null {
    const secret = this.secret();
    if (!secret || typeof token !== 'string' || token.length === 0 || token.length > 400) return null;
    return token.includes('.') ? this.verifyLegacy(token, secret, now) : this.verifyCompact(token, secret, now);
  }

  private verifyCompact(token: string, secret: string, now: number) {
    const total = COMPACT_PAYLOAD_BYTES + COMPACT_SIG_BYTES;
    // Exactly the right number of characters: the decoder would quietly ignore extra trailing ones.
    if (token.length !== Math.ceil((total * 4) / 3) || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length !== total) return null;
    const payload = raw.subarray(0, COMPACT_PAYLOAD_BYTES);
    const given = raw.subarray(COMPACT_PAYLOAD_BYTES);
    const expected = this.mac(payload, secret).subarray(0, COMPACT_SIG_BYTES);
    if (!timingSafeEqual(given, expected)) return null;
    if (payload.readUInt8(0) !== COMPACT_VERSION) return null;
    if (!(payload.readUIntBE(33, 5) * 1000 > now)) return null;
    return { tenantId: bytesUuid(payload.subarray(1, 17)), quoteId: bytesUuid(payload.subarray(17, 33)) };
  }

  private verifyLegacy(token: string, secret: string, now: number) {
    const [payload, sig, extra] = token.split('.');
    if (!payload || !sig || extra !== undefined) return null;
    const expected = this.mac(payload, secret);
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const parts = Buffer.from(payload, 'base64url').toString('utf8').split('.');
    if (parts.length !== 3) return null;
    const [tenantId, quoteId, exp] = parts;
    if (!tenantId || !quoteId || !(Number(exp) > now)) return null;
    return { tenantId, quoteId };
  }

  /** The full link to put in a WhatsApp message, or null when it cannot be made safely. */
  buildUrl(tenantId: string, quoteId: string): string | null {
    const base = this.baseUrl();
    const token = this.createToken(tenantId, quoteId);
    if (!base || !token) {
      if (!this.warned) {
        this.warned = true;
        this.logger.error('Quote links are off: set QUOTE_LINK_SECRET (16+ characters) and PUBLIC_API_URL to send customers a PDF link.');
      }
      return null;
    }
    return `${base}/api/q/${token}`;
  }
}
