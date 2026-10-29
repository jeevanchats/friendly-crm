import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryProducts } from '../src/modules/crm/memory-store';

/** An import preview points out new rows that look like something already there (or like an earlier row), without blocking them. */
describe('Import previews warn about likely duplicates', () => {
  let app: INestApplication;
  let baseUrl: string;

  const T = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
  const BIG = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
  const OWNER = '11111111-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
  let owner: string;

  const call = (path: string, body: unknown, tenant = T) =>
    fetch(`${baseUrl}/api${path}`, { method: 'POST', headers: { authorization: `Bearer ${owner}`, 'x-tenant-id': tenant, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const preview = async (path: string, rows: unknown[], tenant = T) => (await call(path, { dryRun: true, onDuplicate: 'skip', rows }, tenant)).json();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const auth = fixture.get(AuthService);
    for (const id of [T, BIG]) {
      globalMemoryTenants.set(id, { id, name: 'Import Warn Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999988888', isActive: true } as any);
      auth.registerMembership(id, OWNER, 'OWNER', true);
    }
    auth.registerUser({ id: OWNER, fullName: 'W Owner', phone: '+919840985001' });
    await auth.requestOtp({ phone: '+919840985001', countryCode: '+91' });
    owner = (await auth.verifyOtp({ phone: '+919840985001', code: DevSmsGateway.getLatestOtp(auth.normalizePhone('+919840985001'))!, tenantId: T })).token;

    globalMemoryCustomers.push({ id: 'iw-c1', tenantId: T, name: 'Anand Traders', phone: '+919840962001', gstin: null, openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date() } as any);
    globalMemoryProducts.push(
      { id: 'iw-p1', tenantId: T, name: 'A4 Sheet 80 GSM', code: null, unit: 'Ream', unitPrice: '320.00', taxPercent: '12.00', isActive: true } as any,
      { id: 'iw-p2', tenantId: T, name: 'Old Banner Flex', code: null, unit: 'Sq.Ft', unitPrice: '12.00', taxPercent: '18.00', isActive: false } as any
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('customers: flags a new row that looks like an existing customer, and one that repeats an earlier row', async () => {
    const r = await preview('/crm/customers/import', [
      { name: 'Anand Trader', phone: '9840070101' }, // looks like Anand Traders
      { name: 'Totally New Company', phone: '9840070102' }, // clean
      { name: 'Kumar Stores', phone: '9840070103' },
      { name: 'KUMAR  STORES', phone: '9840070104' }, // same business, other number
    ]);
    expect(r.nameCheck).toBe('similar');
    expect(r.rows.map((x: any) => [x.status, !!x.check])).toEqual([
      ['create', true],
      ['create', false],
      ['create', false],
      ['create', true],
    ]);
    expect(r.rows[0].messages.join(' ')).toMatch(/Looks like the existing customer "Anand Traders"/);
    expect(r.rows[3].messages.join(' ')).toMatch(/Same name as row 3 .* contact/);
    expect(r.toCheck).toBe(2);
    expect(r.created).toBe(4); // a warning never blocks
  });

  it('customers: a very large file is only compared on identical names, and says so', async () => {
    for (let i = 0; i < 600; i++) {
      globalMemoryCustomers.push({ id: `big-${i}`, tenantId: BIG, name: `Existing Customer Number ${i}`, phone: `+9198400${String(i).padStart(5, '0')}`, gstin: null, openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date() } as any);
    }
    const rows = Array.from({ length: 600 }, (_, i) => ({ name: i === 7 ? 'existing  customer number 7' : `Brand New Firm ${i}`, phone: `9841${String(i).padStart(6, '0')}` }));
    const r = await preview('/crm/customers/import', rows, BIG);
    expect(r.nameCheck).toBe('identical-only');
    expect(r.rows[7].check).toBe(true); // identical once tidied: still found
    expect(r.toCheck).toBe(1);
  });

  it('products: flags a near name, and says to restore an archived product instead', async () => {
    const r = await preview('/products/import', [
      { name: 'A4 Sheet 80GSM', unitPrice: '300' }, // near the listed A4 Sheet 80 GSM
      { name: 'Old Banner Flex 2', unitPrice: '15' }, // near the archived one
      { name: 'Visiting Card Premium', unitPrice: '2' },
      { name: 'visiting card premium.', unitPrice: '2' },
    ]);
    expect(r.nameCheck).toBe('similar');
    expect(r.rows[0].check).toBe(true);
    expect(r.rows[0].messages.join(' ')).toMatch(/Looks like the listed product "A4 Sheet 80 GSM"/);
    expect(r.rows[1].messages.join(' ')).toMatch(/archived.*restore that product/);
    expect(r.rows[2].check).toBeFalsy();
    expect(r.rows[3].check).toBe(true);
    expect(r.rows[3].messages.join(' ')).toMatch(/Same name as row 3/);
  });
});
