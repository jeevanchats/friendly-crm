import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryCustomers } from '../src/modules/crm/memory-store';

/**
 * The phone number is the customer's identity. Quick Add looks it up as soon as it is typed, fills the name from the
 * master record, and an enquiry for a known number never creates a second customer.
 */
describe('Customer lookup by phone number', () => {
  let app: INestApplication;
  let baseUrl: string;

  const T = '86868686-8686-4868-8868-868686868686';
  const OTHER = '87878787-8787-4878-8878-878787878787';
  const OWNER = '11111111-8686-4868-8868-868686868686';
  const PROD = '22222222-8686-4868-8868-868686868686';
  const STRANGER = '33333333-8686-4868-8868-868686868686';
  let owner: string;
  let production: string;
  let stranger: string;

  const http = (token: string, path: string, init: { method?: string; body?: unknown; tenant?: string } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': init.tenant ?? T, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const lookup = async (phone: string, token = owner, tenant = T) =>
    (await http(token, `/crm/customers/lookup?phone=${encodeURIComponent(phone)}`, { tenant })).json();
  const enquire = (phone: string, name: string, extra: Record<string, unknown> = {}) =>
    http(owner, '/crm/intake-lead', {
      method: 'POST',
      body: { phone, name, customerName: name, title: `${name} wants calendars`, source: 'PHONE', customData: { job_type: 'CALENDAR' }, ...extra },
    });
  const customersWith = (phone: string) => globalMemoryCustomers.filter((c: any) => c.tenantId === T && (c.phone === phone || c.whatsappNumber === phone));

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const auth = fixture.get(AuthService);
    for (const id of [T, OTHER]) {
      globalMemoryTenants.set(id, { id, name: 'Lookup Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999944444', isActive: true } as any);
    }
    auth.registerUser({ id: OWNER, fullName: 'L Owner', phone: '+919840981001' });
    auth.registerUser({ id: PROD, fullName: 'L Floor', phone: '+919840981002' });
    auth.registerUser({ id: STRANGER, fullName: 'L Stranger', phone: '+919840981003' });
    auth.registerMembership(T, OWNER, 'OWNER', true);
    auth.registerMembership(T, PROD, 'PRODUCTION', true);
    auth.registerMembership(OTHER, STRANGER, 'OWNER', true);
    const login = async (phone: string, tenantId: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      return (await auth.verifyOtp({ phone, code: DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!, tenantId })).token;
    };
    owner = await login('+919840981001', T);
    production = await login('+919840981002', T);
    stranger = await login('+919840981003', OTHER);

    globalMemoryCustomers.push(
      { id: 'cust-lk-1', tenantId: T, name: 'Sri Lakshmi Stores', companyName: 'Lakshmi Retail Pvt Ltd', phone: '+919840980001', whatsappNumber: '+919840980001', openingBalance: '9999.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '5000.00', createdAt: new Date() } as any,
      { id: 'cust-lk-2', tenantId: T, name: 'Ravi Agencies', phone: '+919840980002', whatsappNumber: '+919840980099', openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date() } as any
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('finds the customer however the number is typed', async () => {
    for (const typed of ['9840980001', '09840980001', '+91 98409 80001', '91-9840980001', ' 98409-80001 ']) {
      const r = await lookup(typed);
      expect(r).toMatchObject({ status: 'FOUND', phone: '+919840980001', matchedOn: 'PHONE' });
      expect(r.customer).toMatchObject({ id: 'cust-lk-1', name: 'Sri Lakshmi Stores', companyName: 'Lakshmi Retail Pvt Ltd', phone: '+919840980001' });
    }
  });

  it('finds a customer by their WhatsApp number when it differs from their phone', async () => {
    const r = await lookup('9840980099');
    expect(r).toMatchObject({ status: 'FOUND', matchedOn: 'WHATSAPP' });
    expect(r.customer).toMatchObject({ id: 'cust-lk-2', name: 'Ravi Agencies', phone: '+919840980002' });
  });

  it('says a new number is new, and an unusable one is invalid', async () => {
    expect(await lookup('9840980555')).toEqual({ status: 'NOT_FOUND', phone: '+919840980555' });
    for (const bad of ['12345', 'abc', '', '5840980555', '98409 8055']) {
      expect(await lookup(bad)).toEqual({ status: 'INVALID', phone: null });
    }
  });

  it('shows nothing about money, and nothing from other businesses', async () => {
    const r = await lookup('9840980001');
    expect(Object.keys(r.customer).sort()).toEqual(['companyName', 'id', 'name', 'openEnquiries', 'phone']);
    expect(JSON.stringify(r)).not.toMatch(/9999|5000|balance|receivable|credit/i);
    expect((await lookup('9840980001', stranger, OTHER)).status).toBe('NOT_FOUND');
  });

  it('is only for staff who can add enquiries', async () => {
    expect((await http(production, '/crm/customers/lookup?phone=9840980001')).status).toBe(403);
  });

  it('an enquiry for a known number reuses the customer and keeps the master name, whatever was typed', async () => {
    const before = globalMemoryCustomers.length;
    const res = await enquire('09840980001', 'Lakshmi store (typed differently)');
    expect(res.status).toBe(201);
    const e = await res.json();
    expect(e.isNewCustomer).toBe(false);
    expect(e.customer).toMatchObject({ id: 'cust-lk-1', name: 'Sri Lakshmi Stores', phone: '+919840980001' });
    expect(e.lead.customerId).toBe('cust-lk-1');
    expect(e.followUpTask.title).toContain('Sri Lakshmi Stores');
    expect(globalMemoryCustomers.length).toBe(before);
    expect(customersWith('+919840980001')).toHaveLength(1);

    // the lookup now reports the open enquiry
    expect((await lookup('9840980001')).customer.openEnquiries).toBeGreaterThanOrEqual(1);
  });

  it('an enquiry on a customer\'s WhatsApp number goes to that customer, not a new one', async () => {
    const e = await (await enquire('9840980099', 'Someone')).json();
    expect(e.isNewCustomer).toBe(false);
    expect(e.customer.id).toBe('cust-lk-2');
  });

  it('a new number creates the customer once, stored in the standard +91 form', async () => {
    const e = await (await enquire('09840980777', 'Fresh Traders', { companyName: 'Fresh & Co' })).json();
    expect(e.isNewCustomer).toBe(true);
    expect(e.customer).toMatchObject({ name: 'Fresh Traders', companyName: 'Fresh & Co', phone: '+919840980777' });
    expect(customersWith('+919840980777')).toHaveLength(1);
    // the same person again, typed another way: found, not duplicated
    const again = await (await enquire('+91 98409 80777', 'Fresh Traders Ltd')).json();
    expect(again.isNewCustomer).toBe(false);
    expect(again.customer.id).toBe(e.customer.id);
    expect(customersWith('+919840980777')).toHaveLength(1);
    expect(await lookup('9840980777')).toMatchObject({ status: 'FOUND' });
  });

  it('two people adding the same new number at once end up with one customer', async () => {
    const [a, b] = await Promise.all([enquire('9840980888', 'Twin One'), enquire('09840980888', 'Twin Two')]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const [x, y] = [await a.json(), await b.json()];
    expect(x.customer.id).toBe(y.customer.id);
    expect(customersWith('+919840980888')).toHaveLength(1);
    expect([x.isNewCustomer, y.isNewCustomer].filter(Boolean)).toHaveLength(1);
  });

  it('refuses a number that is not a phone number instead of guessing', async () => {
    for (const bad of ['12345', 'not a number', '0000000000']) {
      const res = await enquire(bad, 'Nobody');
      expect(res.status).toBe(400);
    }
  });
});
