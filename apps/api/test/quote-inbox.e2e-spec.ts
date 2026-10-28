import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryQuotations,
  globalMemoryOrders,
  globalMemoryActivities,
  globalMemoryAuditLogs,
} from '../src/modules/crm/memory-store';

describe('Quote inbox: customer change requests and unpaid approved orders', () => {
  let app: INestApplication;
  let baseUrl: string;
  let auth: AuthService;

  const TENANT_ID = '98989898-9898-4989-8989-989898989898';
  const OTHER_TENANT_ID = '97979797-9797-4979-8979-979797979797';
  const USER_OWNER = '11111111-9898-4989-8989-989898989898';
  const USER_SALES = '22222222-9898-4989-8989-989898989898';
  const USER_PROD = '33333333-9898-4989-8989-989898989898';
  let tokenOwner: string;
  let tokenSales: string;
  let tokenProd: string;

  const customerId = 'cust-inbox-1';
  const openQuote = 'quote-inbox-open';
  const revisedQuote = 'quote-inbox-revised';
  const approvedQuote = 'quote-inbox-approved';
  const paidQuote = 'quote-inbox-paid';

  const quote = (id: string, status: string, no: string, total: string, tenantId = TENANT_ID) =>
    globalMemoryQuotations.push({
      id,
      tenantId,
      customerId,
      quoteNumber: no,
      version: 1,
      status,
      subTotal: total,
      taxTotal: '0.00',
      discountTotal: '0.00',
      grandTotal: total,
      customData: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

  const change = (entityId: string, request: string, tenantId = TENANT_ID, ageMs = 0) =>
    globalMemoryActivities.push({
      id: randomUUID(),
      tenantId,
      actorId: null,
      entityType: 'QUOTATION',
      entityId,
      action: 'QUOTE_CHANGE_REQUESTED',
      metadata: { request },
      createdAt: new Date(Date.now() - ageMs),
    } as any);

  const order = (id: string, no: string, quotationId: string, advance: string, balance: string) => {
    globalMemoryOrders.push({
      id,
      tenantId: TENANT_ID,
      orderNumber: no,
      customerId,
      quotationId,
      productionStage: 'ORDER_CONFIRMED',
      totalAmount: '1000.00',
      advanceReceived: advance,
      balanceDue: balance,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    globalMemoryAuditLogs.unshift({
      id: randomUUID(),
      tenantId: TENANT_ID,
      actorId: null,
      action: 'QUOTE_APPROVED_BY_CUSTOMER',
      entityType: 'QUOTATION',
      entityId: quotationId,
      changes: {},
      createdAt: new Date(),
    } as any);
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    auth = fixture.get(AuthService);

    for (const id of [TENANT_ID, OTHER_TENANT_ID]) {
      globalMemoryTenants.set(id, {
        id,
        name: 'Inbox Test Works',
        industryKey: 'printing',
        defaultLanguage: 'en',
        phone: '+919999999999',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }
    auth.registerUser({ id: USER_OWNER, fullName: 'Inbox Owner', phone: '+919840910001' });
    auth.registerUser({ id: USER_SALES, fullName: 'Inbox Sales', phone: '+919840910002' });
    auth.registerUser({ id: USER_PROD, fullName: 'Inbox Prod', phone: '+919840910003' });
    auth.registerMembership(TENANT_ID, USER_OWNER, 'OWNER', true);
    auth.registerMembership(TENANT_ID, USER_SALES, 'SALESPERSON', true);
    auth.registerMembership(TENANT_ID, USER_PROD, 'PRODUCTION', true);

    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!;
      return (await auth.verifyOtp({ phone, code, tenantId: TENANT_ID })).token;
    };
    tokenOwner = await login('+919840910001');
    tokenSales = await login('+919840910002');
    tokenProd = await login('+919840910003');

    globalMemoryCustomers.push({
      id: customerId,
      tenantId: TENANT_ID,
      name: 'Inbox Customer',
      phone: '+919840920000',
      whatsappNumber: '+919840920000',
      openingBalance: '0.00',
      creditLimit: '0.00',
      activeOrdersCount: 0,
      totalReceivable: '0.00',
      createdAt: new Date(),
    } as any);

    quote(openQuote, 'SENT', 'QT-INBOX-1', '1180.00');
    change(openQuote, 'make it 600 copies', TENANT_ID, 60_000);
    change(openQuote, 'make it 500 copies and glossy', TENANT_ID, 1_000); // newer one wins
    quote(revisedQuote, 'SUPERSEDED', 'QT-INBOX-2', '900.00'); // already handled by staff
    change(revisedQuote, 'old request');
    quote('quote-inbox-other', 'SENT', 'QT-INBOX-X', '500.00', OTHER_TENANT_ID);
    change('quote-inbox-other', 'other tenant request', OTHER_TENANT_ID);

    quote(approvedQuote, 'CONVERTED', 'QT-INBOX-3', '1000.00');
    order('order-inbox-unpaid', 'ORD-INBOX-1', approvedQuote, '0.00', '1000.00');
    quote(paidQuote, 'CONVERTED', 'QT-INBOX-4', '1000.00');
    order('order-inbox-paid', 'ORD-INBOX-2', paidQuote, '500.00', '500.00');
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (token: string, tenantId = TENANT_ID) =>
    fetch(`${baseUrl}/api/sales/inbox`, { headers: { authorization: `Bearer ${token}`, 'x-tenant-id': tenantId } });

  it('lists the latest open change request per quote, with amounts for the owner', async () => {
    const res = await get(tokenOwner);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changeRequests).toHaveLength(1);
    expect(body.changeRequests[0]).toMatchObject({
      quotationId: openQuote,
      quoteNumber: 'QT-INBOX-1',
      customerName: 'Inbox Customer',
      customerPhone: '+919840920000',
      request: 'make it 500 copies and glossy',
      grandTotal: '1180.00',
    });
  });

  it('lists approved orders with no payment yet, not ones that already have an advance', async () => {
    const body = await (await get(tokenOwner)).json();
    expect(body.awaitingPayment.map((o: any) => o.orderNumber)).toEqual(['ORD-INBOX-1']);
    expect(body.awaitingPayment[0]).toMatchObject({ balanceDue: '1000.00', totalAmount: '1000.00' });
  });

  it('hides amounts from roles without payment:view', async () => {
    const res = await get(tokenSales);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changeRequests[0].grandTotal).toBeNull();
    expect(body.awaitingPayment[0].balanceDue).toBeNull();
    expect(body.awaitingPayment[0].totalAmount).toBeNull();
  });

  it('refuses roles without quote:view', async () => {
    expect((await get(tokenProd)).status).toBe(403);
  });

  it('refuses a business the user does not belong to, and anonymous callers', async () => {
    expect((await get(tokenOwner, OTHER_TENANT_ID)).status).toBe(403);
    const anon = await fetch(`${baseUrl}/api/sales/inbox`, { headers: { 'x-tenant-id': TENANT_ID } });
    expect(anon.status).toBe(401);
  });
});
