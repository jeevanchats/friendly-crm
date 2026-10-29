import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { gstinCheckChar, validateContact } from '@friendly-crm/shared';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryContacts, globalMemoryLeads } from '../src/modules/crm/memory-store';

const gstin = (body14: string) => body14 + gstinCheckChar(body14);
const G1 = gstin('33AAACA1234A1Z');
const G2 = gstin('33BBBCB5678B1Z');

describe('contact validation', () => {
  it('needs a name and a valid mobile; tidies the rest', () => {
    expect(validateContact({ name: '  Ravi   Kumar ', phone: '98400 11111', designation: ' Accounts ', email: '' })).toMatchObject({
      ok: true,
      value: { name: 'Ravi Kumar', phone: '+919840011111', designation: 'Accounts', email: null },
    });
    expect(validateContact({ phone: '123' }).errors).toEqual(['Name is missing', 'Phone "123" is not a valid mobile number']);
    expect(validateContact({ name: 'A', phone: '9840011111', email: 'nope' }).ok).toBe(false);
  });
  it('checks only what is sent when editing', () => {
    expect(validateContact({ designation: 'Owner' }, { partial: true })).toMatchObject({ ok: true, value: { designation: 'Owner' } });
    expect(validateContact({ phone: 'x' }, { partial: true }).ok).toBe(false);
  });
});

/** A customer is a business; the people who deal with us for it are its contacts. One number, one customer. */
describe('Customer contacts and one-GSTIN-per-customer', () => {
  let app: INestApplication;
  let baseUrl: string;

  const T = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  const OTHER = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2';
  const OWNER = '11111111-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  const SALES = '22222222-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  const READER = '33333333-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  const STRANGER = '44444444-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
  let owner: string;
  let sales: string;
  let reader: string;
  let stranger: string;

  const call = (token: string, path: string, init: { method?: string; body?: unknown; tenant?: string } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': init.tenant ?? T, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const addContact = (token: string, customerId: string, body: Record<string, unknown>, tenant = T) =>
    call(token, `/crm/customers/${customerId}/contacts`, { method: 'POST', body, tenant });
  const contactsOf = async (customerId: string) => ((await (await call(owner, `/crm/customers/${customerId}/contacts`)).json()) as any).data;

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
      globalMemoryTenants.set(id, { id, name: 'Contacts Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999966666', isActive: true } as any);
    }
    auth.registerUser({ id: OWNER, fullName: 'K Owner', phone: '+919840983001' });
    auth.registerUser({ id: SALES, fullName: 'K Sales', phone: '+919840983002' });
    auth.registerUser({ id: READER, fullName: 'K Reader', phone: '+919840983003' });
    auth.registerUser({ id: STRANGER, fullName: 'K Stranger', phone: '+919840983004' });
    auth.registerMembership(T, OWNER, 'OWNER', true);
    auth.registerMembership(T, SALES, 'SALESPERSON', true);
    auth.registerMembership(T, READER, 'READ_ONLY', true);
    auth.registerMembership(OTHER, STRANGER, 'OWNER', true);
    const login = async (phone: string, tenantId: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      return (await auth.verifyOtp({ phone, code: DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!, tenantId })).token;
    };
    owner = await login('+919840983001', T);
    sales = await login('+919840983002', T);
    reader = await login('+919840983003', T);
    stranger = await login('+919840983004', OTHER);

    globalMemoryCustomers.push(
      { id: 'kc-1', tenantId: T, name: 'Anand Traders', phone: '+919840960001', whatsappNumber: '+919840960009', gstin: G1, openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date() } as any,
      { id: 'kc-2', tenantId: T, name: 'Bala Stores', phone: '+919840960002', gstin: null, openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date() } as any,
      { id: 'kc-3', tenantId: OTHER, name: 'Elsewhere Ltd', phone: '+919840960003', gstin: null, openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date() } as any
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('adds, lists, edits and removes a contact', async () => {
    const res = await addContact(owner, 'kc-1', { name: ' Ravi  Kumar', phone: '98400 70001', designation: 'Accounts', email: 'ravi@anand.example' });
    expect(res.status).toBe(201);
    const c = await res.json();
    expect(c).toMatchObject({ customerId: 'kc-1', name: 'Ravi Kumar', phone: '+919840070001', designation: 'Accounts' });

    expect(await contactsOf('kc-1')).toHaveLength(1);

    const edited = await call(owner, `/crm/customers/kc-1/contacts/${c.id}`, { method: 'PATCH', body: { designation: 'Purchase' } });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ designation: 'Purchase', phone: '+919840070001' });

    expect((await call(owner, `/crm/customers/kc-1/contacts/${c.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await contactsOf('kc-1')).toHaveLength(0);
  });

  it('one number, one customer: refuses a customer phone, a WhatsApp number and another contact, and says whose', async () => {
    expect((await addContact(owner, 'kc-1', { name: 'A', phone: '9840960002' })).status).toBe(409); // another customer's phone
    const own = await addContact(owner, 'kc-1', { name: 'A', phone: '9840960001' }); // its own primary
    expect(own.status).toBe(409);
    expect(await own.json()).toMatchObject({ error: 'PhoneInUse', customerId: 'kc-1' });
    expect((await addContact(owner, 'kc-2', { name: 'A', phone: '9840960009' })).status).toBe(409); // anand's WhatsApp number

    expect((await addContact(owner, 'kc-1', { name: 'Meena', phone: '9840070002' })).status).toBe(201);
    const clash = await addContact(owner, 'kc-2', { name: 'Other', phone: '9840070002' });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ error: 'PhoneInUse', customerId: 'kc-1' });
  });

  it("another business can use the same number, and cannot reach this business's contacts", async () => {
    expect((await addContact(stranger, 'kc-3', { name: 'Same Number', phone: '9840070002' }, OTHER)).status).toBe(201);
    expect((await addContact(stranger, 'kc-1', { name: 'X', phone: '9840070099' }, OTHER)).status).toBe(404);
    expect((await call(stranger, '/crm/customers/kc-1/contacts', { tenant: OTHER })).status).toBe(404);
  });

  it('checks permissions: a read-only user cannot add; a salesperson can add but not remove', async () => {
    expect((await addContact(reader, 'kc-2', { name: 'R', phone: '9840070003' })).status).toBe(403);
    const added = await addContact(sales, 'kc-2', { name: 'Sales Added', phone: '9840070004' });
    expect(added.status).toBe(201);
    const id = (await added.json()).id;
    expect((await call(sales, `/crm/customers/kc-2/contacts/${id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await call(reader, '/crm/customers/kc-2/contacts')).status).toBe(200);
  });

  it('rejects an invalid contact', async () => {
    const res = await addContact(owner, 'kc-2', { name: '', phone: '12' });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toHaveLength(2);
  });

  it("recognises a contact's number: Quick Add lookup and enquiry intake resolve to the customer", async () => {
    const lookup = await (await call(owner, `/crm/customers/lookup?phone=${encodeURIComponent('9840070002')}`)).json();
    expect(lookup).toMatchObject({ status: 'FOUND', matchedOn: 'CONTACT', contactName: 'Meena', customer: { id: 'kc-1', name: 'Anand Traders' } });

    const before = globalMemoryCustomers.filter((c: any) => c.tenantId === T).length;
    const enquiry = await call(owner, '/crm/intake-lead', {
      method: 'POST',
      body: { phone: '9840070002', name: 'Meena', customerName: 'Meena', title: 'Calendars', source: 'PHONE', customData: { job_type: 'CALENDAR' } },
    });
    expect(enquiry.status).toBe(201);
    expect(globalMemoryCustomers.filter((c: any) => c.tenantId === T).length).toBe(before); // no second customer
    expect(globalMemoryLeads.some((l: any) => l.tenantId === T && l.customerId === 'kc-1' && l.title === 'Calendars')).toBe(true);
  });

  it("will not add a customer, or import a row, on a contact's number", async () => {
    const create = await call(owner, '/crm/customers', { method: 'POST', body: { name: 'New Person', phone: '9840070002' } });
    expect(create.status).toBe(409);
    expect((await create.json()).message).toMatch(/Meena.*contact of Anand Traders/);

    const preview = await (await call(owner, '/crm/customers/import', { method: 'POST', body: { dryRun: true, onDuplicate: 'update', rows: [{ name: 'New Person', phone: '9840070002' }] } })).json();
    expect(preview.rows[0]).toMatchObject({ status: 'skip' });
    expect(preview.rows[0].messages.join(' ')).toMatch(/contact of Anand Traders/);
  });

  it('finds a customer in the list by a contact\'s name or number', async () => {
    const byName = await (await call(owner, '/crm/customers?search=meena')).json();
    expect(byName.map((c: any) => c.id)).toContain('kc-1');
    const byPhone = await (await call(owner, '/crm/customers?search=9840070002')).json();
    expect(byPhone.map((c: any) => c.id)).toContain('kc-1');
  });

  it('one GSTIN, one customer: refuses a new customer on a GSTIN already used, and says whose', async () => {
    const res = await call(owner, '/crm/customers', { method: 'POST', body: { name: 'Anand Accounts', phone: '9840070010', gstin: G1.toLowerCase() } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'GstinInUse', customerId: 'kc-1' });
    const ok = await call(owner, '/crm/customers', { method: 'POST', body: { name: 'Different Co', phone: '9840070011', gstin: G2 } });
    expect(ok.status).toBe(201);
  });

  it('refuses to move a GSTIN onto a second customer, but lets a customer keep its own', async () => {
    const clash = await call(owner, '/crm/customers/kc-2/billing', { method: 'PATCH', body: { gstin: G1 } });
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toBe('GstinInUse');
    expect((await call(owner, '/crm/customers/kc-1/billing', { method: 'PATCH', body: { gstin: G1, companyName: 'Anand Traders Pvt Ltd' } })).status).toBe(200);
  });

  it('flags import rows that reuse a GSTIN, in the file or in the master', async () => {
    const G3 = gstin('33CCCCC9999C1Z');
    const r = await (
      await call(owner, '/crm/customers/import', {
        method: 'POST',
        body: {
          dryRun: true,
          onDuplicate: 'skip',
          rows: [
            { name: 'Fresh One', phone: '9840070020', gstin: G3 },
            { name: 'Fresh Two', phone: '9840070021', gstin: G3 },
            { name: 'Uses Anands', phone: '9840070022', gstin: G1 },
          ],
        },
      })
    ).json();
    expect(r.rows.map((x: any) => x.status)).toEqual(['create', 'error', 'error']);
    expect(r.rows[1].messages.join(' ')).toMatch(/Same GSTIN as row 1/);
    expect(r.rows[2].messages.join(' ')).toMatch(/already belongs to Anand Traders/);
  });
});
