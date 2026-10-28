import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryTasks } from '../src/modules/crm/memory-store';

describe('Follow-up calendar: GET /api/crm/tasks', () => {
  let app: INestApplication;
  let baseUrl: string;

  const TENANT_ID = '96969696-9696-4969-8969-969696969696';
  const OTHER_TENANT_ID = '95959595-9595-4959-8959-959595959595';
  const USER_OWNER = '11111111-9696-4969-8969-969696969696';
  const USER_SALES_A = '22222222-9696-4969-8969-969696969696';
  const USER_SALES_B = '33333333-9696-4969-8969-969696969696';
  const USER_READONLY = '44444444-9696-4969-8969-969696969696';
  let tokenOwner: string;
  let tokenSalesA: string;
  let tokenReadonly: string;

  const customerId = 'cust-cal-1';
  const day = (offsetDays: number, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const task = (title: string, due: Date, assignedToId: string, status = 'PENDING', tenantId = TENANT_ID) =>
    globalMemoryTasks.push({
      id: randomUUID(),
      tenantId,
      customerId,
      leadId: null,
      type: 'FOLLOW_UP_CALL',
      title,
      dueAt: due,
      status,
      outcomeNote: null,
      assignedToId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

  const get = (token: string, query: string) =>
    fetch(`${baseUrl}/api/crm/tasks${query}`, { headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID } });
  const window = (fromDays: number, toDays: number) =>
    `?from=${encodeURIComponent(day(fromDays, 0).toISOString())}&to=${encodeURIComponent(day(toDays, 0).toISOString())}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const auth = fixture.get(AuthService);

    for (const id of [TENANT_ID, OTHER_TENANT_ID]) {
      globalMemoryTenants.set(id, {
        id,
        name: 'Calendar Test Works',
        industryKey: 'printing',
        defaultLanguage: 'en',
        phone: '+919999999999',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
    }
    auth.registerUser({ id: USER_OWNER, fullName: 'Cal Owner', phone: '+919840930001' });
    auth.registerUser({ id: USER_SALES_A, fullName: 'Cal Sales A', phone: '+919840930002' });
    auth.registerUser({ id: USER_SALES_B, fullName: 'Cal Sales B', phone: '+919840930003' });
    auth.registerUser({ id: USER_READONLY, fullName: 'Cal Readonly', phone: '+919840930004' });
    auth.registerMembership(TENANT_ID, USER_OWNER, 'OWNER', true);
    auth.registerMembership(TENANT_ID, USER_SALES_A, 'SALESPERSON', true);
    auth.registerMembership(TENANT_ID, USER_SALES_B, 'SALESPERSON', true);
    auth.registerMembership(TENANT_ID, USER_READONLY, 'READ_ONLY', true);

    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!;
      return (await auth.verifyOtp({ phone, code, tenantId: TENANT_ID })).token;
    };
    tokenOwner = await login('+919840930001');
    tokenSalesA = await login('+919840930002');
    tokenReadonly = await login('+919840930004');

    globalMemoryCustomers.push({
      id: customerId,
      tenantId: TENANT_ID,
      name: 'Calendar Customer',
      phone: '+919840940000',
      whatsappNumber: '+919840940000',
      openingBalance: '0.00',
      creditLimit: '0.00',
      activeOrdersCount: 0,
      totalReceivable: '0.00',
      createdAt: new Date(),
    } as any);

    task('A today', day(1), USER_SALES_A);
    task('A later', day(3), USER_SALES_A);
    task('B tomorrow', day(2), USER_SALES_B);
    task('A done', day(2, 15), USER_SALES_A, 'COMPLETED');
    task('Outside window', day(20), USER_SALES_A);
    task('Other tenant', day(1), USER_SALES_A, 'PENDING', OTHER_TENANT_ID);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the owner see every salesperson\'s tasks in the window, oldest first, with the customer', async () => {
    const res = await get(tokenOwner, window(0, 10));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.map((t: any) => t.title)).toEqual(['A today', 'B tomorrow', 'A done', 'A later']);
    expect(data[0].customerName).toBe('Calendar Customer');
  });

  it('shows a salesperson only their own tasks', async () => {
    const { data } = await (await get(tokenSalesA, window(0, 10))).json();
    expect(data.map((t: any) => t.title)).toEqual(['A today', 'A done', 'A later']);
  });

  it('filters by status', async () => {
    const { data } = await (await get(tokenOwner, `${window(0, 10)}&status=completed`)).json();
    expect(data.map((t: any) => t.title)).toEqual(['A done']);
  });

  it('never returns another business\'s tasks', async () => {
    const { data } = await (await get(tokenOwner, window(0, 30))).json();
    expect(data.some((t: any) => t.title === 'Other tenant')).toBe(false);
  });

  it('lets a read-only user look but rejects bad windows and statuses', async () => {
    expect((await get(tokenReadonly, window(0, 10))).status).toBe(200);
    expect((await get(tokenOwner, window(5, 1))).status).toBe(400);
    expect((await get(tokenOwner, window(0, 200))).status).toBe(400);
    expect((await get(tokenOwner, `${window(0, 10)}&status=bogus`)).status).toBe(400);
  });
});
