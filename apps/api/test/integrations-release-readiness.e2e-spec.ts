import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { DevNotificationAdapter } from '../src/modules/notifications/adapters/dev-notification.adapter';
import { DevEmailAdapter } from '../src/modules/notifications/adapters/dev-email.adapter';
import { TenantNotificationProviderManager } from '../src/modules/notifications/adapters/tenant-provider-manager';
import {
  globalMemoryTenants,
  globalMemoryOrders,
  globalMemoryOutbox,
} from '../src/modules/crm/memory-store';
import { randomUUID } from 'crypto';

describe('Friendly CRM — Phase 8: Integrations and Release Readiness E2E Suite', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authService: AuthService;

  const TENANT_ID = '99998888-7777-4666-8555-444433332222';
  const USER_OWNER = '11112222-3333-4444-5555-666677778888';
  const USER_PRODUCTION = '22223333-4444-5555-6666-777788889999';

  let tokenOwner: string;
  let tokenProduction: string;

  const orderId = 'order-phase8-test-1';
  const outboxJobId = 'job-phase8-msg-1';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    process.env.WHATSAPP_WEBHOOK_SECRET = 'dev-webhook-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);

    baseUrl = await app.getUrl();
    authService = moduleFixture.get<AuthService>(AuthService);

    // Register Tenant
    globalMemoryTenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: 'Vasantham Offset Printers',
      industryKey: 'printing',
      phone: '+919840998877',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // Register Users & Roles
    authService.registerUser({ id: USER_OWNER, fullName: 'Vasantham Owner', phone: '+919840998877' });
    authService.registerUser({ id: USER_PRODUCTION, fullName: 'Vasantham Prod', phone: '+919840887766' });

    authService.registerMembership(TENANT_ID, USER_OWNER, 'OWNER', true);
    authService.registerMembership(TENANT_ID, USER_PRODUCTION, 'PRODUCTION', true);

    const loginUser = async (phone: string): Promise<string> => {
      await authService.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const session = await authService.verifyOtp({ phone, code, tenantId: TENANT_ID });
      return session.token;
    };

    tokenOwner = await loginUser('+919840998877');
    tokenProduction = await loginUser('+919840887766');

    // Seed Order
    globalMemoryOrders.push({
      id: orderId,
      tenantId: TENANT_ID,
      customerId: 'cust-phase8-1',
      orderNumber: 'ORD-2026-0001',
      status: 'CONFIRMED',
      currentStageId: 'ORDER_CONFIRMED',
      totalAmount: '50000.00',
      advanceReceived: '10000.00',
      balanceDue: '40000.00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed Outbox Job for Delivery Callback Test
    globalMemoryOutbox.push({
      id: outboxJobId,
      tenantId: TENANT_ID,
      channel: 'WHATSAPP',
      recipientPhone: '+919840112233',
      status: 'SENT',
      payload: { templateKey: 'ORDER_CONFIRMED' },
      attempts: 1,
      maxAttempts: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('1. Health and Readiness Probes', () => {
    it('GET /api/health returns liveness status 200 with service name and uptime', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('ok');
      expect(json.service).toBe('friendly-crm-api');
      expect(typeof json.uptime).toBe('number');
      expect(json.timestamp).toBeDefined();
    });

    it('GET /api/ready returns readiness status 200', async () => {
      const res = await fetch(`${baseUrl}/api/ready`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('ready');
      expect(json.database).toBeDefined();
    });
  });

  describe('2. WhatsApp Webhook Verification and Delivery Deduplication', () => {
    it('verifies webhook subscription challenge with valid secret token', async () => {
      const challenge = 'challenge_test_token_12345';
      const res = await fetch(
        `${baseUrl}/api/notifications/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=dev-webhook-secret&hub.challenge=${challenge}`
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe(challenge);
    });

    it('rejects webhook subscription with invalid secret token (401)', async () => {
      const res = await fetch(
        `${baseUrl}/api/notifications/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=invalid-secret&hub.challenge=test`
      );
      expect(res.status).toBe(401);
    });

    it('rejects inbound webhook with missing or invalid signature (401)', async () => {
      const res = await fetch(`${baseUrl}/api/notifications/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'test' }),
      });
      expect(res.status).toBe(401);
    });

    it('accepts inbound delivery status webhook with valid secret and updates outbox status', async () => {
      const eventId = `event-${randomUUID()}`;
      const payload = {
        id: eventId,
        messageId: outboxJobId,
        status: 'DELIVERED',
      };

      const res = await fetch(`${baseUrl}/api/notifications/whatsapp/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'dev-webhook-secret',
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verify that outbox record was updated to DELIVERED
      const updatedJob = globalMemoryOutbox.find((j) => j.id === outboxJobId);
      expect(updatedJob?.status).toBe('DELIVERED');
    });

    it('deduplicates re-delivered webhook event without re-processing', async () => {
      const eventId = `dedup-event-${randomUUID()}`;
      const payload = {
        id: eventId,
        messageId: outboxJobId,
        status: 'READ',
      };

      // First call
      const res1 = await fetch(`${baseUrl}/api/notifications/whatsapp/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'dev-webhook-secret',
        },
        body: JSON.stringify(payload),
      });
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.processed).toBe(true);

      // Duplicate second call with same event ID
      const res2 = await fetch(`${baseUrl}/api/notifications/whatsapp/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'dev-webhook-secret',
        },
        body: JSON.stringify(payload),
      });
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.status).toBe('ignored_duplicate');
    });
  });

  describe('3. Per-Tenant WhatsApp Provider Manager', () => {
    it('resolves DevNotificationAdapter when in test environment', () => {
      const manager = new TenantNotificationProviderManager();
      const adapter = manager.getAdapterForTenant(TENANT_ID);
      expect(adapter).toBeInstanceOf(DevNotificationAdapter);
    });

    it('registers and resolves custom tenant credentials when configured', () => {
      const manager = new TenantNotificationProviderManager();
      manager.registerTenantConfig('custom-tenant-id', {
        apiUrl: 'https://waha.custom-tenant.com',
        apiKey: 'key_custom_123',
      });
      // In non-test mode it returns HttpWhatsAppAdapter
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_DEV_SMS_GATEWAY = 'false';
      const customAdapter = manager.getAdapterForTenant('custom-tenant-id');
      expect(customAdapter.name).toBe('hostinger-whatsapp');
      // Reset test environment
      process.env.NODE_ENV = 'test';
      process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    });
  });

  describe('4. Transactional Email Adapter', () => {
    it('safely captures and masks simulated email delivery without external network calls', async () => {
      DevEmailAdapter.clear();
      const emailAdapter = new DevEmailAdapter();

      const result = await emailAdapter.sendEmail({
        to: 'ramesh.murugan@example.com',
        subject: 'Quotation #QT-2026-0001 from Vasantham Offset',
        text: 'Please find attached your quotation.',
        tenantId: TENANT_ID,
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();

      const captured = DevEmailAdapter.getLatestEmail('ramesh.murugan@example.com');
      expect(captured).toBeDefined();
      expect(captured?.subject).toContain('Quotation #QT-2026-0001');
    });
  });
});
