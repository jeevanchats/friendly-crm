import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

/** How long a quote link keeps working after it is made. Quotes are valid for 15 days by default. */
export const QUOTE_LINK_TTL_MS = 60 * 24 * 60 * 60 * 1000;

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

/**
 * Makes and checks the link a customer taps to open their quotation PDF.
 *
 * The staff screens need a login, but a customer on WhatsApp has none, so the link itself is the key: it carries
 * the business id, the quote id and an expiry, signed with a server secret (HMAC-SHA256). It cannot be guessed or
 * altered, it opens exactly one quote, and it stops working after the expiry. Nothing is stored for it.
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

  private sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  /** A signed token for one quote, or null when the server is not configured to make links. */
  createToken(tenantId: string, quoteId: string, now = Date.now(), ttlMs = QUOTE_LINK_TTL_MS): string | null {
    const secret = this.secret();
    if (!secret) return null;
    const payload = b64(`${tenantId}.${quoteId}.${now + ttlMs}`);
    return `${payload}.${this.sign(payload, secret)}`;
  }

  /** The tenant and quote a token opens, or null if it is forged, malformed or expired. */
  verify(token: string, now = Date.now()): { tenantId: string; quoteId: string } | null {
    const secret = this.secret();
    if (!secret || typeof token !== 'string' || token.length > 400) return null;
    const [payload, sig, extra] = token.split('.');
    if (!payload || !sig || extra !== undefined) return null;
    const expected = Buffer.from(this.sign(payload, secret));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let decoded: string;
    try {
      decoded = Buffer.from(payload, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const parts = decoded.split('.');
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
    return `${base}/api/public/quotes/${token}/pdf`;
  }
}
