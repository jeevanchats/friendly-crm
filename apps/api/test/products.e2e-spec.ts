import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import {
  PRODUCT_FIELDS,
  parseGstPercent,
  parseProductSheet,
  productTemplateCsv,
  validateProductRow,
} from '@friendly-crm/shared';
import {
  globalMemoryTenants,
  globalMemoryProducts,
  globalMemoryCustomers,
  globalMemoryOrders,
  globalMemoryOrderItems,
} from '../src/modules/crm/memory-store';

describe('product sheet rules', () => {
  it('matches common header spellings and ignores the rest', () => {
    const sheet = parseProductSheet('Item Name,Item Code,HSN/SAC,UOM,Selling Price,GST %,Remarks,Colour\nWall Calendar,CAL-1,4910,pcs,"1,250.50",12%,glossy,red\n');
    expect(sheet.mapping).toEqual({ name: 0, code: 1, hsnCode: 2, unit: 3, unitPrice: 4, taxPercent: 5, description: 6 });
    expect(sheet.ignoredHeaders).toEqual(['Colour']);
    expect(sheet.rows[0]).toMatchObject({ name: 'Wall Calendar', unitPrice: '1,250.50', taxPercent: '12%' });
  });

  it('round-trips its own template', () => {
    const sheet = parseProductSheet(productTemplateCsv());
    expect(Object.keys(sheet.mapping)).toHaveLength(PRODUCT_FIELDS.length);
    const check = validateProductRow(sheet.rows[0]);
    expect(check.ok).toBe(true);
  });

  it('cleans a good row: units folded, GST read from text, HSN stripped of dots and spaces', () => {
    const r = validateProductRow({ name: ' Diary ', code: 'D1', hsnCode: '4820 10', unit: 'PCS', unitPrice: '₹1,200', taxPercent: 'GST 12%' });
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ name: 'Diary', code: 'D1', hsnCode: '482010', unit: 'Nos', unitPricePaise: 120000, taxPercent: 12 });
  });

  it('warns about a missing rate or GST instead of guessing silently', () => {
    const r = validateProductRow({ name: 'Thing' });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(['No rate: it will be 0 until you set one', 'No GST %: 18% will be used']);
    expect(r.value).toMatchObject({ unitPricePaise: 0, taxPercent: 18, unit: 'Nos', hsnCode: null });
  });

  it('rejects bad names, HSN, rates and GST rates, all at once', () => {
    const r = validateProductRow({ name: '', hsnCode: '12', unitPrice: 'cheap', taxPercent: '15' });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(4);
    expect(validateProductRow({ name: 'X', unitPrice: '-5' }).errors).toEqual(['Rate cannot be negative']);
    expect(validateProductRow({ name: 'X', taxPercent: 'abc' }).errors[0]).toMatch(/not a number/);
    for (const ok of ['0', '5', '12', '18', '28', '0.25']) expect(validateProductRow({ name: 'X', taxPercent: ok }).ok).toBe(true);
  });

  it('parses GST percent text', () => {
    expect(parseGstPercent('18')).toBe(18);
    expect(parseGstPercent('18%')).toBe(18);
    expect(parseGstPercent(' GST 12 % ')).toBe(12);
    expect(parseGstPercent('x')).toBeNull();
    expect(parseGstPercent('')).toBeNull();
  });
});

describe('Product master (API)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const T = '87878787-8787-4878-8878-878787878787';
  const T2 = '86868686-8686-4868-8868-868686868686';
  const U_OWNER = '11111111-8787-4878-8878-878787878787';
  const U_SALES = '22222222-8787-4878-8878-878787878787';
  const U_PROD = '33333333-8787-4878-8878-878787878787';
  const U_ACCT = '44444444-8787-4878-8878-878787878787';
  let owner: string;
  let sales: string;
  let prod: string;
  let acct: string;

  const http = (token: string, path: string, init: { method?: string; body?: unknown; tenant?: string } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': init.tenant ?? T, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const mine = (t = T) => globalMemoryProducts.filter((p: any) => p.tenantId === t);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const auth = fixture.get(AuthService);
    for (const id of [T, T2]) {
      globalMemoryTenants.set(id, { id, name: 'Product Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999955555', isActive: true } as any);
    }
    const users: Array<[string, string, string, string]> = [
      [U_OWNER, 'P Owner', '+919840990001', 'OWNER'],
      [U_SALES, 'P Sales', '+919840990002', 'SALESPERSON'],
      [U_PROD, 'P Prod', '+919840990003', 'PRODUCTION'],
      [U_ACCT, 'P Accounts', '+919840990004', 'ACCOUNTS'],
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
    owner = await login('+919840990001');
    sales = await login('+919840990002');
    prod = await login('+919840990003');
    acct = await login('+919840990004');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('one product', () => {
    it('adds a product with its defaults', async () => {
      const res = await http(owner, '/products', { method: 'POST', body: { name: 'Wall Calendar', code: 'cal-12', hsnCode: '4910', unit: 'pcs', unitPrice: '85', taxPercent: 12, description: '12 sheet' } });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ name: 'Wall Calendar', code: 'cal-12', hsnCode: '4910', unit: 'Nos', unitPrice: '85.00', taxPercent: '12.00', isActive: true });
    });

    it('refuses the same name (any case) or the same code, naming the product', async () => {
      const dupName = await http(owner, '/products', { method: 'POST', body: { name: 'WALL CALENDAR', unitPrice: 1 } });
      expect(dupName.status).toBe(409);
      expect((await dupName.json()).message).toMatch(/Wall Calendar is already a product/);
      const dupCode = await http(owner, '/products', { method: 'POST', body: { name: 'Other thing', code: 'CAL-12' } });
      expect(dupCode.status).toBe(409);
      expect((await dupCode.json()).message).toMatch(/Code CAL-12 is already used by Wall Calendar/);
    });

    it('lists every problem with a bad form', async () => {
      const res = await http(owner, '/products', { method: 'POST', body: { name: '', hsnCode: '1', taxPercent: 15 } });
      expect(res.status).toBe(400);
      expect((await res.json()).errors).toHaveLength(3);
    });

    it('searches by name, code or HSN and hides archived products', async () => {
      await http(owner, '/products', { method: 'POST', body: { name: 'Table Diary', code: 'DRY-1', hsnCode: '482010', unitPrice: 200, taxPercent: 12 } });
      const byName = await (await http(sales, '/products?search=diary')).json();
      expect(byName.data.map((p: any) => p.name)).toEqual(['Table Diary']);
      expect((await (await http(sales, '/products?search=cal-12')).json()).data[0].name).toBe('Wall Calendar');
      expect((await (await http(sales, '/products?search=4820')).json()).data[0].name).toBe('Table Diary');
      expect((await (await http(sales, '/products?search=%25')).json()).data).toHaveLength(0); // a literal %, not a wildcard

      const diary = byName.data[0];
      const archived = await http(owner, `/products/${diary.id}`, { method: 'PATCH', body: { isActive: false } });
      expect((await archived.json()).isActive).toBe(false);
      expect((await (await http(sales, '/products?search=diary')).json()).data).toHaveLength(0);
      expect((await (await http(owner, '/products?search=diary&archived=true')).json()).data).toHaveLength(1);
      await http(owner, `/products/${diary.id}`, { method: 'PATCH', body: { isActive: true } });
      expect((await (await http(sales, '/products?search=diary')).json()).data).toHaveLength(1);
    });

    it('updates only what is sent, validates the result, and still blocks clashes', async () => {
      const cal = (await (await http(owner, '/products?search=calendar')).json()).data[0];
      const res = await http(owner, `/products/${cal.id}`, { method: 'PATCH', body: { unitPrice: '95.50' } });
      expect(await res.json()).toMatchObject({ name: 'Wall Calendar', unitPrice: '95.50', taxPercent: '12.00', hsnCode: '4910' });
      expect((await http(owner, `/products/${cal.id}`, { method: 'PATCH', body: { taxPercent: 15 } })).status).toBe(400);
      expect((await http(owner, `/products/${cal.id}`, { method: 'PATCH', body: { name: 'table diary' } })).status).toBe(409);
      expect((await http(owner, `/products/${cal.id}`, { method: 'PATCH', body: { name: 'Wall Calendar' } })).status).toBe(200); // itself is not a clash
      expect((await http(owner, '/products/no-such-id', { method: 'PATCH', body: { unitPrice: 1 } })).status).toBe(404);
    });
  });

  describe('importing a sheet', () => {
    const rows = [
      { name: 'Visiting Card', code: 'VC-100', hsnCode: '4911', unit: 'Box', unitPrice: '350', taxPercent: '12%' },
      { name: 'Flex Banner', unit: 'sqft', unitPrice: '14.5', taxPercent: '18', hsnCode: '3926' },
      { name: 'wall calendar', unitPrice: '120' }, // already a product
      { name: 'Bad Rate', unitPrice: 'cheap' },
      { name: 'Bad GST', taxPercent: '15' },
      { name: 'Twin of Flex', code: 'VC-100' }, // same code as row 1
      { name: '' },
    ];
    const post = (body: unknown, token = owner) => http(token, '/products/import', { method: 'POST', body });

    it('previews by default without writing anything', async () => {
      const before = mine().length;
      const res = await post({ rows });
      expect(res.status).toBe(201);
      const r = await res.json();
      expect(r).toMatchObject({ dryRun: true, created: 2, skipped: 1, errors: 4, updated: 0 });
      expect(r.rows.map((x: any) => x.status)).toEqual(['create', 'create', 'skip', 'error', 'error', 'error', 'error']);
      expect(r.rows[5].messages[0]).toMatch(/Same name or code as row 1/);
      expect(mine().length).toBe(before);
    });

    it('imports the good rows only', async () => {
      const r = await (await post({ rows, dryRun: false })).json();
      expect(r).toMatchObject({ dryRun: false, created: 2, skipped: 1, errors: 4 });
      expect(mine().find((p: any) => p.name === 'Visiting Card')).toMatchObject({ unit: 'Box', unitPrice: '350.00', taxPercent: '12.00', hsnCode: '4911' });
      expect(mine().find((p: any) => p.name === 'Flex Banner')).toMatchObject({ unit: 'Sq.Ft', unitPrice: '14.50', hsnCode: '3926' });
      expect(mine().find((p: any) => p.name === 'Wall Calendar').unitPrice).toBe('95.50'); // untouched
    });

    it('importing the same file again adds nothing', async () => {
      const before = mine().length;
      const r = await (await post({ rows, dryRun: false })).json();
      expect(r).toMatchObject({ created: 0, skipped: 3 });
      expect(mine().length).toBe(before);
    });

    it("'update' refreshes rate, GST, HSN and unit of existing products, keeping their name", async () => {
      const r = await (await post({ rows: [{ name: 'WALL CALENDAR', unitPrice: '110', taxPercent: '5', hsnCode: '4911', unit: 'Sets' }], dryRun: false, onDuplicate: 'update' })).json();
      expect(r).toMatchObject({ updated: 1, created: 0 });
      expect(mine().find((p: any) => p.code === 'cal-12')).toMatchObject({ name: 'Wall Calendar', unitPrice: '110.00', taxPercent: '5.00', hsnCode: '4911', unit: 'Sets' });
    });

    it("'update' never blanks a value the sheet left empty", async () => {
      const before = mine().find((p: any) => p.code === 'cal-12');
      const r = await (await post({ rows: [{ name: 'Wall Calendar', unitPrice: '125' }], dryRun: false, onDuplicate: 'update' })).json();
      expect(r.updated).toBe(1);
      const after = mine().find((p: any) => p.code === 'cal-12');
      expect(after.unitPrice).toBe('125.00');
      expect(after.hsnCode).toBe(before.hsnCode);
      expect(after.unit).toBe(before.unit);
      expect(after.taxPercent).toBe(before.taxPercent);
    });

    it('refuses empty, oversized and non-array input', async () => {
      expect((await post({ rows: [] })).status).toBe(400);
      expect((await post({ rows: 'x' })).status).toBe(400);
      const big = Array.from({ length: 1001 }, (_, i) => ({ name: `P${i}` }));
      const res = await post({ rows: big });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toMatch(/at most 1000/);
    });
  });

  describe('access', () => {
    it('lets sales and accounts look but not change; production sees nothing', async () => {
      for (const t of [sales, acct]) {
        expect((await http(t, '/products')).status).toBe(200);
        expect((await http(t, '/products', { method: 'POST', body: { name: 'Nope' } })).status).toBe(403);
        expect((await http(t, '/products/import', { method: 'POST', body: { rows: [{ name: 'Nope' }] } })).status).toBe(403);
      }
      expect((await http(prod, '/products')).status).toBe(403);
      expect((await http(sales, '/products/x', { method: 'PATCH', body: { unitPrice: 1 } })).status).toBe(403);
    });

    it("keeps each business's products separate, and refuses non-members and anonymous callers", async () => {
      globalMemoryProducts.push({ id: 'other-biz-product', tenantId: T2, name: 'Secret Product', unitPrice: '1', taxPercent: '18', unit: 'Nos', isActive: true });
      expect((await (await http(owner, '/products?search=secret')).json()).data).toHaveLength(0);
      expect((await http(owner, '/products/other-biz-product', { method: 'PATCH', body: { unitPrice: 2 } })).status).toBe(404);
      expect((await http(owner, '/products', { tenant: T2 })).status).toBe(403);
      expect((await fetch(`${baseUrl}/api/products`, { headers: { 'x-tenant-id': T } })).status).toBe(401);
    });
  });

  describe('invoices use the product master', () => {
    it('suggests a product HSN for an order line that has none', async () => {
      await http(owner, '/products', { method: 'POST', body: { name: 'Souvenir Mug', hsnCode: '6912', unitPrice: 150, taxPercent: 12 } });
      globalMemoryCustomers.push({ id: 'cust-prod-1', tenantId: T, name: 'Mug Buyer', phone: '+919840991111' } as any);
      globalMemoryOrders.push({ id: 'ord-prod-1', tenantId: T, orderNumber: 'ORD-P-1', customerId: 'cust-prod-1', productionStage: 'ORDER_CONFIRMED', totalAmount: '1680.00', balanceDue: '1680.00', createdAt: new Date() } as any);
      globalMemoryOrderItems.push({ id: 'item-prod-1', tenantId: T, orderId: 'ord-prod-1', itemName: 'souvenir mug', quantity: '10', unit: 'Nos', unitPrice: '150', taxPercent: '12', hsnCode: null } as any);
      const prep = await (await http(owner, '/invoices/prepare', { method: 'POST', body: { orderId: 'ord-prod-1' } })).json();
      expect(prep.lines[0]).toMatchObject({ hsnCode: null, suggestedHsn: '6912' });
    });
  });
});
