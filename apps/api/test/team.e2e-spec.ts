import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryAuditLogs } from '../src/modules/crm/memory-store';

describe('Team: GET/POST/PATCH /api/team', () => {
  let app: INestApplication;
  let baseUrl: string;
  let auth: AuthService;

  const TENANT_ID = '94949494-9494-4949-8949-949494949494';
  const OTHER_TENANT_ID = '93939393-9393-4939-8939-939393939393';
  const OWNER = '11111111-9494-4949-8949-949494949494';
  const OWNER_2 = '12121212-9494-4949-8949-949494949494';
  const SALES = '22222222-9494-4949-8949-949494949494';
  const OTHER_OWNER = '33333333-9494-4949-8949-949494949494';
  let tokenOwner: string;
  let tokenSales: string;

  const call = (token: string, method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}/api/team${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

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
        id, name: 'Team Test Works', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999999999',
        isActive: true, createdAt: new Date(), updatedAt: new Date(),
      } as any);
    }
    auth.registerUser({ id: OWNER, fullName: 'Team Owner', phone: '+919840950001' });
    auth.registerUser({ id: OWNER_2, fullName: 'Second Owner', phone: '+919840950002' });
    auth.registerUser({ id: SALES, fullName: 'Team Sales', phone: '+919840950003' });
    auth.registerUser({ id: OTHER_OWNER, fullName: 'Other Owner', phone: '+919840950004' });
    auth.registerMembership(TENANT_ID, OWNER, 'OWNER', true);
    auth.registerMembership(TENANT_ID, OWNER_2, 'OWNER', true);
    auth.registerMembership(TENANT_ID, SALES, 'SALESPERSON', true);
    auth.registerMembership(OTHER_TENANT_ID, OTHER_OWNER, 'OWNER', true);

    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!;
      return (await auth.verifyOtp({ phone, code, tenantId: TENANT_ID })).token;
    };
    tokenOwner = await login('+919840950001');
    tokenSales = await login('+919840950003');
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists this business\'s team, owners first, and no one from another business', async () => {
    const res = await call(tokenOwner, 'GET', '');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.map((m: any) => m.fullName)).toEqual(['Second Owner', 'Team Owner', 'Team Sales']);
    expect(data.some((m: any) => m.fullName === 'Other Owner')).toBe(false);
  });

  it('keeps the team screen to owners', async () => {
    expect((await call(tokenSales, 'GET', '')).status).toBe(403);
    expect((await call(tokenSales, 'POST', '', { fullName: 'X Y', phone: '9840951111', role: 'MANAGER' })).status).toBe(403);
  });

  it('adds staff by phone with a normalised number, and rejects a duplicate', async () => {
    const res = await call(tokenOwner, 'POST', '', { fullName: 'New Accountant', phone: '98409 52222', role: 'ACCOUNTS' });
    expect(res.status).toBe(201);
    const member = await res.json();
    expect(member).toMatchObject({ fullName: 'New Accountant', phone: '+919840952222', role: 'ACCOUNTS', isActive: true });
    expect((await call(tokenOwner, 'POST', '', { fullName: 'New Accountant', phone: '9840952222', role: 'ACCOUNTS' })).status).toBe(409);
    expect(globalMemoryAuditLogs.some((a: any) => a.action === 'TEAM_MEMBER_ADDED' && a.entityId === member.userId)).toBe(true);
  });

  it('refuses owners, bad numbers, bad names and unknown roles when adding', async () => {
    expect((await call(tokenOwner, 'POST', '', { fullName: 'Boss', phone: '9840953333', role: 'OWNER' })).status).toBe(400);
    expect((await call(tokenOwner, 'POST', '', { fullName: 'Short Number', phone: '12345', role: 'MANAGER' })).status).toBe(400);
    expect((await call(tokenOwner, 'POST', '', { fullName: '', phone: '9840953334', role: 'MANAGER' })).status).toBe(400);
    expect((await call(tokenOwner, 'POST', '', { fullName: 'Odd Role', phone: '9840953335', role: 'GOD' })).status).toBe(400);
  });

  it('changes a role and switches access off and on, with an audit record each time', async () => {
    const before = globalMemoryAuditLogs.filter((a: any) => a.action === 'TEAM_MEMBER_UPDATED').length;
    let res = await call(tokenOwner, 'PATCH', `/${SALES}`, { role: 'MANAGER' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: SALES, role: 'MANAGER', isActive: true });
    res = await call(tokenOwner, 'PATCH', `/${SALES}`, { isActive: false });
    expect(await res.json()).toMatchObject({ role: 'MANAGER', isActive: false });
    res = await call(tokenOwner, 'PATCH', `/${SALES}`, { isActive: true });
    expect(await res.json()).toMatchObject({ isActive: true });
    expect(globalMemoryAuditLogs.filter((a: any) => a.action === 'TEAM_MEMBER_UPDATED').length).toBe(before + 3);
  });

  it('protects owners and yourself, and ignores people from other businesses', async () => {
    expect((await call(tokenOwner, 'PATCH', `/${OWNER}`, { role: 'READ_ONLY' })).status).toBe(403); // yourself
    expect((await call(tokenOwner, 'PATCH', `/${OWNER_2}`, { isActive: false })).status).toBe(403); // another owner
    expect((await call(tokenOwner, 'PATCH', `/${OTHER_OWNER}`, { isActive: false })).status).toBe(404); // not on this team
    expect((await call(tokenOwner, 'PATCH', `/${SALES}`, { role: 'OWNER' })).status).toBe(400);
    expect((await call(tokenOwner, 'PATCH', `/${SALES}`, {})).status).toBe(400);
  });

  it('stops a deactivated member from using the business', async () => {
    await call(tokenOwner, 'PATCH', `/${SALES}`, { isActive: false });
    const res = await fetch(`${baseUrl}/api/tenant/settings`, { headers: { Authorization: `Bearer ${tokenSales}`, 'x-tenant-id': TENANT_ID } });
    expect(res.status).toBe(403);
    await call(tokenOwner, 'PATCH', `/${SALES}`, { isActive: true });
  });
});
