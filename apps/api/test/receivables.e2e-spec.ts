import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { buildReminderMessage } from '../src/modules/receivables/reminder-message';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryOrders,
  globalMemoryActivities,
  globalMemoryOutbox,
} from '../src/modules/crm/memory-store';

describe('reminder message', () => {
  const base = { lang: 'en' as const, customerName: 'Ravi', tenantName: 'Apex Press', tenantPhone: '+919840000000' };

  it('tells the customer how to stop the automatic reminders, in both languages', () => {
    const orders = [{ orderNumber: 'ORD-1', duePaise: 5000 }];
    expect(buildReminderMessage({ ...base, orders }).trim().endsWith('Reply STOP to stop these automatic reminders.')).toBe(true);
    expect(buildReminderMessage({ ...base, lang: 'ta', orders })).toContain('STOP');
  });

  it('shows the total and how to pay: the bank account and UPI ID as plain text, with no links', () => {
    const msg = buildReminderMessage({
      ...base,
      payment: { upiId: 'apex@okhdfc', bank: { accountName: 'Senthaamarai Art Crafts', bankName: 'HDFC Bank', accountNumber: '50200012345678', ifsc: 'HDFC0001234', branch: 'Coimbatore' } },
      orders: [{ orderNumber: 'ORD-1', duePaise: 123450 }],
    });
    expect(msg).toContain('₹1,234.5');
    expect(msg).toContain('Account name: Senthaamarai Art Crafts');
    expect(msg).toContain('Bank: HDFC Bank, Coimbatore');
    expect(msg).toContain('Account no: 50200012345678');
    expect(msg).toContain('IFSC: HDFC0001234');
    expect(msg).toContain('UPI ID: apex@okhdfc');
    expect(msg).not.toMatch(/upi:\/\/|https?:\/\//); // nothing to tap, nothing third-party
    expect(msg).toContain('+919840000000');
  });

  it('shows whichever of bank details and UPI ID the business has, and says nothing about paying when it has neither', () => {
    const orders = [{ orderNumber: 'ORD-1', duePaise: 5000 }];
    const bankOnly = buildReminderMessage({ ...base, payment: { upiId: null, bank: { accountName: 'Senthaamarai Art Crafts', bankName: 'HDFC Bank', accountNumber: '50200012345678', ifsc: 'HDFC0001234', branch: 'Coimbatore' } }, orders });
    expect(bankOnly).toContain('IFSC: HDFC0001234');
    expect(bankOnly).not.toContain('UPI ID');
    const upiOnly = buildReminderMessage({ ...base, payment: { upiId: 'apex@okhdfc', bank: null }, orders });
    expect(upiOnly).toContain('UPI ID: apex@okhdfc');
    expect(upiOnly).not.toContain('Account no');
    for (const none of [undefined, null, { upiId: null, bank: null }]) {
      const msg = buildReminderMessage({ ...base, payment: none as any, orders });
      expect(msg).not.toContain('To pay');
      expect(msg).toContain('ORD-1');
    }
  });

  it('ignores zero balances', () => {
    const msg = buildReminderMessage({ ...base, orders: [{ orderNumber: 'ORD-1', duePaise: 5000 }, { orderNumber: 'ORD-2', duePaise: 0 }] });
    expect(msg).toContain('ORD-1');
    expect(msg).not.toContain('ORD-2');
  });

  it('caps the listed orders and renders Tamil', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ orderNumber: `ORD-${i}`, duePaise: 100 }));
    const msg = buildReminderMessage({ ...base, lang: 'ta', orders: many });
    expect(msg).toContain('வணக்கம் Ravi');
    expect(msg).toContain('ORD-4');
    expect(msg).not.toContain('ORD-5');
    expect(msg).toContain('…மேலும் 3');
  });
});

describe('Receivables: who owes me money', () => {
  let app: INestApplication;
  let baseUrl: string;
  let auth: AuthService;

  const TENANT_ID = '96969696-9696-4969-8969-969696969696';
  const OTHER_TENANT_ID = '95959595-9595-4959-8959-959595959595';
  const USER_OWNER = '11111111-9696-4969-8969-969696969696';
  const USER_PROD = '22222222-9696-4969-8969-969696969696';
  let tokenOwner: string;
  let tokenProd: string;

  const DAY = 86_400_000;
  const custBig = 'cust-recv-big';
  const custSmall = 'cust-recv-small';
  const custClear = 'cust-recv-clear';
  const custNoPhone = 'cust-recv-nophone';

  const cust = (id: string, name: string, phone: string | null, tenantId = TENANT_ID) =>
    globalMemoryCustomers.push({
      id,
      tenantId,
      name,
      phone: phone as any,
      whatsappNumber: phone as any,
      openingBalance: '0.00',
      creditLimit: '0.00',
      activeOrdersCount: 0,
      totalReceivable: '0.00',
      createdAt: new Date(),
    } as any);

  const order = (id: string, no: string, customerId: string, balance: string, ageDays: number, stage = 'ORDER_CONFIRMED', tenantId = TENANT_ID) =>
    globalMemoryOrders.push({
      id,
      tenantId,
      orderNumber: no,
      customerId,
      productionStage: stage,
      totalAmount: '10000.00',
      advanceReceived: '0.00',
      balanceDue: balance,
      createdAt: new Date(Date.now() - ageDays * DAY),
      updatedAt: new Date(),
    } as any);

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
        name: 'Recv Test Press',
        industryKey: 'printing',
        defaultLanguage: 'en',
        phone: '+919999900000',
        upiId: 'recvpress@okhdfc',
        bankAccountName: 'Recv Press',
        bankName: 'SBI',
        bankAccountNumber: '30012345678',
        bankIfsc: 'SBIN0001234',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }
    auth.registerUser({ id: USER_OWNER, fullName: 'Recv Owner', phone: '+919840930001' });
    auth.registerUser({ id: USER_PROD, fullName: 'Recv Prod', phone: '+919840930002' });
    auth.registerMembership(TENANT_ID, USER_OWNER, 'OWNER', true);
    auth.registerMembership(TENANT_ID, USER_PROD, 'PRODUCTION', true);
    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!;
      return (await auth.verifyOtp({ phone, code, tenantId: TENANT_ID })).token;
    };
    tokenOwner = await login('+919840930001');
    tokenProd = await login('+919840930002');

    cust(custBig, 'Big Debtor', '+919840940001');
    cust(custSmall, 'Small Debtor', '+919840940002');
    cust(custClear, 'Paid Up', '+919840940003');
    cust(custNoPhone, 'No Phone', null);
    cust('cust-recv-other', 'Other Tenant Debtor', '+919840940009', OTHER_TENANT_ID);

    order('o-big-old', 'ORD-R1', custBig, '5000.00', 95); // 90+
    order('o-big-new', 'ORD-R2', custBig, '2500.50', 10); // 0-30
    order('o-small', 'ORD-R3', custSmall, '1000.00', 45); // 31-60
    order('o-clear', 'ORD-R4', custClear, '0.00', 20);
    order('o-cancelled', 'ORD-R5', custSmall, '9999.00', 5, 'CANCELLED');
    order('o-nophone', 'ORD-R6', custNoPhone, '700.00', 70); // 61-90
    order('o-other', 'ORD-R7', 'cust-recv-other', '4000.00', 5, 'ORDER_CONFIRMED', OTHER_TENANT_ID);
  });

  afterAll(async () => {
    await app.close();
  });

  const call = (token: string, path: string, method = 'GET') =>
    fetch(`${baseUrl}/api/receivables${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID },
    });

  it('totals, ages and ranks what is owed, excluding cancelled, zero and other businesses', async () => {
    const res = await call(tokenOwner, '');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalDue).toBe('9200.50');
    expect(body.customerCount).toBe(3);
    expect(body.customers.map((c: any) => c.name)).toEqual(['Big Debtor', 'Small Debtor', 'No Phone']);
    const big = body.customers[0];
    expect(big).toMatchObject({ totalDue: '7500.50', oldestAgeDays: 95, bucket: '90+' });
    expect(big.orders.map((o: any) => o.orderNumber)).toEqual(['ORD-R1', 'ORD-R2']);
    expect(Object.fromEntries(body.buckets.map((b: any) => [b.key, b.amount]))).toEqual({
      '0-30': '2500.50',
      '31-60': '1000.00',
      '61-90': '700.00',
      '90+': '5000.00',
      OPENING: '0.00',
    });
  });

  it('sends one reminder with the bank details and UPI ID, records it, and blocks a second within 24 hours', async () => {
    const before = globalMemoryOutbox.length;
    const res = await call(tokenOwner, `/customers/${custBig}/remind`, 'POST');
    expect(res.status).toBe(201);
    const sent = await res.json();
    expect(sent).toMatchObject({ customerId: custBig, sentTo: '+919840940001', totalDue: '7500.50' });

    expect(globalMemoryOutbox.length).toBe(before + 1);
    const job: any = globalMemoryOutbox[0];
    expect(job.recipient).toBe('+919840940001');
    expect(job.renderedMessage).toContain('ORD-R1');
    expect(job.renderedMessage).toContain('IFSC: SBIN0001234');
    expect(job.renderedMessage).toContain('Account no: 30012345678');
    expect(job.renderedMessage).toContain('UPI ID: recvpress@okhdfc');
    expect(job.renderedMessage).not.toContain('upi://');
    expect(job.renderedMessage).toContain('₹7,500.5');

    expect(
      globalMemoryActivities.some((a: any) => a.entityId === custBig && a.action === 'PAYMENT_REMINDER_SENT' && a.tenantId === TENANT_ID)
    ).toBe(true);
    const listed = await (await call(tokenOwner, '')).json();
    expect(listed.customers[0].lastReminderAt).not.toBeNull();

    const again = await call(tokenOwner, `/customers/${custBig}/remind`, 'POST');
    expect(again.status).toBe(409);
    expect(globalMemoryOutbox.length).toBe(before + 1);
  });

  it('rejects customers with nothing due, with no phone, from other businesses and unknown ids', async () => {
    expect((await call(tokenOwner, `/customers/${custClear}/remind`, 'POST')).status).toBe(404);
    expect((await call(tokenOwner, `/customers/${custNoPhone}/remind`, 'POST')).status).toBe(404);
    expect((await call(tokenOwner, '/customers/cust-recv-other/remind', 'POST')).status).toBe(404);
    expect((await call(tokenOwner, '/customers/nope/remind', 'POST')).status).toBe(404);
  });

  it('is closed to roles without payment permissions, anonymous callers and non-members', async () => {
    expect((await call(tokenProd, '')).status).toBe(403);
    expect((await call(tokenProd, `/customers/${custSmall}/remind`, 'POST')).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/receivables`, { headers: { 'x-tenant-id': TENANT_ID } })).status).toBe(401);
    const other = await fetch(`${baseUrl}/api/receivables`, {
      headers: { authorization: `Bearer ${tokenOwner}`, 'x-tenant-id': OTHER_TENANT_ID },
    });
    expect(other.status).toBe(403);
  });
});
