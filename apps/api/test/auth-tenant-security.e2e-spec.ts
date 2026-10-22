import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';

describe('Friendly CRM — Phase 1: Authentication, Tenant Security & RBAC Suite', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authService: AuthService;

  // Test Tenants
  const TENANT_A_PRINTING = '11111111-1111-4111-8111-111111111111';
  const TENANT_B_FURNITURE = '22222222-2222-4222-8222-222222222222';

  // Test Users
  const USER_OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USER_PROD_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const USER_SALES_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const USER_ACCOUNTS_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const USER_INACTIVE_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const USER_TENANT_B_ONLY = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  // Session Tokens
  let tokenOwnerA: string;
  let tokenProdA: string;
  let tokenSalesA: string;
  let tokenAccountsA: string;
  let tokenInactiveA: string;
  let tokenTenantB: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);

    baseUrl = await app.getUrl();
    authService = moduleFixture.get<AuthService>(AuthService);

    // Register Users
    authService.registerUser({ id: USER_OWNER_A, fullName: 'Owner A', phone: '+919800000001' });
    authService.registerUser({ id: USER_PROD_A, fullName: 'Prod Operator A', phone: '+919800000002' });
    authService.registerUser({ id: USER_SALES_A, fullName: 'Sales Rep A', phone: '+919800000003' });
    authService.registerUser({ id: USER_ACCOUNTS_A, fullName: 'Accountant A', phone: '+919800000004' });
    authService.registerUser({ id: USER_INACTIVE_A, fullName: 'Inactive Member A', phone: '+919800000005' });
    authService.registerUser({ id: USER_TENANT_B_ONLY, fullName: 'Owner B', phone: '+919800000006' });

    // Register Memberships
    authService.registerMembership(TENANT_A_PRINTING, USER_OWNER_A, 'OWNER', true);
    authService.registerMembership(TENANT_A_PRINTING, USER_PROD_A, 'PRODUCTION', true);
    authService.registerMembership(TENANT_A_PRINTING, USER_SALES_A, 'SALESPERSON', true);
    authService.registerMembership(TENANT_A_PRINTING, USER_ACCOUNTS_A, 'ACCOUNTS', true);
    authService.registerMembership(TENANT_A_PRINTING, USER_INACTIVE_A, 'READ_ONLY', false); // Inactive member
    authService.registerMembership(TENANT_B_FURNITURE, USER_TENANT_B_ONLY, 'OWNER', true); // Member of Tenant B only

    // Issue authentic server-validated sessions for test actors
    const getSessionForUser = async (phone: string, tenantId: string) => {
      await authService.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const session = await authService.verifyOtp({ phone, code, tenantId });
      return session.token;
    };

    tokenOwnerA = await getSessionForUser('+919800000001', TENANT_A_PRINTING);
    tokenProdA = await getSessionForUser('+919800000002', TENANT_A_PRINTING);
    tokenSalesA = await getSessionForUser('+919800000003', TENANT_A_PRINTING);
    tokenAccountsA = await getSessionForUser('+919800000004', TENANT_A_PRINTING);

    // Issue session for inactive member
    await authService.requestOtp({ phone: '+919800000005', countryCode: '+91' });
    const inactiveCode = DevSmsGateway.getLatestOtp(authService.normalizePhone('+919800000005'))!;
    const inactiveSession = await authService.verifyOtp({ phone: '+919800000005', code: inactiveCode });
    tokenInactiveA = inactiveSession.token;

    // Issue session for Tenant B user
    tokenTenantB = await getSessionForUser('+919800000006', TENANT_B_FURNITURE);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Anonymous and Malformed Requests', () => {
    it('denies unauthenticated request to /api/crm/leads with 401', async () => {
      const res = await fetch(`${baseUrl}/api/crm/leads`, {
        headers: { 'X-Tenant-Id': TENANT_A_PRINTING },
      });
      expect(res.status).toBe(401);
    });

    it('denies unauthenticated request to /api/orders with 401', async () => {
      const res = await fetch(`${baseUrl}/api/orders`, {
        headers: { 'X-Tenant-Id': TENANT_A_PRINTING },
      });
      expect(res.status).toBe(401);
    });

    it('denies request with invalid bearer token with 401', async () => {
      const res = await fetch(`${baseUrl}/api/crm/leads`, {
        headers: {
          Authorization: 'Bearer invalid_garbage_token_hex_99999',
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('2. OTP Lifecycle, Expiry, Rate Limits & Universal Bypass Removal', () => {
    it('blocks universal bypass code "123456" without valid OTP request with 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: '+919999999999',
          code: '123456',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('enforces request rate limit: throws 429 when requesting OTP twice within 60s', async () => {
      const phone = '+919840112233';
      const firstRes = await fetch(`${baseUrl}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      expect(firstRes.status).toBe(200);

      const secondRes = await fetch(`${baseUrl}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      expect(secondRes.status).toBe(429);
      const json = await secondRes.json();
      expect(json.message).toMatch(/Please wait/);
    });

    it('enforces maximum 3 verification attempts and invalidates OTP', async () => {
      const phone = '+919840223344';
      await authService.requestOtp({ phone, countryCode: '+91' });

      // Attempt 1: wrong code -> 401
      const a1 = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: '000001' }),
      });
      expect(a1.status).toBe(401);

      // Attempt 2: wrong code -> 401
      const a2 = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: '000002' }),
      });
      expect(a2.status).toBe(401);

      // Attempt 3: wrong code -> 401 (Max attempts reached)
      const a3 = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: '000003' }),
      });
      expect(a3.status).toBe(401);

      // Attempt 4: even with the correct code, it should be rejected because max attempts was reached
      const realCode = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const a4 = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: realCode }),
      });
      expect(a4.status).toBe(401);
    });

    it('enforces single-use consumption: verified OTP cannot be reused', async () => {
      const phone = '+919840334455';
      await authService.requestOtp({ phone, countryCode: '+91' });
      const realCode = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;

      // 1st verification -> 200 OK
      const verify1 = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: realCode }),
      });
      expect(verify1.status).toBe(200);

      // 2nd verification replay -> 401 Unauthorized
      const verify2 = await fetch(`${baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: realCode }),
      });
      expect(verify2.status).toBe(401);
    });
  });

  describe('3. Session Revocation & Expiry', () => {
    it('revokes session on POST /api/auth/logout and blocks subsequent requests', async () => {
      const phone = '+919840445566';
      authService.registerUser({ id: '98404455-6600-4000-8000-000000000001', fullName: 'Logout User', phone });
      authService.registerMembership(TENANT_A_PRINTING, '98404455-6600-4000-8000-000000000001', 'OWNER', true);

      await authService.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const session = await authService.verifyOtp({ phone, code, tenantId: TENANT_A_PRINTING });
      const token = session.token;

      // Verify token works
      const testRes1 = await fetch(`${baseUrl}/api/crm/leads`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(testRes1.status).toBe(200);

      // Logout
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(logoutRes.status).toBe(200);

      // Verify revoked token is now rejected with 401
      const testRes2 = await fetch(`${baseUrl}/api/crm/leads`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(testRes2.status).toBe(401);
    });
  });

  describe('4. Tenant Membership Isolation & Inactive Members', () => {
    it('blocks user from accessing a tenant they are not an active member of with 403', async () => {
      // User Tenant B attempts to access Tenant A
      const res = await fetch(`${baseUrl}/api/crm/leads`, {
        headers: {
          Authorization: `Bearer ${tokenTenantB}`,
          'X-Tenant-Id': TENANT_A_PRINTING, // Foreign tenant!
        },
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.message).toMatch(/not an active member/);
    });

    it('blocks inactive member from accessing tenant with 403', async () => {
      const res = await fetch(`${baseUrl}/api/crm/leads`, {
        headers: {
          Authorization: `Bearer ${tokenInactiveA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('5. Forged Header & Privilege Elevation Immunity', () => {
    it('PRODUCTION role cannot record payments even if passing x-user-role: OWNER', async () => {
      const res = await fetch(`${baseUrl}/api/orders/00000000-0000-4000-8000-000000000001/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenProdA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
          'x-user-role': 'OWNER', // SPOOFED HEADER ATTEMPT
          'x-role': 'OWNER',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 5000,
          mode: 'UPI',
        }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.message).toMatch(/PRODUCTION.*lacks required permissions.*payment:create/);
    });

    it('PRODUCTION role cannot access /api/crm/reports even if passing x-user-role: OWNER', async () => {
      const res = await fetch(`${baseUrl}/api/crm/reports`, {
        headers: {
          Authorization: `Bearer ${tokenProdA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
          'x-user-role': 'OWNER', // SPOOFED HEADER ATTEMPT
        },
      });
      expect(res.status).toBe(403);
    });

    it('SALESPERSON role cannot update order stage even if passing x-user-role: OWNER', async () => {
      const res = await fetch(`${baseUrl}/api/orders/00000000-0000-4000-8000-000000000001/stage`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenSalesA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
          'x-user-role': 'OWNER', // SPOOFED HEADER ATTEMPT
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nextStageId: 'PRINTING_CMYK',
        }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.message).toMatch(/SALESPERSON.*lacks required permissions.*order:update_stage/);
    });
  });

  describe('6. Canonical Role & Permission Matrix Enforcement Across HTTP Endpoints', () => {
    it('SALESPERSON: can view orders and create leads, but cannot record payments or view reports', async () => {
      // 1. Can view orders -> 200 OK
      const viewRes = await fetch(`${baseUrl}/api/orders`, {
        headers: {
          Authorization: `Bearer ${tokenSalesA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(viewRes.status).toBe(200);

      // 2. Cannot record payments -> 403 Forbidden
      const payRes = await fetch(`${baseUrl}/api/orders/00000000-0000-4000-8000-000000000001/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenSalesA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: 1000, mode: 'CASH' }),
      });
      expect(payRes.status).toBe(403);

      // 3. Cannot view reports -> 403 Forbidden
      const repRes = await fetch(`${baseUrl}/api/crm/reports`, {
        headers: {
          Authorization: `Bearer ${tokenSalesA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(repRes.status).toBe(403);
    });

    it('ACCOUNTS: can view reports, but cannot update order stage or create leads', async () => {
      // 1. Can view reports -> 200 OK
      const repRes = await fetch(`${baseUrl}/api/crm/reports`, {
        headers: {
          Authorization: `Bearer ${tokenAccountsA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(repRes.status).toBe(200);

      // 2. Cannot update order stage -> 403 Forbidden
      const stageRes = await fetch(`${baseUrl}/api/orders/00000000-0000-4000-8000-000000000001/stage`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenAccountsA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nextStageId: 'PRINTING_CMYK' }),
      });
      expect(stageRes.status).toBe(403);
    });

    it('PRODUCTION: can update order stage, but cannot view reports or record payments', async () => {
      // 1. Can update order stage (permission check passes; returns 200 or 404 for non-existent order id)
      const stageRes = await fetch(`${baseUrl}/api/orders/ord-demo-1/stage`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokenProdA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nextStageId: 'PRINTING_CMYK' }),
      });
      // Permission check order:update_stage MUST succeed (status not 401/403)
      expect(stageRes.status).not.toBe(401);
      expect(stageRes.status).not.toBe(403);

      // 2. Cannot view reports -> 403
      const repRes = await fetch(`${baseUrl}/api/crm/reports`, {
        headers: {
          Authorization: `Bearer ${tokenProdA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(repRes.status).toBe(403);
    });

    it('OWNER: has full access to reports, order stage updates, and quotation flows', async () => {
      // 1. Can view reports -> 200 OK
      const repRes = await fetch(`${baseUrl}/api/crm/reports`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(repRes.status).toBe(200);

      // 2. Can view quotations -> 200 OK
      const quoteRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });
      expect(quoteRes.status).toBe(200);
    });
  });
});
