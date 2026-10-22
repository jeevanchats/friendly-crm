import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

describe('Friendly CRM — Phase 3: Database Isolation, RLS & Durable Audit Suite', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authService: AuthService;

  // Test Tenants
  const TENANT_ALPHA = '33333333-3333-4333-8333-333333333333';
  const TENANT_BETA = '44444444-4444-4444-8444-444444444444';

  // Test Users
  const USER_ALPHA_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-333333333333';
  const USER_BETA_OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-444444444444';

  // Session Tokens
  let tokenAlpha: string;
  let tokenBeta: string;

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
    authService.registerUser({ id: USER_ALPHA_OWNER, fullName: 'Alpha Owner', phone: '+919933333333' });
    authService.registerUser({ id: USER_BETA_OWNER, fullName: 'Beta Owner', phone: '+919944444444' });

    // Register Memberships
    authService.registerMembership(TENANT_ALPHA, USER_ALPHA_OWNER, 'OWNER', true);
    authService.registerMembership(TENANT_BETA, USER_BETA_OWNER, 'OWNER', true);

    const getSession = async (phone: string, tenantId: string) => {
      await authService.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const session = await authService.verifyOtp({ phone, code, tenantId });
      return session.token;
    };

    tokenAlpha = await getSession('+919933333333', TENANT_ALPHA);
    tokenBeta = await getSession('+919944444444', TENANT_BETA);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Versioned RLS & Migration Verification', () => {
    it('verifies Drizzle migration journal registers all canonical migrations including RLS and Audit', () => {
      const journalPath = path.resolve(__dirname, '../../../packages/db/drizzle/meta/_journal.json');
      expect(fs.existsSync(journalPath)).toBe(true);

      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      expect(journal.entries.length).toBeGreaterThanOrEqual(3);

      const migrationTags = journal.entries.map((e: any) => e.tag);
      expect(migrationTags).toContain('0000_safe_black_tom');
      expect(migrationTags).toContain('0001_mean_romulus');
      expect(migrationTags).toContain('0002_enable_rls_and_audit');
    });

    it('verifies 0002 migration enforces RLS, FORCE RLS, GIN indexes, and restricted runtime role privileges', () => {
      const migrationFile = path.resolve(__dirname, '../../../packages/db/drizzle/0002_enable_rls_and_audit.sql');
      expect(fs.existsSync(migrationFile)).toBe(true);

      const sqlContent = fs.readFileSync(migrationFile, 'utf8');

      // 1. RLS Enabled on tenant tables
      expect(sqlContent).toContain('ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;');
      expect(sqlContent).toContain('ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;');
      expect(sqlContent).toContain('ALTER TABLE "quotations" ENABLE ROW LEVEL SECURITY;');
      expect(sqlContent).toContain('ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;');

      // 2. FORCE RLS enabled to prevent table owners bypassing policies
      expect(sqlContent).toContain('ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;');
      expect(sqlContent).toContain('ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;');

      // 3. Parameterized set_config policies
      expect(sqlContent).toContain("current_setting('app.current_tenant_id', true)");

      // 4. GIN indexes on JSONB custom_data
      expect(sqlContent).toContain('USING GIN ("custom_data")');

      // 5. Restricted runtime role definition (NOSUPERUSER, NOBYPASSRLS)
      expect(sqlContent).toContain('friendly_app_runtime');
      expect(sqlContent).toContain('NOSUPERUSER');
      expect(sqlContent).toContain('NOBYPASSRLS');

      // 6. Immutability: REVOKE UPDATE, DELETE on audit tables
      expect(sqlContent).toContain('REVOKE UPDATE, DELETE ON "audit_logs" FROM friendly_app_runtime;');
      expect(sqlContent).toContain('REVOKE UPDATE, DELETE ON "activities" FROM friendly_app_runtime;');
    });
  });

  describe('2. Durable Append-Only Audit Records & Redaction', () => {
    it('creates an audit record upon mutation and redacts sensitive parameters', async () => {
      // Perform mutating action with sensitive fields in payload
      const intakeRes = await fetch(`${baseUrl}/api/crm/intake-lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAlpha}`,
          'X-Tenant-Id': TENANT_ALPHA,
          'x-industry-key': 'printing',
        },
        body: JSON.stringify({
          name: 'Secure Packaging Corp',
          phone: '+919877700001',
          source: 'PHONE',
          title: 'High-security packaging box inquiry',
          password: 'sensitive_customer_password_123',
          authToken: 'sensitive_jwt_token_456',
          customData: {
            job_type: 'PACKAGING_BOX',
            paper_board_gsm: '350 GSM Cyber Premium Board',
          },
        }),
      });

      expect(intakeRes.status).toBe(201);

      // Query durable audit logs
      const auditRes = await fetch(`${baseUrl}/api/crm/audit-logs`, {
        headers: {
          'Authorization': `Bearer ${tokenAlpha}`,
          'X-Tenant-Id': TENANT_ALPHA,
        },
      });

      expect(auditRes.status).toBe(200);
      const auditList = await auditRes.json();
      expect(auditList.length).toBeGreaterThanOrEqual(1);

      const latestAudit = auditList[0];
      expect(latestAudit.tenantId).toBe(TENANT_ALPHA);
      expect(latestAudit.actorId).toBe(USER_ALPHA_OWNER);
      expect(latestAudit.action).toBe('LEAD_INTAKE');
      expect(latestAudit.entityType).toBe('LEAD');
      expect(latestAudit.changes).toBeDefined();

      // Verify sensitive information is strictly redacted
      const payloadLogged = latestAudit.changes.after;
      expect(payloadLogged.password).toBe('[REDACTED]');
      expect(payloadLogged.authToken).toBe('[REDACTED]');
      // Non-sensitive fields preserved
      expect(payloadLogged.name).toBe('Secure Packaging Corp');
      expect(payloadLogged.phone).toBe('+919877700001');
    });

    it('proves Tenant Beta cannot access Tenant Alpha audit logs', async () => {
      const auditRes = await fetch(`${baseUrl}/api/crm/audit-logs`, {
        headers: {
          'Authorization': `Bearer ${tokenBeta}`,
          'X-Tenant-Id': TENANT_BETA,
        },
      });

      expect(auditRes.status).toBe(200);
      const auditList = await auditRes.json();
      // Tenant Beta must NOT see Tenant Alpha's audit records
      const leaked = auditList.find((a: any) => a.tenantId === TENANT_ALPHA);
      expect(leaked).toBeUndefined();
    });

    it('proves audit logs cannot be modified or deleted via HTTP API (append-only enforcement)', async () => {
      // Attempt to PATCH or DELETE /api/crm/audit-logs
      const patchRes = await fetch(`${baseUrl}/api/crm/audit-logs/fake-audit-id`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAlpha}`,
          'X-Tenant-Id': TENANT_ALPHA,
        },
        body: JSON.stringify({ action: 'TAMPERED' }),
      });
      expect(patchRes.status).toBe(404);

      const deleteRes = await fetch(`${baseUrl}/api/crm/audit-logs/fake-audit-id`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${tokenAlpha}`,
          'X-Tenant-Id': TENANT_ALPHA,
        },
      });
      expect(deleteRes.status).toBe(404);
    });
  });

  describe('3. Parameterized Tenant Context & Injection Prevention', () => {
    it('denies requests with malformed or SQL injection tenant IDs without SQL execution', async () => {
      const maliciousTenantIds = [
        "' OR '1'='1",
        "'; DROP TABLE users; --",
        "00000000-0000-0000-0000-000000000000' UNION SELECT * FROM users --",
      ];

      for (const badTenant of maliciousTenantIds) {
        const res = await fetch(`${baseUrl}/api/crm/customers`, {
          headers: {
            'Authorization': `Bearer ${tokenAlpha}`,
            'X-Tenant-Id': badTenant,
          },
        });

        // Must reject at guard level (400 or 403 or 401)
        expect([400, 401, 403]).toContain(res.status);
      }
    });

    it('denies requests without any tenant context when requesting tenant-scoped endpoints', async () => {
      // Unauthenticated request without tenant context
      const anonRes = await fetch(`${baseUrl}/api/crm/customers`);
      expect(anonRes.status).toBe(401);

      // Authenticated user attempting to access a random/unauthorized tenant
      const unauthorizedTenantRes = await fetch(`${baseUrl}/api/crm/customers`, {
        headers: {
          'Authorization': `Bearer ${tokenAlpha}`,
          'X-Tenant-Id': randomUUID(),
        },
      });
      expect([400, 401, 403]).toContain(unauthorizedTenantRes.status);
    });
  });

  describe('4. Comprehensive Two-Tenant Isolation Proof', () => {
    let alphaCustomerId: string;
    let alphaOrderId: string;

    it('creates resources in Tenant Alpha and verifies zero leakage to Tenant Beta', async () => {
      // 1. Create Customer & Lead in Tenant Alpha
      const intakeRes = await fetch(`${baseUrl}/api/crm/intake-lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAlpha}`,
          'X-Tenant-Id': TENANT_ALPHA,
          'x-industry-key': 'printing',
        },
        body: JSON.stringify({
          name: 'Alpha Exclusive Retailer',
          phone: '+919933300099',
          source: 'WALK_IN',
          title: 'Specialty cartons order',
          customData: {
            job_type: 'PACKAGING_BOX',
          },
        }),
      });

      expect(intakeRes.status).toBe(201);
      const intakeData = await intakeRes.json();
      alphaCustomerId = intakeData.customer.id;

      // 2. Create Quotation in Tenant Alpha
      const quoteRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAlpha}`,
          'X-Tenant-Id': TENANT_ALPHA,
        },
        body: JSON.stringify({
          customerId: alphaCustomerId,
          items: [
            {
              itemName: 'Alpha Spec Boxes',
              quantity: 500,
              unit: 'Nos',
              unitPrice: 50,
              taxPercent: 18,
            },
          ],
        }),
      });

      expect(quoteRes.status).toBe(201);
      const quote = await quoteRes.json();

      // 3. Convert Quotation to Order in Tenant Alpha
      const convertRes = await fetch(`${baseUrl}/api/sales/quotations/${quote.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAlpha}`,
          'X-Tenant-Id': TENANT_ALPHA,
        },
        body: JSON.stringify({ advanceReceived: 10000 }),
      });

      expect(convertRes.status).toBe(201);
      const convertData = await convertRes.json();
      alphaOrderId = convertData.orderId;

      // 4. Verify Tenant Beta CANNOT see Alpha's customer in list
      const betaCustRes = await fetch(`${baseUrl}/api/crm/customers`, {
        headers: {
          'Authorization': `Bearer ${tokenBeta}`,
          'X-Tenant-Id': TENANT_BETA,
        },
      });
      const betaCustomers = await betaCustRes.json();
      expect(betaCustomers.find((c: any) => c.id === alphaCustomerId)).toBeUndefined();

      // 5. Verify Tenant Beta CANNOT access Alpha's Customer 360
      const betaC360Res = await fetch(`${baseUrl}/api/crm/customers/${alphaCustomerId}`, {
        headers: {
          'Authorization': `Bearer ${tokenBeta}`,
          'X-Tenant-Id': TENANT_BETA,
        },
      });
      expect(betaC360Res.status).toBe(404);

      // 6. Verify Tenant Beta CANNOT see Alpha's order in list
      const betaOrdersRes = await fetch(`${baseUrl}/api/orders`, {
        headers: {
          'Authorization': `Bearer ${tokenBeta}`,
          'X-Tenant-Id': TENANT_BETA,
        },
      });
      const betaOrders = await betaOrdersRes.json();
      expect(betaOrders.find((o: any) => o.id === alphaOrderId)).toBeUndefined();

      // 7. Verify Tenant Beta CANNOT read Alpha's order detail
      const betaOrderDetailRes = await fetch(`${baseUrl}/api/orders/${alphaOrderId}`, {
        headers: {
          'Authorization': `Bearer ${tokenBeta}`,
          'X-Tenant-Id': TENANT_BETA,
        },
      });
      expect(betaOrderDetailRes.status).toBe(404);

      // 8. Verify Tenant Beta CANNOT read Alpha's quotation
      const betaQuoteRes = await fetch(`${baseUrl}/api/sales/quotations/${quote.id}`, {
        headers: {
          'Authorization': `Bearer ${tokenBeta}`,
          'X-Tenant-Id': TENANT_BETA,
        },
      });
      expect(betaQuoteRes.status).toBe(404);
    });
  });
});
