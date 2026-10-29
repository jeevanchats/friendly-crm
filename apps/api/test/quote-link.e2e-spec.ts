import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { QuoteLinkService, QUOTE_LINK_TTL_MS } from '../src/modules/sales/quote-link.service';
import { PdfEngineService } from '../src/modules/sales/pdf/pdf-engine.service';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryOutbox } from '../src/modules/crm/memory-store';

describe('QuoteLinkService', () => {
  const svc = new QuoteLinkService();
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('makes a token that opens exactly the quote it was made for', () => {
    const token = svc.createToken('tenant-1', 'quote-1')!;
    expect(svc.verify(token)).toEqual({ tenantId: 'tenant-1', quoteId: 'quote-1' });
  });

  it('rejects a changed payload, a changed signature, junk and oversized input', () => {
    const token = svc.createToken('tenant-1', 'quote-1')!;
    const [payload, sig] = token.split('.');
    const other = Buffer.from(`tenant-2.quote-1.${Date.now() + 1e9}`).toString('base64url');
    expect(svc.verify(`${other}.${sig}`)).toBeNull(); // payload swapped, old signature
    expect(svc.verify(`${payload}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(svc.verify(`${payload}.`)).toBeNull();
    expect(svc.verify(payload)).toBeNull();
    expect(svc.verify(`${payload}.${sig}.x`)).toBeNull();
    expect(svc.verify('')).toBeNull();
    expect(svc.verify('a'.repeat(500))).toBeNull();
    expect(svc.verify(undefined as any)).toBeNull();
  });

  it('expires', () => {
    const now = Date.now();
    const token = svc.createToken('t', 'q', now, 1000)!;
    expect(svc.verify(token, now + 500)).not.toBeNull();
    expect(svc.verify(token, now + 1001)).toBeNull();
    expect(QUOTE_LINK_TTL_MS).toBeGreaterThan(15 * 86400000); // outlives the default 15 day quote validity
  });

  it('stops working when the secret changes', () => {
    process.env.QUOTE_LINK_SECRET = 'first-secret-of-sufficient-length';
    const token = svc.createToken('t', 'q')!;
    expect(svc.verify(token)).not.toBeNull();
    process.env.QUOTE_LINK_SECRET = 'second-secret-of-sufficient-length';
    expect(svc.verify(token)).toBeNull();
  });

  it('builds an absolute link from PUBLIC_API_URL, trimming a trailing slash', () => {
    process.env.PUBLIC_API_URL = 'https://api.example.in/';
    const url = svc.buildUrl('t', 'q')!;
    expect(url).toMatch(/^https:\/\/api\.example\.in\/api\/q\/[\w.-]+$/);
  });

  it('makes no link in production unless both settings exist, so a broken or unsigned link is never sent', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.QUOTE_LINK_SECRET;
    delete process.env.PUBLIC_API_URL;
    expect(svc.buildUrl('t', 'q')).toBeNull();
    process.env.QUOTE_LINK_SECRET = 'too-short';
    process.env.PUBLIC_API_URL = 'https://api.example.in';
    expect(svc.buildUrl('t', 'q')).toBeNull(); // a short secret is refused
    process.env.QUOTE_LINK_SECRET = 'a-long-enough-production-secret';
    expect(svc.buildUrl('t', 'q')).toMatch(/^https:\/\/api\.example\.in\/api\/q\//);
    delete process.env.PUBLIC_API_URL;
    expect(svc.buildUrl('t', 'q')).toBeNull(); // no public address to put in the link
  });
});

describe('QuoteLinkService compact tokens (real ids are UUIDs)', () => {
  const svc = new QuoteLinkService();
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const TENANT = '5af19273-0e20-409e-bd15-202b4cd1c138';
  const QUOTE = 'd1171104-ce34-4a32-aaa4-5b55a7015899';

  it('packs a business and quote into a short token that opens exactly them', () => {
    const token = svc.createToken(TENANT, QUOTE)!;
    expect(token.length).toBeLessThanOrEqual(72);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // plain link-safe characters, no dots
    expect(svc.verify(token)).toEqual({ tenantId: TENANT, quoteId: QUOTE });
  });

  it('makes a whole link well under 110 characters', () => {
    process.env.PUBLIC_API_URL = 'https://api.yourshop.in';
    const url = svc.buildUrl(TENANT, QUOTE)!;
    expect(url.length).toBeLessThan(110);
    expect(url).toMatch(/^https:\/\/api\.yourshop\.in\/api\/q\/[\w-]{72}$/);
  });

  it('rejects any single changed character, in the ids, the expiry or the signature', () => {
    const token = svc.createToken(TENANT, QUOTE)!;
    let accepted = 0;
    for (let i = 0; i < token.length; i++) {
      const swap = token[i] === 'A' ? 'B' : 'A';
      const bad = token.slice(0, i) + swap + token.slice(i + 1);
      if (svc.verify(bad)) accepted++;
    }
    // the last character carries only 2 unused bits, so changing it can decode to the same bytes; nothing else may pass
    expect(accepted).toBeLessThanOrEqual(1);
    expect(svc.verify(token.slice(0, -1))).toBeNull();
    expect(svc.verify(token + 'A')).toBeNull();
  });

  it('expires, and stops working when the secret changes', () => {
    process.env.QUOTE_LINK_SECRET = 'first-secret-of-sufficient-length';
    const now = Date.now();
    const token = svc.createToken(TENANT, QUOTE, now, 10_000)!;
    expect(svc.verify(token, now + 5_000)).not.toBeNull();
    expect(svc.verify(token, now + 12_000)).toBeNull();
    process.env.QUOTE_LINK_SECRET = 'second-secret-of-sufficient-length';
    expect(svc.verify(token, now + 5_000)).toBeNull();
  });

  it('does not mix up two quotes', () => {
    const other = 'e2282215-df45-4b43-bbb5-6c66b8126aaa';
    const a = svc.createToken(TENANT, QUOTE)!;
    const b = svc.createToken(TENANT, other)!;
    expect(svc.verify(a)!.quoteId).toBe(QUOTE);
    expect(svc.verify(b)!.quoteId).toBe(other);
    expect(a).not.toBe(b);
  });

  it('still opens links made in the older, longer form', () => {
    const legacy = svc.createToken('tenant-text-id', 'quote-text-id')!;
    expect(legacy).toContain('.');
    expect(svc.verify(legacy)).toEqual({ tenantId: 'tenant-text-id', quoteId: 'quote-text-id' });
  });
});

describe('quotation PDF document', () => {
  it('renders a multi-item quote with long text over several pages into a valid PDF', async () => {
    const engine = new PdfEngineService();
    const items = Array.from({ length: 60 }, (_, i) => ({
      itemName: `Item ${i + 1} with a fairly long name to wrap across the column`,
      description: 'Detailed specification line that is also long enough to wrap around inside its cell',
      hsnCode: '4910',
      quantity: 10,
      unit: 'Nos',
      unitPrice: '100.00',
      taxPercent: '18.00',
      lineTotal: '1180.00',
    }));
    const buf = await engine.generateQuotationPdf({
      quoteNumber: 'QT-2026-0001',
      version: 2,
      createdAt: new Date(),
      validUntil: new Date(Date.now() + 15 * 86400000),
      termsAndConditions: '50% advance. Balance on delivery.',
      business: { name: 'Senthaamarai Art Crafts & Calendars', address: 'Coimbatore', gstin: '33AABCS1234A1Z8', phone: '+919443011111' },
      customer: { name: 'Ravi', companyName: 'Sri Krishna Sweets', phone: '+919443022222', gstin: null, address: 'Salem' },
      items,
      totals: { subTotal: '60000.00', taxTotal: '10800.00', discountTotal: '0.00', grandTotal: '70800.00' },
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    expect(pages).toBeGreaterThan(1);
  });

  it('tolerates hidden amounts (a role that may not see money)', async () => {
    const buf = await new PdfEngineService().generateQuotationPdf({
      quoteNumber: 'QT-2',
      business: { name: 'Biz' },
      customer: { name: 'Cust' },
      items: [{ itemName: 'Thing', quantity: 1, unitPrice: null, lineTotal: null, taxPercent: null }],
      totals: { subTotal: null, taxTotal: null, discountTotal: null, grandTotal: null },
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('customer quote link (HTTP)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let links: QuoteLinkService;
  let ownerToken: string;

  const T = '85858585-8585-4858-8858-858585858585';
  const T2 = '84848484-8484-4848-8848-848484848484';
  const OWNER = '11111111-8585-4858-8858-858585858585';
  let quoteId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    links = fixture.get(QuoteLinkService);
    const auth = fixture.get(AuthService);

    for (const id of [T, T2]) {
      globalMemoryTenants.set(id, { id, name: 'Link Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999966666', isActive: true } as any);
    }
    auth.registerUser({ id: OWNER, fullName: 'Link Owner', phone: '+919840995001' });
    auth.registerMembership(T, OWNER, 'OWNER', true);
    await auth.requestOtp({ phone: '+919840995001', countryCode: '+91' });
    const code = DevSmsGateway.getLatestOtp(auth.normalizePhone('+919840995001'))!;
    ownerToken = (await auth.verifyOtp({ phone: '+919840995001', code, tenantId: T })).token;

    globalMemoryCustomers.push({ id: 'cust-link-1', tenantId: T, name: 'Link Customer', phone: '+919840995002' } as any);
  });

  afterAll(async () => {
    await app.close();
  });

  const publicPdf = (token: string) => fetch(`${baseUrl}/api/q/${token}`); // note: no login at all

  it('sends the customer a link that opens their quote without logging in', async () => {
    const res = await fetch(`${baseUrl}/api/sales/quotations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ownerToken}`, 'x-tenant-id': T, 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: 'cust-link-1', items: [{ unit: 'Nos', itemName: 'Wall Calendar', quantity: 10, unitPrice: 100, taxPercent: 12, hsnCode: '4910' }] }),
    });
    expect(res.status).toBe(201);
    quoteId = (await res.json()).id;

    const msg = (globalMemoryOutbox.find((j: any) => j.recipient === '+919840995002') as any).renderedMessage as string;
    const m = msg.match(/Download PDF: (http\S+)/);
    expect(m).not.toBeNull();
    expect(msg).not.toMatch(/(^|\s)\/q\//); // no more relative, unusable address
    const link = m![1];
    expect(link).toMatch(/\/api\/q\/[\w-]{72}$/);
    expect(link.length).toBeLessThan(120);

    const open = await fetch(link.replace(/^http:\/\/localhost:4000/, baseUrl));
    expect(open.status).toBe(200);
    expect(open.headers.get('content-type')).toContain('application/pdf');
    expect(open.headers.get('cache-control')).toMatch(/no-store/);
    expect(open.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(open.headers.get('content-disposition')).toMatch(/Quotation-QT-/);
    const bytes = Buffer.from(await open.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1500);
  });

  it('answers 404, and nothing more, for forged, expired, unknown and wrong-business links', async () => {
    const good = links.createToken(T, quoteId)!;
    expect((await publicPdf(good)).status).toBe(200);

    expect((await publicPdf(good.slice(0, -3) + 'abc')).status).toBe(404); // forged signature
    expect((await publicPdf('not-a-token')).status).toBe(404);
    expect((await publicPdf(links.createToken(T, quoteId, Date.now() - 2 * QUOTE_LINK_TTL_MS)!)).status).toBe(404); // expired
    expect((await publicPdf(links.createToken(T, 'no-such-quote')!)).status).toBe(404);
    // a validly signed link that pairs the quote with the wrong business still opens nothing
    const crossed = await publicPdf(links.createToken(T2, quoteId)!);
    expect(crossed.status).toBe(404);
    expect(await crossed.text()).not.toMatch(/Link Customer|Wall Calendar/);
  });

  it('the earlier long address keeps working for links already sent', async () => {
    const token = links.createToken(T, quoteId)!;
    const old = await fetch(`${baseUrl}/api/public/quotes/${token}/pdf`);
    expect(old.status).toBe(200);
    expect(old.headers.get('content-type')).toContain('application/pdf');
    expect((await fetch(`${baseUrl}/api/public/quotes/${token}`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/q/${token}/pdf`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/public/quotes/forged/pdf`)).status).toBe(404);
  });

  it('the staff PDF route still needs a login', async () => {
    expect((await fetch(`${baseUrl}/api/sales/quotations/${quoteId}/pdf`, { headers: { 'x-tenant-id': T } })).status).toBe(401);
  });
});
