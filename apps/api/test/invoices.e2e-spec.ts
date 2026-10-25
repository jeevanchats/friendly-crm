import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { InvoicesService } from '../src/modules/invoices/invoices.service';
import { gstinCheckChar } from '@friendly-crm/shared';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryOrders,
  globalMemoryOrderItems,
  globalMemoryInvoices,
} from '../src/modules/crm/memory-store';

const gstin = (first14: string) => first14 + gstinCheckChar(first14);

describe('GST invoices', () => {
  let app: INestApplication;
  let baseUrl: string;
  let auth: AuthService;
  let invoices: InvoicesService;

  const TENANT = '93939393-9393-4939-8939-939393939393';
  const OTHER_TENANT = '92929292-9292-4929-8929-929292929292';
  const U_OWNER = '11111111-9393-4939-8939-939393939393';
  const U_SALES = '22222222-9393-4939-8939-939393939393';
  const U_PROD = '33333333-9393-4939-8939-939393939393';
  const U_ACCOUNTS = '44444444-9393-4939-8939-939393939393';
  let owner: string;
  let sales: string;
  let prod: string;
  let accounts: string;

  const SUPPLIER_GSTIN = gstin('33AABCS1234A1Z'); // Tamil Nadu
  const BUYER_TN_GSTIN = gstin('33AAAAA0000A1Z');
  const BUYER_MH_GSTIN = '27AAPFU0939F1ZV'; // Maharashtra

  let seq = 0;
  const addCustomer = (name: string, extra: Record<string, unknown> = {}) => {
    const id = `cust-inv-${++seq}`;
    globalMemoryCustomers.push({
      id,
      tenantId: TENANT,
      name,
      phone: `+9198409600${String(seq).padStart(2, '0')}`,
      openingBalance: '0.00',
      creditLimit: '0.00',
      activeOrdersCount: 0,
      totalReceivable: '0.00',
      createdAt: new Date(),
      ...extra,
    } as any);
    return id;
  };

  /** An order of 100 x Rs.10 @18% = 1,180 (before any discount). */
  const addOrder = (
    customerId: string,
    opts: { total?: string; balance?: string; hsn?: string | null; itemName?: string; stage?: string; tenantId?: string } = {}
  ) => {
    const id = `ord-inv-${++seq}`;
    const total = opts.total ?? '1180.00';
    globalMemoryOrders.unshift({
      id,
      tenantId: opts.tenantId ?? TENANT,
      orderNumber: `ORD-INV-${seq}`,
      customerId,
      productionStage: opts.stage ?? 'ORDER_CONFIRMED',
      totalAmount: total,
      advanceReceived: '0.00',
      balanceDue: opts.balance ?? total,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    const itemId = `item-inv-${seq}`;
    globalMemoryOrderItems.push({
      id: itemId,
      tenantId: opts.tenantId ?? TENANT,
      orderId: id,
      itemName: opts.itemName ?? 'Wall calendar',
      description: null,
      quantity: '100.00',
      unit: 'Nos',
      unitPrice: '10.00',
      taxPercent: '18.00',
      hsnCode: opts.hsn === undefined ? null : opts.hsn,
      lineTotal: '1180.00',
    } as any);
    return { id, itemId };
  };

  const http = (token: string, path: string, init: { method?: string; body?: unknown; tenant?: string } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': init.tenant ?? TENANT,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  const settings = (body: unknown) => http(owner, '/tenant/settings', { method: 'PATCH', body });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    auth = fixture.get(AuthService);
    invoices = fixture.get(InvoicesService);

    for (const id of [TENANT, OTHER_TENANT]) {
      globalMemoryTenants.set(id, {
        id,
        name: 'Senthaamarai Prints',
        industryKey: 'printing',
        defaultLanguage: 'en',
        phone: '+919999911111',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }
    const users: Array<[string, string, string, string]> = [
      [U_OWNER, 'Inv Owner', '+919840960001', 'OWNER'],
      [U_SALES, 'Inv Sales', '+919840960002', 'SALESPERSON'],
      [U_PROD, 'Inv Prod', '+919840960003', 'PRODUCTION'],
      [U_ACCOUNTS, 'Inv Accounts', '+919840960004', 'ACCOUNTS'],
    ];
    for (const [id, fullName, phone, role] of users) {
      auth.registerUser({ id, fullName, phone });
      auth.registerMembership(TENANT, id, role as any, true);
    }
    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!;
      return (await auth.verifyOtp({ phone, code, tenantId: TENANT })).token;
    };
    owner = await login('+919840960001');
    sales = await login('+919840960002');
    prod = await login('+919840960003');
    accounts = await login('+919840960004');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('business details', () => {
    it('rejects a malformed GSTIN, a bad check character, and a state that disagrees with the GSTIN', async () => {
      expect((await settings({ gstNumber: 'NOTAGSTIN' })).status).toBe(400);
      expect((await settings({ gstNumber: SUPPLIER_GSTIN.slice(0, 14) + (SUPPLIER_GSTIN[14] === 'A' ? 'B' : 'A') })).status).toBe(400);
      expect((await settings({ gstNumber: SUPPLIER_GSTIN, stateCode: '27' })).status).toBe(400);
      expect((await settings({ stateCode: '99' })).status).toBe(400);
    });

    it('saves a valid GSTIN, derives the state, and stores the legal name and address', async () => {
      const res = await settings({ gstNumber: SUPPLIER_GSTIN.toLowerCase(), legalName: 'Senthaamarai Art Crafts', address: '12 Bazaar St, Coimbatore 641001' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        gstNumber: SUPPLIER_GSTIN,
        stateCode: '33',
        legalName: 'Senthaamarai Art Crafts',
        address: '12 Bazaar St, Coimbatore 641001',
      });
    });

    it('only owners can change them', async () => {
      expect((await http(sales, '/tenant/settings', { method: 'PATCH', body: { legalName: 'X' } })).status).toBe(403);
    });

    it('validates customer billing details and lets a GSTIN set the state', async () => {
      const id = addCustomer('Billing Test');
      const bad = await http(owner, `/crm/customers/${id}/billing`, { method: 'PATCH', body: { gstin: '27AAPFU0939F1ZX' } });
      expect(bad.status).toBe(400);
      const mismatch = await http(owner, `/crm/customers/${id}/billing`, { method: 'PATCH', body: { gstin: BUYER_MH_GSTIN, stateCode: '33' } });
      expect(mismatch.status).toBe(400);
      const ok = await http(owner, `/crm/customers/${id}/billing`, { method: 'PATCH', body: { gstin: BUYER_MH_GSTIN, billingAddress: 'Pune' } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ gstin: BUYER_MH_GSTIN, stateCode: '27', billingAddress: 'Pune' });
      expect((await http(prod, `/crm/customers/${id}/billing`, { method: 'PATCH', body: { billingAddress: 'x' } })).status).toBe(403);
    });
  });

  describe('preparing and issuing', () => {
    it('lists what is missing before an invoice can be issued', async () => {
      // A business with no GSTIN yet
      globalMemoryTenants.set(OTHER_TENANT, { ...(globalMemoryTenants.get(OTHER_TENANT) as any), gstNumber: null, address: null });
      const prep = await invoices.prepare(OTHER_TENANT, (() => {
        const id = `ord-other-${++seq}`;
        globalMemoryCustomers.push({ id: `c-other-${seq}`, tenantId: OTHER_TENANT, name: 'Other Cust', phone: '+919840969999' } as any);
        globalMemoryOrders.push({ id, tenantId: OTHER_TENANT, orderNumber: 'ORD-O', customerId: `c-other-${seq}`, productionStage: 'ORDER_CONFIRMED', totalAmount: '1180.00', balanceDue: '1180.00' } as any);
        globalMemoryOrderItems.push({ id: `i-${id}`, tenantId: OTHER_TENANT, orderId: id, itemName: 'Thing', quantity: '1', unit: 'Nos', unitPrice: '1000', taxPercent: '18', hsnCode: null } as any);
        return id;
      })());
      expect(prep.problems.join(' | ')).toMatch(/GSTIN/);
      expect(prep.problems.join(' | ')).toMatch(/address/);
      expect(prep.problems.join(' | ')).toMatch(/HSN\/SAC code for "Thing"/);
      expect(prep.preview).toBeNull();
    });

    it('asks for an HSN code per line, and refuses to issue without one', async () => {
      const c = addCustomer('No HSN Co');
      const o = addOrder(c);
      const prep = await (await http(owner, `/invoices/prepare/${o.id}`)).json();
      expect(prep.problems).toEqual([expect.stringContaining('HSN/SAC code for "Wall calendar"')]);
      expect(prep.lines[0].hsnCode).toBeNull();
      expect(prep.preview).toBeNull();

      const res = await http(owner, '/invoices', { method: 'POST', body: { orderId: o.id } });
      expect(res.status).toBe(422);
      expect((await res.json()).problems[0]).toMatch(/HSN/);

      const badHsn = await http(owner, '/invoices', { method: 'POST', body: { orderId: o.id, hsn: { [o.itemId]: '12' } } });
      expect(badHsn.status).toBe(422);
    });

    it('issues an intra-state invoice with CGST + SGST that totals the order, numbered per financial year', async () => {
      const c = addCustomer('Local Buyer', { gstin: BUYER_TN_GSTIN, billingAddress: 'Tiruppur' });
      const o = addOrder(c);
      const res = await http(accounts, '/invoices', { method: 'POST', body: { orderId: o.id, hsn: { [o.itemId]: '4910' } } });
      expect(res.status).toBe(201);
      const inv = await res.json();
      expect(inv.invoiceNumber).toMatch(/^INV\/\d{4}-\d{2}\/\d{4}$/);
      expect(inv.invoiceNumber.length).toBeLessThanOrEqual(16);
      expect(inv).toMatchObject({
        supplyType: 'INTRA',
        placeOfSupply: { stateCode: '33', stateName: 'Tamil Nadu' },
        reverseCharge: false,
        supplier: { name: 'Senthaamarai Art Crafts', gstin: SUPPLIER_GSTIN, stateCode: '33' },
        buyer: { gstin: BUYER_TN_GSTIN, address: 'Tiruppur' },
        totals: { taxableValue: '1000.00', cgst: '90.00', sgst: '90.00', igst: '0.00', roundOff: '0.00', grandTotal: '1180.00' },
        payment: { status: 'UNPAID', balanceDue: '1180.00', paid: '0.00' },
      });
      expect(inv.lines[0]).toMatchObject({ hsnCode: '4910', taxableValue: '1000.00', cgst: '90.00', sgst: '90.00', igst: '0.00', lineTotal: '1180.00' });
      // The HSN was remembered on the order line
      expect(globalMemoryOrderItems.find((i) => i.id === o.itemId)!.hsnCode).toBe('4910');
    });

    it('charges IGST when the buyer is in another state', async () => {
      const c = addCustomer('Pune Buyer', { gstin: BUYER_MH_GSTIN });
      const o = addOrder(c, { hsn: '4910' });
      const inv = await (await http(owner, '/invoices', { method: 'POST', body: { orderId: o.id } })).json();
      expect(inv).toMatchObject({
        supplyType: 'INTER',
        placeOfSupply: { stateCode: '27' },
        totals: { cgst: '0.00', sgst: '0.00', igst: '180.00', grandTotal: '1180.00' },
      });
    });

    it('lets staff override the place of supply for an unregistered customer, defaulting to the supplier state', async () => {
      const c = addCustomer('Walk-in');
      const o1 = addOrder(c, { hsn: '4910' });
      const prep = await (await http(owner, `/invoices/prepare/${o1.id}`)).json();
      expect(prep.placeOfSupply).toMatchObject({ stateCode: '33', source: 'DEFAULT_SUPPLIER_STATE' });
      const prepKa = await (await http(owner, `/invoices/prepare/${o1.id}?placeOfSupply=29`)).json();
      expect(prepKa.placeOfSupply).toMatchObject({ stateCode: '29', stateName: 'Karnataka', source: 'OVERRIDE' });
      expect(prepKa.preview).toMatchObject({ igst: '180.00', cgst: '0.00' });

      const inv = await (await http(owner, '/invoices', { method: 'POST', body: { orderId: o1.id, placeOfSupply: '29' } })).json();
      expect(inv).toMatchObject({ supplyType: 'INTER', placeOfSupply: { stateCode: '29' } });
    });

    it('reduces the taxable value for a discounted order and still totals the order exactly', async () => {
      const c = addCustomer('Discount Buyer');
      const o = addOrder(c, { total: '1062.00', hsn: '4910' }); // 10% off the Rs.1,180 gross
      const inv = await (await http(owner, '/invoices', { method: 'POST', body: { orderId: o.id } })).json();
      expect(inv.totals).toMatchObject({ taxableValue: '900.00', cgst: '81.00', sgst: '81.00', roundOff: '0.00', grandTotal: '1062.00' });
    });

    it('refuses an invalid customer GSTIN rather than invoicing them as unregistered', async () => {
      const c = addCustomer('Bad GSTIN Co', { gstin: '33AAAAA0000A1Z5' });
      const o = addOrder(c, { hsn: '4910' });
      const res = await http(owner, '/invoices', { method: 'POST', body: { orderId: o.id } });
      expect(res.status).toBe(422);
      expect((await res.json()).problems.join(' ')).toMatch(/GSTIN is not valid/);
    });

    it('refuses cancelled orders', async () => {
      const o = addOrder(addCustomer('Cancelled Co'), { hsn: '4910', stage: 'CANCELLED' });
      const res = await http(owner, '/invoices', { method: 'POST', body: { orderId: o.id } });
      expect(res.status).toBe(422);
    });
  });

  describe('numbering and duplicates', () => {
    it('numbers invoices consecutively with no gaps, and a second invoice for the same order is a 409', async () => {
      const before = globalMemoryInvoices.filter((i) => i.tenantId === TENANT).length;
      const o1 = addOrder(addCustomer('Seq A'), { hsn: '4910' });
      const o2 = addOrder(addCustomer('Seq B'), { hsn: '4910' });
      const a = await (await http(owner, '/invoices', { method: 'POST', body: { orderId: o1.id } })).json();
      const b = await (await http(owner, '/invoices', { method: 'POST', body: { orderId: o2.id } })).json();
      const n = (x: any) => Number(x.invoiceNumber.split('/')[2]);
      expect(n(b)).toBe(n(a) + 1);

      const again = await http(owner, '/invoices', { method: 'POST', body: { orderId: o1.id } });
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ error: 'InvoiceExists', invoiceNumber: a.invoiceNumber, invoiceId: a.id });
      expect(globalMemoryInvoices.filter((i) => i.tenantId === TENANT).length).toBe(before + 2);

      // The failed attempt did not burn a number
      const o3 = addOrder(addCustomer('Seq C'), { hsn: '4910' });
      const c = await (await http(owner, '/invoices', { method: 'POST', body: { orderId: o3.id } })).json();
      expect(n(c)).toBe(n(b) + 1);
    });

    it('lets only one of two simultaneous requests win', async () => {
      const o = addOrder(addCustomer('Race Co'), { hsn: '4910' });
      const results = await Promise.all([1, 2, 3].map(() => http(owner, '/invoices', { method: 'POST', body: { orderId: o.id } })));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    });

    it('restarts the serial each April and keeps businesses separate', async () => {
      const ctx = (id: string) => ({ id });
      void ctx;
      const o1 = addOrder(addCustomer('FY A'), { hsn: '4910' });
      const o2 = addOrder(addCustomer('FY B'), { hsn: '4910' });
      const o3 = addOrder(addCustomer('FY C'), { hsn: '4910' });
      const march = await invoices.issue(TENANT, null, o1.id, {}, new Date(2031, 2, 31));
      const april = await invoices.issue(TENANT, null, o2.id, {}, new Date(2031, 3, 1));
      const april2 = await invoices.issue(TENANT, null, o3.id, {}, new Date(2031, 3, 2));
      expect(march.invoiceNumber).toBe('INV/2030-31/0001');
      expect(april.invoiceNumber).toBe('INV/2031-32/0001');
      expect(april2.invoiceNumber).toBe('INV/2031-32/0002');
    });

    it('remembers an HSN code and suggests it for the next order with the same item', async () => {
      const name = 'Custom diary 2031';
      const first = addOrder(addCustomer('Hsn A'), { itemName: name });
      await http(owner, '/invoices', { method: 'POST', body: { orderId: first.id, hsn: { [first.itemId]: '482010' } } });
      const second = addOrder(addCustomer('Hsn B'), { itemName: name.toUpperCase() });
      const prep = await (await http(owner, `/invoices/prepare/${second.id}`)).json();
      expect(prep.lines[0]).toMatchObject({ hsnCode: null, suggestedHsn: '482010' });
      expect(prep.problems.length).toBeGreaterThan(0); // suggested, not silently applied
    });
  });

  describe('reading, payment state and access', () => {
    it('shows payment state derived from the order and serves a PDF', async () => {
      const o = addOrder(addCustomer('Pay Co'), { hsn: '4910' });
      const inv = await (await http(owner, '/invoices', { method: 'POST', body: { orderId: o.id } })).json();

      globalMemoryOrders.find((x) => x.id === o.id)!.balanceDue = '480.00';
      const part = await (await http(owner, `/invoices/${inv.id}`)).json();
      expect(part.payment).toEqual({ paid: '700.00', balanceDue: '480.00', status: 'PARTIAL' });
      globalMemoryOrders.find((x) => x.id === o.id)!.balanceDue = '0.00';
      expect((await (await http(owner, `/invoices/by-order/${o.id}`)).json()).payment.status).toBe('PAID');

      const list = await (await http(owner, '/invoices')).json();
      expect(list.data.find((i: any) => i.id === inv.id)).toMatchObject({ invoiceNumber: inv.invoiceNumber, grandTotal: '1180.00', status: 'PAID' });

      const pdf = await http(owner, `/invoices/${inv.id}/pdf`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get('content-type')).toContain('application/pdf');
      const bytes = Buffer.from(await pdf.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(1500);
    });

    it('stays unchanged after the business details change (it is a snapshot)', async () => {
      const o = addOrder(addCustomer('Snap Co', { billingAddress: 'Old Street' }), { hsn: '4910' });
      const inv = await (await http(owner, '/invoices', { method: 'POST', body: { orderId: o.id } })).json();
      await settings({ legalName: 'Renamed Pvt Ltd', address: 'New Address' });
      const again = await (await http(owner, `/invoices/${inv.id}`)).json();
      expect(again.supplier.name).toBe('Senthaamarai Art Crafts');
      expect(again.buyer.address).toBe('Old Street');
      await settings({ legalName: 'Senthaamarai Art Crafts', address: '12 Bazaar St, Coimbatore 641001' });
    });

    it('enforces roles, tenants and authentication', async () => {
      const o = addOrder(addCustomer('Perm Co'), { hsn: '4910' });
      expect((await http(sales, '/invoices', { method: 'POST', body: { orderId: o.id } })).status).toBe(403);
      expect((await http(sales, '/invoices')).status).toBe(403);
      expect((await http(prod, '/invoices')).status).toBe(403);
      expect((await http(sales, `/invoices/prepare/${o.id}`)).status).toBe(403);
      expect((await fetch(`${baseUrl}/api/invoices`, { headers: { 'x-tenant-id': TENANT } })).status).toBe(401);
      expect((await http(owner, '/invoices', { tenant: OTHER_TENANT })).status).toBe(403);

      const theirs = addOrder(addCustomer('Other tenant cust'), { hsn: '4910', tenantId: OTHER_TENANT });
      // another business's order is invisible, even by id
      expect((await http(owner, '/invoices', { method: 'POST', body: { orderId: theirs.id } })).status).toBe(404);
      expect((await http(owner, `/invoices/${'00000000-0000-4000-8000-000000000000'}`)).status).toBe(404);
    });
  });
});
