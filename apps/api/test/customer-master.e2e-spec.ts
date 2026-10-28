import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { ReceivablesService } from '../src/modules/receivables/receivables.service';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryOutbox,
  globalMemoryPayments,
} from '../src/modules/crm/memory-store';

describe('Customer master: add, import and opening balances', () => {
  let app: INestApplication;
  let baseUrl: string;
  let receivables: ReceivablesService;

  const T = '89898989-8989-4898-8898-898989898989';
  const T2 = '88888888-8888-4888-8888-888888888888';
  const U_OWNER = '11111111-8989-4898-8898-898989898989';
  const U_SALES = '22222222-8989-4898-8898-898989898989';
  const U_PROD = '33333333-8989-4898-8898-898989898989';
  const U_ACCT = '44444444-8989-4898-8898-898989898989';
  let owner: string;
  let sales: string;
  let prod: string;
  let acct: string;

  const http = (token: string, path: string, init: { method?: string; body?: unknown; tenant?: string; headers?: Record<string, string> } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': init.tenant ?? T,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const tenantCustomers = (tenant = T) => globalMemoryCustomers.filter((c: any) => c.tenantId === tenant);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const auth = fixture.get(AuthService);
    receivables = fixture.get(ReceivablesService);

    for (const id of [T, T2]) {
      globalMemoryTenants.set(id, {
        id,
        name: 'Master Data Press',
        industryKey: 'printing',
        defaultLanguage: 'en',
        phone: '+919999944444',
        upiId: 'masterpress@okhdfc',
        isActive: true,
      } as any);
    }
    const users: Array<[string, string, string, string]> = [
      [U_OWNER, 'M Owner', '+919840980001', 'OWNER'],
      [U_SALES, 'M Sales', '+919840980002', 'SALESPERSON'],
      [U_PROD, 'M Prod', '+919840980003', 'PRODUCTION'],
      [U_ACCT, 'M Accounts', '+919840980004', 'ACCOUNTS'],
    ];
    for (const [id, fullName, phone, role] of users) {
      auth.registerUser({ id, fullName, phone });
      auth.registerMembership(T, id, role as any, true);
    }
    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!;
      return (await auth.verifyOtp({ phone, code, tenantId: T })).token;
    };
    owner = await login('+919840980001');
    sales = await login('+919840980002');
    prod = await login('+919840980003');
    acct = await login('+919840980004');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('adding one customer', () => {
    it('creates a customer without an enquiry and normalises the phone', async () => {
      const res = await http(owner, '/crm/customers', {
        method: 'POST',
        body: { name: ' Anand Traders ', phone: '98400 11111', companyName: 'Anand & Sons', state: 'Tamil Nadu', billingAddress: 'Salem' },
      });
      expect(res.status).toBe(201);
      const c = await res.json();
      expect(c).toMatchObject({ name: 'Anand Traders', phone: '+919840011111', whatsappNumber: '+919840011111', stateCode: '33', companyName: 'Anand & Sons' });
      expect(tenantCustomers().some((x: any) => x.phone === '+919840011111')).toBe(true);
    });

    it('refuses a phone number that is already a customer, naming them', async () => {
      const res = await http(owner, '/crm/customers', { method: 'POST', body: { name: 'Someone Else', phone: '9840011111' } });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toMatchObject({ error: 'CustomerExists' });
      expect(body.message).toMatch(/Anand Traders/);
      expect(body.customerId).toBeTruthy();
    });

    it('lists every problem with a bad form', async () => {
      const res = await http(owner, '/crm/customers', { method: 'POST', body: { name: '', phone: '12', gstin: 'bad' } });
      expect(res.status).toBe(400);
      expect((await res.json()).errors).toHaveLength(3);
    });

    it('lets the same number be a customer of two businesses', async () => {
      globalMemoryCustomers.push({ id: 'other-biz-cust', tenantId: T2, name: 'Other', phone: '+919840022222' } as any);
      const res = await http(owner, '/crm/customers', { method: 'POST', body: { name: 'Mine', phone: '9840022222' } });
      expect(res.status).toBe(201);
    });

    it('enforces roles: opening balance needs payment rights, production cannot add at all', async () => {
      expect((await http(sales, '/crm/customers', { method: 'POST', body: { name: 'S1', phone: '9840033331' } })).status).toBe(201);
      expect((await http(sales, '/crm/customers', { method: 'POST', body: { name: 'S2', phone: '9840033332', openingBalance: '500' } })).status).toBe(403);
      expect((await http(prod, '/crm/customers', { method: 'POST', body: { name: 'P', phone: '9840033333' } })).status).toBe(403);
      expect((await http(owner, '/crm/customers', { method: 'POST', body: { name: 'O', phone: '9840033334', openingBalance: '500' } })).status).toBe(201);
    });
  });

  describe('importing a sheet', () => {
    const rows = [
      { name: 'Import One', phone: '9840044441', state: 'Karnataka', openingBalance: '10,000' },
      { name: 'Import Two', phone: '9840044442', gstin: '27AAPFU0939F1ZV', openingBalance: '2500.50', creditLimit: '50000' },
      { name: 'Existing Anand', phone: '9840011111', companyName: 'Should Not Overwrite Name' },
      { name: 'Bad Phone', phone: '123' },
      { name: 'Twin of One', phone: '098400 44441' },
      { name: '', phone: '9840044445' },
    ];
    const post = (body: unknown, token = owner) => http(token, '/crm/customers/import', { method: 'POST', body });

    it('previews by default without writing anything', async () => {
      const before = tenantCustomers().length;
      const res = await post({ rows });
      expect(res.status).toBe(201);
      const r = await res.json();
      expect(r).toMatchObject({ dryRun: true, created: 2, skipped: 1, errors: 3, updated: 0, openingBalanceTotal: '12500.50' });
      expect(r.rows.map((x: any) => x.status)).toEqual(['create', 'create', 'skip', 'error', 'error', 'error']);
      expect(r.rows[4].messages[0]).toMatch(/Same phone number as row 1/);
      expect(r.rows[3].messages[0]).toMatch(/not a valid mobile number/);
      expect(tenantCustomers().length).toBe(before);
    });

    it('imports the good rows and reports the bad ones, setting opening balances on new customers', async () => {
      const res = await post({ rows, dryRun: false });
      const r = await res.json();
      expect(r).toMatchObject({ dryRun: false, created: 2, skipped: 1, errors: 3 });
      const one = tenantCustomers().find((x: any) => x.phone === '+919840044441') as any;
      const two = tenantCustomers().find((x: any) => x.phone === '+919840044442') as any;
      expect(one).toMatchObject({ name: 'Import One', stateCode: '29', openingBalance: '10000.00' });
      expect(two).toMatchObject({ stateCode: '27', gstin: '27AAPFU0939F1ZV', openingBalance: '2500.50', creditLimit: '50000.00' });
      expect((tenantCustomers().find((x: any) => x.phone === '+919840011111') as any).name).toBe('Anand Traders');
      expect(tenantCustomers().some((x: any) => x.phone === '+919840044445')).toBe(false);
    });

    it('importing the same file again adds nothing', async () => {
      const before = tenantCustomers().length;
      const r = await (await post({ rows, dryRun: false })).json();
      expect(r).toMatchObject({ created: 0, skipped: 3, errors: 3 });
      expect(tenantCustomers().length).toBe(before);
    });

    it("'update' fills blanks on existing customers but never touches their balance", async () => {
      const r = await (
        await post({
          rows: [{ name: 'Whatever', phone: '9840044441', companyName: 'One & Co', billingAddress: 'Hubli', openingBalance: '999' }],
          dryRun: false,
          onDuplicate: 'update',
        })
      ).json();
      expect(r).toMatchObject({ updated: 1, created: 0 });
      expect(r.rows[0].messages.join(' ')).toMatch(/Opening balance not changed/);
      const one = tenantCustomers().find((x: any) => x.phone === '+919840044441') as any;
      expect(one).toMatchObject({ name: 'Import One', companyName: 'One & Co', billingAddress: 'Hubli', openingBalance: '10000.00' });
    });

    it('refuses empty, oversized and non-array input', async () => {
      expect((await post({ rows: [] })).status).toBe(400);
      expect((await post({ rows: 'nope' })).status).toBe(400);
      const big = Array.from({ length: 1001 }, (_, i) => ({ name: `N${i}`, phone: `98400${String(50000 + i)}` }));
      const res = await post({ rows: big });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/at most 1000/);
    });

    it('checks permissions: sales may import contacts but not balances; production may not import', async () => {
      expect((await post({ rows: [{ name: 'Sales Imp', phone: '9840066661' }], dryRun: false }, sales)).status).toBe(201);
      expect((await post({ rows: [{ name: 'Sales Bal', phone: '9840066662', openingBalance: '10' }] }, sales)).status).toBe(403);
      expect((await post({ rows: [{ name: 'Prod', phone: '9840066663' }] }, prod)).status).toBe(403);
      expect((await post({ rows: [{ name: 'X', phone: '9840066664' }] }, acct)).status).toBe(403); // accounts: no customer:create
    });
  });

  describe('opening balances in "who owes me"', () => {
    const get = () => http(owner, '/receivables').then((r) => r.json());

    it('shows imported balances in their own bucket and in the total', async () => {
      const r = await get();
      const names = r.customers.map((c: any) => c.name);
      expect(names).toEqual(expect.arrayContaining(['Import One', 'Import Two', 'O']));
      const one = r.customers.find((c: any) => c.name === 'Import One');
      expect(one).toMatchObject({ openingBalance: '10000.00', totalDue: '10000.00', bucket: 'OPENING', orders: [] });
      const opening = r.buckets.find((b: any) => b.key === 'OPENING');
      expect(Number(opening.amount)).toBeGreaterThanOrEqual(12500.5);
      expect(Number(r.totalDue)).toBeGreaterThanOrEqual(12500.5);
    });

    it('reminds a customer about a previous balance, with the UPI ID to pay to', async () => {
      const one = (await get()).customers.find((c: any) => c.name === 'Import One');
      const before = globalMemoryOutbox.length;
      const res = await http(owner, `/receivables/customers/${one.customerId}/remind`, { method: 'POST' });
      expect(res.status).toBe(201);
      expect(globalMemoryOutbox.length).toBe(before + 1);
      const msg = (globalMemoryOutbox[0] as any).renderedMessage;
      expect(msg).toContain('Previous balance');
      expect(msg).toContain('UPI ID: masterpress@okhdfc');
      expect(msg).toContain('₹10,000');
      expect(msg).not.toContain('upi://');
    });

    it('does not auto-remind an imported balance until the grace period has passed', async () => {
      await http(owner, '/tenant/settings', { method: 'PATCH', body: { autoRemindersEnabled: true, reminderAfterDays: 7 } });
      const two = (await get()).customers.find((c: any) => c.name === 'Import Two');
      const before = globalMemoryOutbox.length;
      const base = new Date();
      const tenAmIst = (offsetDays: number) => new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offsetDays, 4, 30));
      await receivables.runAutoReminders(tenAmIst(0));
      expect(globalMemoryOutbox.slice(0, globalMemoryOutbox.length - before).some((j: any) => /2,?500/.test(j.renderedMessage) && j.recipient === '+919840044442')).toBe(false);
      await receivables.runAutoReminders(tenAmIst(8));
      expect(globalMemoryOutbox.slice(0, globalMemoryOutbox.length - before).some((j: any) => j.recipient === '+919840044442')).toBe(true);
      void two;
    });
  });

  describe('recording a payment against an opening balance', () => {
    const find = async (name: string) => (await http(owner, '/receivables').then((r) => r.json())).customers.find((c: any) => c.name === name);
    const pay = (token: string, id: string, body: unknown, headers?: Record<string, string>) =>
      http(token, `/receivables/customers/${id}/payments`, { method: 'POST', body, headers });

    it('reduces the balance, issues a receipt and sends it', async () => {
      const c = await find('Import Two');
      const before = globalMemoryOutbox.length;
      const res = await pay(acct, c.customerId, { amount: 500.5, mode: 'upi', referenceNo: 'UTR-OPEN-1' });
      expect(res.status).toBe(201);
      const r = await res.json();
      expect(r).toMatchObject({ amount: '500.50', openingBalanceRemaining: '2000.00', totalRemaining: '2000.00' });
      expect(r.receiptNumber).toMatch(/^RCP-/);
      expect((await find('Import Two')).openingBalance).toBe('2000.00');
      const receipt = globalMemoryOutbox.slice(0, globalMemoryOutbox.length - before).find((j: any) => /Import Two/.test(j.renderedMessage));
      expect((receipt as any).renderedMessage).toContain(r.receiptNumber);
      expect(globalMemoryPayments.some((p: any) => p.customerId === c.customerId && p.orderId === null && p.amount === '500.50')).toBe(true);
    });

    it('refuses overpayment, zero, junk, duplicate references and unknown modes', async () => {
      const c = await find('Import Two');
      expect((await pay(owner, c.customerId, { amount: 2000.01 })).status).toBe(400);
      expect((await pay(owner, c.customerId, { amount: 0 })).status).toBe(400);
      expect((await pay(owner, c.customerId, { amount: 'lots' })).status).toBe(400);
      expect((await pay(owner, c.customerId, { amount: 1.005 })).status).toBe(400);
      expect((await pay(owner, c.customerId, { amount: 1, mode: 'BARTER' })).status).toBe(400);
      expect((await pay(owner, c.customerId, { amount: 1, referenceNo: 'UTR-OPEN-1' })).status).toBe(400);
      expect((await find('Import Two')).openingBalance).toBe('2000.00');
    });

    it('is idempotent for a repeated request and can clear the balance exactly', async () => {
      const c = await find('Import Two');
      const headers = { 'idempotency-key': 'open-pay-1' };
      const a = await (await pay(owner, c.customerId, { amount: 100 }, headers)).json();
      const b = await (await pay(owner, c.customerId, { amount: 100 }, headers)).json();
      expect(b.isIdempotent).toBe(true);
      expect(b.receiptNumber).toBe(a.receiptNumber);
      expect((await find('Import Two')).openingBalance).toBe('1900.00');
      const last = await (await pay(owner, c.customerId, { amount: 1900 })).json();
      expect(last.openingBalanceRemaining).toBe('0.00');
      expect(await find('Import Two')).toBeUndefined(); // nothing owed, so no longer listed
    });

    it('is closed to roles without payment rights and to other businesses', async () => {
      const c = await find('Import One');
      expect((await pay(sales, c.customerId, { amount: 1 })).status).toBe(403);
      expect((await pay(prod, c.customerId, { amount: 1 })).status).toBe(403);
      expect((await pay(owner, 'no-such-customer', { amount: 1 })).status).toBe(404);
      globalMemoryCustomers.push({ id: 'cust-t2-open', tenantId: T2, name: 'T2 Owes', phone: '+919840077771', openingBalance: '300.00' } as any);
      expect((await pay(owner, 'cust-t2-open', { amount: 1 })).status).toBe(404);
    });
  });
});
