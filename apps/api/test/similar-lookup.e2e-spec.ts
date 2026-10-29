import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryProducts } from '../src/modules/crm/memory-store';

/** Duplicate control, layer 1: "does this look like something already in the master?" for customers and products. */
describe('Similar customer and product lookup', () => {
  let app: INestApplication;
  let baseUrl: string;

  const T = '96969696-9696-4969-8969-969696969696';
  const OTHER = '97979797-9797-4979-8979-979797979797';
  const OWNER = '11111111-9696-4969-8969-969696969696';
  const READER = '22222222-9696-4969-8969-969696969696';
  const STRANGER = '33333333-9696-4969-8969-969696969696';
  let owner: string;
  let reader: string;
  let stranger: string;

  const get = (token: string, path: string, tenant = T) =>
    fetch(`${baseUrl}/api${path}`, { headers: { authorization: `Bearer ${token}`, 'x-tenant-id': tenant } });
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

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
      globalMemoryTenants.set(id, { id, name: 'Similar Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999955555', isActive: true } as any);
    }
    auth.registerUser({ id: OWNER, fullName: 'S Owner', phone: '+919840982001' });
    auth.registerUser({ id: READER, fullName: 'S Reader', phone: '+919840982002' });
    auth.registerUser({ id: STRANGER, fullName: 'S Stranger', phone: '+919840982003' });
    auth.registerMembership(T, OWNER, 'OWNER', true);
    auth.registerMembership(T, READER, 'READ_ONLY', true);
    auth.registerMembership(OTHER, STRANGER, 'OWNER', true);
    const login = async (phone: string, tenantId: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      return (await auth.verifyOtp({ phone, code: DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!, tenantId })).token;
    };
    owner = await login('+919840982001', T);
    reader = await login('+919840982002', T);
    stranger = await login('+919840982003', OTHER);

    globalMemoryCustomers.push(
      { id: 'sim-c1', tenantId: T, name: 'Anand Traders', companyName: null, phone: '+919840970001', gstin: '33AAACA1234A1Z5', createdAt: new Date() } as any,
      { id: 'sim-c2', tenantId: T, name: 'Kumar', companyName: 'Sri Murugan Stores Pvt Ltd', phone: '+919840970002', gstin: null, createdAt: new Date() } as any
    );
    globalMemoryProducts.push(
      { id: 'sim-p1', tenantId: T, name: 'A4 Sheet 80 GSM', code: 'PAP-A4', unit: 'Ream', unitPrice: '320.00', taxPercent: '12.00', isActive: true } as any,
      { id: 'sim-p2', tenantId: T, name: 'Old Banner Flex', code: null, unit: 'Sq.Ft', unitPrice: '12.00', taxPercent: '18.00', isActive: false } as any
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('flags a customer with the same GSTIN whatever the name', async () => {
    const r = await (await get(owner, `/crm/customers/similar?${q({ name: 'Different Name', gstin: '33aaaca1234a1z5' })}`)).json();
    expect(r.matches[0]).toMatchObject({ id: 'sim-c1', reason: 'gstin', score: 1 });
  });

  it('flags the same name written differently, and a company name match', async () => {
    const a = await (await get(owner, `/crm/customers/similar?${q({ name: 'M/s. Anand Trader' })}`)).json();
    expect(a.matches.map((m: any) => m.id)).toContain('sim-c1');
    const b = await (await get(owner, `/crm/customers/similar?${q({ name: 'Murugan Stores' })}`)).json();
    expect(b.matches[0]).toMatchObject({ id: 'sim-c2', reason: 'same-name' });
  });

  it('says nothing for a new name, and leaves out the customer already on that phone number', async () => {
    expect((await (await get(owner, `/crm/customers/similar?${q({ name: 'Brand New Company' })}`)).json()).matches).toEqual([]);
    const r = await (await get(owner, `/crm/customers/similar?${q({ name: 'Anand Traders', phone: '9840970001' })}`)).json();
    expect(r.matches).toEqual([]);
  });

  it("never shows another business's customers", async () => {
    const r = await (await get(stranger, `/crm/customers/similar?${q({ name: 'Anand Traders' })}`, OTHER)).json();
    expect(r.matches).toEqual([]);
  });

  it('flags a product by code or a near-identical name, archived ones too', async () => {
    const byCode = await (await get(owner, `/products/similar?${q({ name: 'Paper', code: 'pap-a4' })}`)).json();
    expect(byCode.matches[0]).toMatchObject({ id: 'sim-p1', reason: 'code' });
    const byName = await (await get(owner, `/products/similar?${q({ name: 'A4  sheet 80 gsm' })}`)).json();
    expect(byName.matches[0]).toMatchObject({ id: 'sim-p1', reason: 'same-name' });
    const archived = await (await get(owner, `/products/similar?${q({ name: 'Old Banner Flex' })}`)).json();
    expect(archived.matches[0]).toMatchObject({ id: 'sim-p2', isActive: false });
  });

  it("never shows another business's products", async () => {
    const r = await (await get(stranger, `/products/similar?${q({ name: 'A4 Sheet 80 GSM' })}`, OTHER)).json();
    expect(r.matches).toEqual([]);
  });

  it('is open to a read-only user (it only reads)', async () => {
    expect((await get(reader, `/crm/customers/similar?${q({ name: 'Anand' })}`)).status).toBe(200);
    expect((await get(reader, `/products/similar?${q({ name: 'A4' })}`)).status).toBe(200);
  });
});
