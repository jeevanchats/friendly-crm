import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { CustomerQuoteService } from '../src/modules/sales/customer-quote.service';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryOutbox } from '../src/modules/crm/memory-store';

describe('Revising a quote tells the customer', () => {
  let app: INestApplication;
  let baseUrl: string;
  let customerQuotes: CustomerQuoteService;

  const T = '83838383-8383-4838-8838-838383838383';
  const OWNER = '11111111-8383-4838-8838-838383838383';
  const PROD = '22222222-8383-4838-8838-838383838383';
  let owner: string;
  let prod: string;

  const CUSTOMER_ID = '55555555-8383-4838-8838-838383838383';
  const CUSTOMER_PHONE = '+919840996001';
  const NO_PHONE_ID = '66666666-8383-4838-8838-838383838383';

  const http = (token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': T, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  const line = (price: number, qty = 10) => ({ itemName: 'Wall Calendar', quantity: qty, unitPrice: price, taxPercent: 12, hsnCode: '4910' });
  const create = async (customerId = CUSTOMER_ID, items = [line(100)]) =>
    (await (await http(owner, '/sales/quotations', { method: 'POST', body: { customerId, items } })).json());
  const revise = (id: string, items: unknown[], extra: Record<string, unknown> = {}) =>
    http(owner, `/sales/quotations/${id}/revise`, { method: 'POST', body: { items, ...extra } });
  /** Messages queued for the customer, newest first. */
  const sent = (phone = CUSTOMER_PHONE) => globalMemoryOutbox.filter((j: any) => j.recipient === phone).map((j: any) => j.renderedMessage as string);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    customerQuotes = fixture.get(CustomerQuoteService);
    const auth = fixture.get(AuthService);

    globalMemoryTenants.set(T, { id: T, name: 'Revision Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999977777', isActive: true } as any);
    auth.registerUser({ id: OWNER, fullName: 'Rev Owner', phone: '+919840996101' });
    auth.registerUser({ id: PROD, fullName: 'Rev Prod', phone: '+919840996102' });
    auth.registerMembership(T, OWNER, 'OWNER', true);
    auth.registerMembership(T, PROD, 'PRODUCTION', true);
    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!;
      return (await auth.verifyOtp({ phone, code, tenantId: T })).token;
    };
    owner = await login('+919840996101');
    prod = await login('+919840996102');

    globalMemoryCustomers.push({ id: CUSTOMER_ID, tenantId: T, name: 'Revision Customer', phone: CUSTOMER_PHONE, whatsappNumber: CUSTOMER_PHONE } as any);
    globalMemoryCustomers.push({ id: NO_PHONE_ID, tenantId: T, name: 'No Phone Customer', phone: '' } as any);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends the customer the updated quote with the new and the earlier total and a working link', async () => {
    const v1 = await create(); // 10 x 100 + 12% = 1,120
    expect(v1.customerNotified).toBe(true);
    const firstMessage = sent()[0];
    expect(firstMessage).toContain('Here is your quotation');
    const oldLink = firstMessage.match(/Download PDF: (http\S+)/)![1];

    const res = await revise(v1.id, [line(90)]); // 10 x 90 + 12% = 1,008
    expect(res.status).toBe(201);
    const v2 = await res.json();
    expect(v2).toMatchObject({ version: 2, quoteNumber: v1.quoteNumber, status: 'SENT', customerNotified: true });
    expect(v2.pdfUrl).toMatch(/\/api\/q\/[\w-]{72}$/);
    // a fresh validity window of about 15 days from the day it is re-sent
    const days = (new Date(v2.validUntil).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(14.5);
    expect(days).toBeLessThan(15.5);

    const msg = sent()[0];
    expect(msg).not.toBe(firstMessage);
    expect(msg).toContain('Hello Revision Customer');
    expect(msg).toContain(`updated your quotation *${v1.quoteNumber}* (now v2)`);
    expect(msg).toContain('*New Total:* ₹1008.00');
    expect(msg).toContain('*Earlier Total:* ₹1120.00');
    expect(msg).toContain(`Download PDF: ${v2.pdfUrl}`);
    expect(msg).toContain('replaces the earlier version');

    // The link from the ORIGINAL message now opens the current version
    const open = await fetch(oldLink.replace(/^http:\/\/localhost:4000/, baseUrl));
    expect(open.status).toBe(200);
    expect(open.headers.get('x-quote-version')).toBe('2');
    // ...and so does the new one
    const fresh = await fetch(v2.pdfUrl.replace(/^http:\/\/localhost:4000/, baseUrl));
    expect(fresh.headers.get('x-quote-version')).toBe('2');
  });

  it('shows the customer only the newest version when they ask for their quotes', async () => {
    const v1 = await create(CUSTOMER_ID, [line(50)]);
    const v2 = await (await revise(v1.id, [line(60)])).json();
    const v3 = await (await revise(v2.id, [line(70)])).json();
    expect(v3.version).toBe(3);
    const open = (await customerQuotes.listForCustomer(T, CUSTOMER_ID)).filter((q) => q.quoteNumber === v1.quoteNumber);
    expect(open.map((q) => q.version)).toEqual([3]);
    expect(open[0].pdfUrl).toMatch(/\/api\/q\//);
    // and the links of every earlier version lead to v3
    for (const q of [v1, v2]) {
      const link = sent().find((m) => m.includes(q.quoteNumber) && m.includes(`v${q.version}`))!.match(/Download PDF: (http\S+)/)![1];
      const r = await fetch(link.replace(/^http:\/\/localhost:4000/, baseUrl));
      expect(r.headers.get('x-quote-version')).toBe('3');
    }
  });

  it('leaves out the earlier-total line when the total did not change', async () => {
    const v1 = await create(CUSTOMER_ID, [line(80)]);
    await revise(v1.id, [line(80)], { termsAndConditions: 'Delivery within 7 days' });
    expect(sent()[0]).toContain('updated your quotation');
    expect(sent()[0]).not.toContain('Earlier Total');
  });

  it('refuses to revise a version that was already replaced, and a quote that became an order', async () => {
    const v1 = await create(CUSTOMER_ID, [line(10)]);
    expect((await revise(v1.id, [line(11)])).status).toBe(201);
    const again = await revise(v1.id, [line(12)]); // v1 is no longer the current version
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('QuoteSuperseded');

    const approved = await create(CUSTOMER_ID, [line(20)]);
    expect((await http(owner, `/sales/quotations/${approved.id}/convert`, { method: 'POST', body: { industryKey: 'printing' } })).status).toBe(201);
    const blocked = await revise(approved.id, [line(21)]);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe('QuoteAlreadyApproved');
  });

  it('says so, and sends nothing, when the customer has no phone number', async () => {
    const before = globalMemoryOutbox.length;
    const v1 = await create(NO_PHONE_ID, [line(30)]);
    expect(v1.customerNotified).toBe(false);
    const res = await revise(v1.id, [line(31)]);
    expect(res.status).toBe(201);
    expect((await res.json()).customerNotified).toBe(false);
    expect(globalMemoryOutbox.length).toBe(before);
  });

  it('is closed to roles that may not change quotes', async () => {
    const v1 = await create(CUSTOMER_ID, [line(40)]);
    expect((await http(prod, `/sales/quotations/${v1.id}/revise`, { method: 'POST', body: { items: [line(41)] } })).status).toBe(403);
  });
});
