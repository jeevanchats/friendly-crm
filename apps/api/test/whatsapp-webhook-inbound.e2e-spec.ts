import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID, createHmac } from 'crypto';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryOrders, globalMemoryAuditLogs } from '../src/modules/crm/memory-store';
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
});
