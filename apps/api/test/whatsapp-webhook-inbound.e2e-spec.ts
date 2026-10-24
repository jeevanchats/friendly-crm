import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID, createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryOrders,
  globalMemoryAuditLogs,
  globalMemoryQuotations,
  globalMemoryQuotationItems,
  globalMemoryActivities,
} from '../src/modules/crm/memory-store';
import { CustomerQuoteService } from '../src/modules/sales/customer-quote.service';
import { DevNotificationAdapter } from '../src/modules/notifications/adapters/dev-notification.adapter';

describe('WhatsApp inbound webhook -> bot (HTTP level)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let sendSpy: jest.SpyInstance;
  let authService: AuthService;
  let tokenOwner: string;
  let tokenSales: string;

  const TENANT_ID = 'aaaa1111-2222-4333-8444-555566667777';
  const OWNER_ID = 'bbbb1111-2222-4333-8444-555566667777';
  const OWNER_PHONE_E164 = '+919840112299';
  const OWNER_PHONE_META = '919840112299';
  const SECRET = 'dev-webhook-secret';

  const metaBody = (from: string, text: string, id = `wamid.${randomUUID()}`) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'SAME-WABA-ID-FOR-EVERY-EVENT',
        changes: [{ value: { messages: [{ id, from, type: 'text', text: { body: text } }] } }],
      },
    ],
  });

  const post = (body: unknown, signed = true) => {
    const raw = JSON.stringify(body);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (signed) headers['x-hub-signature-256'] = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
    return fetch(`${baseUrl}/api/notifications/whatsapp/webhook`, { method: 'POST', headers, body: raw });
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    process.env.WHATSAPP_WEBHOOK_SECRET = SECRET;
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();

    globalMemoryTenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: 'Webhook Test Printers',
      industryKey: 'printing',
    } as any);
    const auth = moduleFixture.get<AuthService>(AuthService);
    authService = auth;
    auth.registerUser({ id: OWNER_ID, fullName: 'Webhook Owner', phone: OWNER_PHONE_E164 });
    auth.registerMembership(TENANT_ID, OWNER_ID, 'OWNER', true);
    const SALES_ID = 'cccc1111-2222-4333-8444-555566667777';
    auth.registerUser({ id: SALES_ID, fullName: 'Webhook Sales', phone: '+919840777222' });
    auth.registerMembership(TENANT_ID, SALES_ID, 'SALESPERSON', true);
    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!;
      return (await auth.verifyOtp({ phone, code, tenantId: TENANT_ID })).token;
    };
    tokenOwner = await login(OWNER_PHONE_E164);
    tokenSales = await login('+919840777222');

    // A customer (not staff) of the same business, with one order of their own and one belonging to someone else
    globalMemoryCustomers.push({
      id: 'cust-selfservice-1',
      tenantId: TENANT_ID,
      name: 'Karthik Residence',
      phone: '+919840555111',
      whatsappNumber: '+919840555111',
      openingBalance: '0.00',
      creditLimit: '0.00',
      activeOrdersCount: 1,
      totalReceivable: '0.00',
      createdAt: new Date(),
    } as any);
    globalMemoryOrders.push(
      {
        id: 'ord-selfservice-mine',
        tenantId: TENANT_ID,
        customerId: 'cust-selfservice-1',
        orderNumber: 'ORD-SS-7001',
        productionStage: 'PRINTING_CMYK',
        totalAmount: '40000.00',
        advanceReceived: '10000.00',
        balanceDue: '30000.00',
        createdAt: new Date(),
      },
      {
        id: 'ord-selfservice-other',
        tenantId: TENANT_ID,
        customerId: 'someone-else',
        orderNumber: 'ORD-SS-9999',
        productionStage: 'ARTWORK_PENDING',
        totalAmount: '99999.00',
        advanceReceived: '0.00',
        balanceDue: '99999.00',
        createdAt: new Date(),
      }
    );

    sendSpy = jest.spyOn(DevNotificationAdapter.prototype, 'sendMessage');
  });

  afterAll(async () => {
    sendSpy?.mockRestore();
    if (app) await app.close();
  });

  beforeEach(() => sendSpy.mockClear());

  it('rejects an unsigned inbound message (401) and sends nothing', async () => {
    const res = await post(metaBody(OWNER_PHONE_META, 'hi'), false);
    expect(res.status).toBe(401);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('answers a registered staff member with the menu (200)', async () => {
    const res = await post(metaBody(OWNER_PHONE_META, 'hi'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inbound).toEqual({ received: 1, handled: 1 });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0][0];
    expect(sent.recipient).toBe(OWNER_PHONE_E164);
    expect(sent.tenantId).toBe(TENANT_ID);
    expect(sent.message).toContain('New enquiry');
  });

  it('does not process a re-delivered message twice', async () => {
    const body = metaBody(OWNER_PHONE_META, 'hi', `wamid.${randomUUID()}`);
    await post(body);
    sendSpy.mockClear();
    const res = await post(body);
    expect(res.status).toBe(200);
    expect((await res.json()).inbound).toEqual({ received: 1, handled: 0 });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('processes consecutive events that share the same business-account id', async () => {
    // Regression: the Meta entry id is identical on every event and must not be used for de-duplication.
    const a = await post(metaBody(OWNER_PHONE_META, 'hi'));
    const b = await post(metaBody(OWNER_PHONE_META, 'menu'));
    expect((await a.json()).inbound.handled).toBe(1);
    expect((await b.json()).inbound.handled).toBe(1);
  });

  it('tells an unregistered sender they are not registered (and nothing else)', async () => {
    const res = await post(metaBody('910000000001', 'hi'));
    expect(res.status).toBe(200);
    const sent = sendSpy.mock.calls[0][0];
    expect(sent.message).toContain('registered with Friendly CRM');
    expect(sent.message).not.toContain('Webhook Test Printers');
  });

  it('lets a customer see only their own orders (customer self-service)', async () => {
    const greet = await post(metaBody('919840555111', 'hi'));
    expect(greet.status).toBe(200);
    // ownership check first: nothing about the customer is shown until they give their registered name
    const challenge = sendSpy.mock.calls[0][0].message as string;
    expect(challenge).toContain('registered with us');
    expect(challenge).not.toContain('Karthik');
    expect(challenge).not.toContain('ORD-SS-7001');

    sendSpy.mockClear();
    await post(metaBody('919840555111', 'Karthik Residence'));
    expect(sendSpy.mock.calls[0][0].message).toContain('My orders');
    expect(sendSpy.mock.calls[0][0].message).not.toContain('New enquiry');

    sendSpy.mockClear();
    await post(metaBody('919840555111', '1'));
    const mine = sendSpy.mock.calls[0][0].message as string;
    expect(mine).toContain('ORD-SS-7001');
    expect(mine).toContain('30,000');
    expect(mine).not.toContain('ORD-SS-9999');

    sendSpy.mockClear();
    await post(metaBody('919840555111', '9999'));
    const other = sendSpy.mock.calls[0][0].message as string;
    expect(other).toContain("couldn't find that order");
    expect(other).not.toContain('99,999');
  });

  const send = async (from: string, text: string) => {
    sendSpy.mockClear();
    await post(metaBody(from, text));
    return (sendSpy.mock.calls[0]?.[0]?.message ?? '') as string;
  };

  it('owner switches customer self-service OFF on WhatsApp; customers are told, and it is audited', async () => {
    await send(OWNER_PHONE_META, 'hi');
    expect(await send(OWNER_PHONE_META, '5')).toContain('*ON*');
    expect(await send(OWNER_PHONE_META, '1')).toContain('now *OFF*');

    const customerReply = await send('919840555111', '1');
    expect(customerReply).toContain("aren't available");
    expect(customerReply).not.toContain('ORD-SS-7001');

    const audit = globalMemoryAuditLogs.find(
      (a: any) => a.tenantId === TENANT_ID && a.action === 'SETTINGS_UPDATED' && a.changes?.metadata?.channel === 'WHATSAPP'
    );
    expect(audit?.changes?.before).toEqual({ customerSelfServiceEnabled: true });
    expect(audit?.changes?.after).toEqual({ customerSelfServiceEnabled: false });
  });

  it('PATCH /api/tenant/settings: owner can turn it back ON; a salesperson cannot', async () => {
    const url = `${baseUrl}/api/tenant/settings`;
    const hdr = (token: string) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-tenant-id': TENANT_ID,
    });

    const denied = await fetch(url, { method: 'PATCH', headers: hdr(tokenSales), body: JSON.stringify({ customerSelfServiceEnabled: true }) });
    expect(denied.status).toBe(403);

    const bad = await fetch(url, { method: 'PATCH', headers: hdr(tokenOwner), body: JSON.stringify({ customerSelfServiceEnabled: 'yes' }) });
    expect(bad.status).toBe(400);

    const ok = await fetch(url, { method: 'PATCH', headers: hdr(tokenOwner), body: JSON.stringify({ customerSelfServiceEnabled: true }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).customerSelfServiceEnabled).toBe(true);

    const get = await fetch(url, { headers: hdr(tokenOwner) });
    expect((await get.json()).customerSelfServiceEnabled).toBe(true);

    expect(await send('919840555111', '1')).toContain('ORD-SS-7001'); // customers see orders again
  });

  it('PATCH /api/tenant/settings: owner sets the UPI ID (validated, audited); customers then get payment links', async () => {
    const url = `${baseUrl}/api/tenant/settings`;
    const hdr = (token: string) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-tenant-id': TENANT_ID,
    });
    const patch = (token: string, body: unknown) => fetch(url, { method: 'PATCH', headers: hdr(token), body: JSON.stringify(body) });

    expect((await patch(tokenSales, { upiId: 'shop@okhdfc' })).status).toBe(403);
    expect((await patch(tokenOwner, { upiId: 'not a upi id' })).status).toBe(400);
    expect((await patch(tokenOwner, {})).status).toBe(400);

    const ok = await patch(tokenOwner, { upiId: ' webhooktest@okhdfc ' });
    expect(ok.status).toBe(200);
    const saved = await ok.json();
    expect(saved.upiId).toBe('webhooktest@okhdfc');
    expect(saved.customerSelfServiceEnabled).toBe(true); // untouched

    const audit = globalMemoryAuditLogs.find(
      (a: any) => a.tenantId === TENANT_ID && a.action === 'SETTINGS_UPDATED' && a.changes?.after?.upiId === 'webhooktest@okhdfc'
    );
    expect(audit?.changes?.before).toEqual({ upiId: null });
    expect(audit?.changes?.after).toEqual({ upiId: 'webhooktest@okhdfc' });

    // the customer (already verified earlier in this file) now gets a payment link in the dues summary
    const dues = await send('919840555111', '3');
    expect(dues).toContain('Pending dues');
    expect(dues).toContain('upi://pay?pa=webhooktest%40okhdfc');

    const cleared = await patch(tokenOwner, { upiId: null });
    expect((await cleared.json()).upiId).toBeNull();
    expect(await send('919840555111', '3')).not.toContain('upi://');
  });

  describe('customer approves a quote on WhatsApp', () => {
    const CUST = 'cust-quote-1';
    const CUST_META = '919840666222';
    const future = () => new Date(Date.now() + 10 * 86400000);
    const quote = (over: Record<string, unknown>) => ({
      tenantId: TENANT_ID,
      customerId: CUST,
      version: 1,
      status: 'SENT',
      subTotal: '25000.00',
      taxTotal: '0.00',
      discountTotal: '0.00',
      grandTotal: '25000.00',
      validUntil: future(),
      customData: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });
    const item = (quotationId: string) => ({
      id: `qi-${quotationId}`,
      tenantId: TENANT_ID,
      quotationId,
      itemName: 'Wall Calendars 2027',
      quantity: '500.00',
      unit: 'Nos',
      unitPrice: '50.00',
      taxPercent: '0.00',
      lineTotal: '25000.00',
    });

    beforeAll(() => {
      globalMemoryCustomers.push({
        id: CUST,
        tenantId: TENANT_ID,
        name: 'Meena Traders',
        phone: '+919840666222',
        whatsappNumber: '+919840666222',
        openingBalance: '0.00',
        creditLimit: '0.00',
        activeOrdersCount: 0,
        totalReceivable: '0.00',
        createdAt: new Date(),
      } as any);
      globalMemoryCustomers.push({ id: 'cust-quote-2', tenantId: TENANT_ID, name: 'Other Co', phone: '+919840666333', createdAt: new Date() } as any);
      const quotes = [
        quote({ id: 'quote-ss-1', quoteNumber: 'QT-SS-1' }),
        quote({ id: 'quote-ss-expired', quoteNumber: 'QT-SS-EXP', validUntil: new Date(Date.now() - 86400000) }),
        quote({ id: 'quote-ss-other', quoteNumber: 'QT-SS-OTH', customerId: 'cust-quote-2' }),
        quote({ id: 'quote-ss-race', quoteNumber: 'QT-SS-RACE', grandTotal: '10000.00' }),
      ];
      globalMemoryQuotations.push(...(quotes as any[]));
      globalMemoryQuotationItems.push(...quotes.map((q: any) => item(q.id)));
    });

    const ctx = { phone: '+919840666222', messageId: 'wamid.test' };

    it('approve in chat -> order created, quote converted, audited; a second tap creates nothing', async () => {
      expect(await send(CUST_META, 'hi')).toContain('registered with us');
      await send(CUST_META, 'Meena Traders');

      // two open quotes (QT-SS-1 and QT-SS-RACE) -> the bot lists them
      const list = await send(CUST_META, 'quotes');
      expect(list).toContain('Which quote?');
      expect(list).toContain('QT-SS-1');
      expect(list).not.toContain('QT-SS-EXP'); // expired quotes are not offered
      expect(list).not.toContain('QT-SS-OTH'); // another customer's quote is never shown
      const pick = list.match(/(\d+)\.?\s+QT-SS-1\b/)?.[1];
      expect(pick).toBeDefined();
      const detail = await send(CUST_META, pick!);
      expect(detail).toContain('Wall Calendars 2027');
      expect(detail).toContain('₹25,000');

      const done = await send(CUST_META, '1');
      expect(done).toContain('approved');
      const created = globalMemoryOrders.filter((o: any) => o.quotationId === 'quote-ss-1');
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ tenantId: TENANT_ID, customerId: CUST, totalAmount: '25000.00', balanceDue: '25000.00' });
      expect(done).toContain(created[0].orderNumber);
      expect(globalMemoryQuotations.find((q: any) => q.id === 'quote-ss-1')!.status).toBe('CONVERTED');

      const audit = globalMemoryAuditLogs.find((a: any) => a.action === 'QUOTE_APPROVED_BY_CUSTOMER' && a.entityId === 'quote-ss-1');
      expect(audit?.actorId).toBeNull();
      expect(audit?.changes?.metadata).toMatchObject({
        channel: 'WHATSAPP',
        phone: '+919840666222',
        customerId: CUST,
        grandTotal: '25000.00',
        orderNumber: created[0].orderNumber,
      });
      expect(audit?.changes?.metadata?.messageId).toBeTruthy();

      const after = await send(CUST_META, 'quotes'); // only the other open quote is left
      expect(after).toContain('QT-SS-RACE');
      expect(after).not.toContain('QT-SS-1');
      expect(globalMemoryOrders.filter((o: any) => o.quotationId === 'quote-ss-1')).toHaveLength(1);
    });

    it('refuses another customer\'s quote, an expired quote, a changed price and a replay', async () => {
      const svc = app.get(CustomerQuoteService);
      expect(await svc.approve(TENANT_ID, CUST, 'printing', 'quote-ss-other', '25000.00', ctx)).toEqual({ ok: false, reason: 'NOT_AVAILABLE' });
      expect(await svc.approve(TENANT_ID, CUST, 'printing', 'quote-ss-expired', '25000.00', ctx)).toEqual({ ok: false, reason: 'EXPIRED' });
      expect(await svc.approve(TENANT_ID, CUST, 'printing', 'quote-ss-race', '9999.00', ctx)).toEqual({ ok: false, reason: 'CHANGED' });
      expect(await svc.approve('another-tenant', CUST, 'printing', 'quote-ss-race', '10000.00', ctx)).toEqual({ ok: false, reason: 'NOT_AVAILABLE' });
      expect(globalMemoryOrders.some((o: any) => ['quote-ss-other', 'quote-ss-expired'].includes(o.quotationId))).toBe(false);
      expect(globalMemoryQuotations.find((q: any) => q.id === 'quote-ss-race')!.status).toBe('SENT');

      const replay = await svc.approve(TENANT_ID, CUST, 'printing', 'quote-ss-1', '25000.00', ctx);
      expect(replay).toMatchObject({ ok: true, alreadyApproved: true });
    });

    it('two simultaneous approvals create exactly one order', async () => {
      const svc = app.get(CustomerQuoteService);
      const [a, b] = await Promise.all([
        svc.approve(TENANT_ID, CUST, 'printing', 'quote-ss-race', '10000.00', ctx),
        svc.approve(TENANT_ID, CUST, 'printing', 'quote-ss-race', '10000.00', ctx),
      ]);
      expect([a, b].every((r) => r.ok)).toBe(true);
      expect([a, b].filter((r: any) => r.alreadyApproved)).toHaveLength(1);
      expect(globalMemoryOrders.filter((o: any) => o.quotationId === 'quote-ss-race')).toHaveLength(1);
    });

    it('records a change request on the quote timeline without approving', async () => {
      const svc = app.get(CustomerQuoteService);
      globalMemoryQuotations.push(quote({ id: 'quote-ss-change', quoteNumber: 'QT-SS-CHG' }) as any);
      expect(await svc.requestChange(TENANT_ID, CUST, 'quote-ss-change', 'Make it 800 pcs', ctx)).toBe(true);
      const act = globalMemoryActivities.find((a: any) => a.action === 'QUOTE_CHANGE_REQUESTED' && a.entityId === 'quote-ss-change');
      expect(act?.metadata).toMatchObject({ request: 'Make it 800 pcs', channel: 'WHATSAPP' });
      expect(globalMemoryQuotations.find((q: any) => q.id === 'quote-ss-change')!.status).toBe('SENT');
      expect(await svc.requestChange(TENANT_ID, 'cust-quote-2', 'quote-ss-change', 'not mine', ctx)).toBe(false);
    });
  });
});
