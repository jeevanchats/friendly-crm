import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { NotificationOutboxService } from '../src/modules/notifications/notification-outbox.service';
import { TemplateEngine } from '../src/modules/notifications/templates/template-engine';
import { DevNotificationAdapter } from '../src/modules/notifications/adapters/dev-notification.adapter';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryOutbox,
} from '../src/modules/crm/memory-store';

describe('Friendly CRM — Phase 6: Resilient Messaging & Outbound Notification Outbox Suite', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authService: AuthService;
  let outboxService: NotificationOutboxService;
  let templateEngine: TemplateEngine;

  // Dedicated Test Tenants
  const TENANT_A = '66666666-6666-4666-8666-666666666666';
  const TENANT_B = '77777777-6666-4666-8666-666666666666';

  // Users
  const USER_A_OWNER = '11111111-6666-4666-8666-666666666666';
  const USER_B_OWNER = '22222222-6666-4666-8666-666666666666';

  let tokenA: string;
  let tokenB: string;

  const customerIdA = 'cust-msg-test-1';

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
    outboxService = moduleFixture.get<NotificationOutboxService>(NotificationOutboxService);
    templateEngine = moduleFixture.get<TemplateEngine>(TemplateEngine);

    // Seed Tenants
    globalMemoryTenants.set(TENANT_A, {
      id: TENANT_A,
      name: 'Alpha Printing',
      industryKey: 'printing',
      defaultLanguage: 'en',
      phone: '+919999000001',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    globalMemoryTenants.set(TENANT_B, {
      id: TENANT_B,
      name: 'Beta Textiles',
      industryKey: 'textiles',
      defaultLanguage: 'ta',
      phone: '+919999000002',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    authService.registerUser({ id: USER_A_OWNER, fullName: 'Alpha Owner', phone: '+919840900001' });
    authService.registerUser({ id: USER_B_OWNER, fullName: 'Beta Owner', phone: '+919840900002' });

    authService.registerMembership(TENANT_A, USER_A_OWNER, 'OWNER', true);
    authService.registerMembership(TENANT_B, USER_B_OWNER, 'OWNER', true);

    const getSession = async (phone: string, tenantId: string) => {
      await authService.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const session = await authService.verifyOtp({ phone, code, tenantId });
      return session.token;
    };

    tokenA = await getSession('+919840900001', TENANT_A);
    tokenB = await getSession('+919840900002', TENANT_B);

    // Seed customer in Tenant A
    globalMemoryCustomers.push({
      id: customerIdA,
      tenantId: TENANT_A,
      name: 'Saravana Sweet Mart',
      phone: '+919840112233',
      companyName: 'Saravana Group',
      openingBalance: '0.00',
      creditLimit: '100000.00',
      activeOrdersCount: 0,
      totalReceivable: '0.00',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  });

  beforeEach(() => {
    DevNotificationAdapter.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Section 1: Parameterized Template Interpolation & Sanitization', () => {
    it('1.1: Replaces variables and applies default fallbacks for missing parameters', () => {
      const rendered = templateEngine.render(
        'Hello {{customerName || "Valued Customer"}}, your quote {{quoteNumber}} total is ₹{{grandTotal || "0.00"}}.',
        { quoteNumber: 'QT-2026-001' }
      );
      expect(rendered).toBe('Hello Valued Customer, your quote QT-2026-001 total is ₹0.00.');
      expect(rendered).not.toContain('undefined');
      expect(rendered).not.toContain('null');
    });

    it('1.2: Renders localized built-in templates (Tamil and English)', () => {
      const enOutput = templateEngine.renderTemplate('ORDER_CONFIRMED', 'en', {
        customerName: 'Anbu',
        orderNumber: 'ORD-2026-101',
        stageName: 'Printing CTP',
      });
      expect(enOutput).toContain('Hello Anbu');
      expect(enOutput).toContain('*ORD-2026-101*');
      expect(enOutput).toContain('Printing CTP');

      const taOutput = templateEngine.renderTemplate('ORDER_CONFIRMED', 'ta', {
        customerName: 'அன்பு',
        orderNumber: 'ORD-2026-101',
        stageName: 'அச்சிடுதல் நிலை',
      });
      expect(taOutput).toContain('வணக்கம் அன்பு');
      expect(taOutput).toContain('*ORD-2026-101* உறுதி செய்யப்பட்டது');
    });

    it('1.3: Escapes special characters to prevent template / HTML injection', () => {
      const escaped = templateEngine.escapeParam('<script>alert("xss")</script>');
      expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(escaped).not.toContain('<script>');
    });
  });

  describe('Section 2: Decoupled Outbound Messaging & Outage Resilience', () => {
    it('2.1: Quotation creation queues an outbox job without blocking transactional completion', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'x-tenant-id': TENANT_A,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: customerIdA,
          validDays: 15,
          items: [
            {
              description: 'Luxury Sweet Box 350 GSM',
              quantity: 500,
              unit: 'Nos',
              unitPrice: 40.0,
              taxPercent: 18.0,
            },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const quote = await res.json();
      expect(quote.id).toBeDefined();
      expect(quote.grandTotal).toBe('23600.00');

      // Verify that outbox job was enqueued
      const outboxJobs = await outboxService.getOutboxJobs(TENANT_A);
      const matchingJob = outboxJobs.find((j: any) => j.templateKey === 'QUOTATION_CREATED');
      expect(matchingJob).toBeDefined();
      expect(matchingJob.recipient).toBe('+919840112233');
      expect(matchingJob.status).toBe('PENDING');
      expect(matchingJob.renderedMessage).toContain(quote.quoteNumber);
    });

    it('2.2: Even if external messaging provider is DOWN (simulated vendor outage), order conversion succeeds', async () => {
      // Simulate external vendor outage / 500 network failure
      DevNotificationAdapter.simulateFailure = true;
      DevNotificationAdapter.failureErrorMessage = 'Hostinger WhatsApp Gateway HTTP 503 Service Unavailable';

      // 1. Create quote
      const quoteRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'x-tenant-id': TENANT_A,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: customerIdA,
          items: [{ unit: 'Nos', description: 'Visiting Cards', quantity: 1000, unitPrice: 2.0, taxPercent: 18.0 }],
        }),
      });
      const quote = await quoteRes.json();

      // 2. Convert quote to order with advance payment — MUST SUCCEED despite messaging outage!
      const convertRes = await fetch(`${baseUrl}/api/sales/quotations/${quote.id}/convert`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'x-tenant-id': TENANT_A,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          advanceReceived: 1000,
          paymentMode: 'UPI',
        }),
      });

      expect(convertRes.status).toBe(201);
      const order = await convertRes.json();
      expect(order.orderNumber).toBeDefined();
      expect(order.totalAmount).toBe('2360.00');
      expect(order.advanceReceived).toBe('1000.00');
      expect(order.balanceDue).toBe('1360.00');

      // Outbox has ORDER_CONFIRMED queued safely
      const outbox = await outboxService.getOutboxJobs(TENANT_A);
      const confJob = outbox.find((j: any) => j.templateKey === 'ORDER_CONFIRMED' && j.renderedMessage.includes(order.orderNumber));
      expect(confJob).toBeDefined();
      expect(confJob.status).toBe('PENDING');
    });

    it('2.3: Recording payment succeeds and enqueues payment receipt notification despite vendor downtime', async () => {
      DevNotificationAdapter.simulateFailure = true;

      // 1. Fetch orders
      const ordersRes = await fetch(`${baseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'x-tenant-id': TENANT_A },
      });
      const orders = await ordersRes.json();
      const targetOrder = orders[0];

      // 2. Record payment
      const payRes = await fetch(`${baseUrl}/api/orders/${targetOrder.id}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'x-tenant-id': TENANT_A,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: 500,
          mode: 'CASH',
          referenceNo: 'CASH-REC-001',
        }),
      });

      expect(payRes.status).toBe(201);
      const payResult = await payRes.json();
      expect(payResult.payment.receiptNumber).toBeDefined();

      const outbox = await outboxService.getOutboxJobs(TENANT_A);
      const payJob = outbox.find((j: any) => j.templateKey === 'PAYMENT_RECEIPT');
      expect(payJob).toBeDefined();
      expect(payJob.renderedMessage).toContain(payResult.payment.receiptNumber);
    });
  });

  describe('Section 3: Background Outbox Dispatch, Retries & Dead-Letter Handling', () => {
    it('3.1: Successfully dispatches pending outbox notifications when vendor is healthy', async () => {
      DevNotificationAdapter.simulateFailure = false;

      // Manually trigger outbox batch processor
      const processRes = await fetch(`${baseUrl}/api/notifications/outbox/process`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(processRes.status).toBe(201);
      const summary = await processRes.json();
      expect(summary.processed).toBeGreaterThan(0);
      expect(summary.sent).toBeGreaterThan(0);

      // Verify that DevNotificationAdapter safely captured the dispatched messages
      expect(DevNotificationAdapter.capturedMessages.length).toBeGreaterThan(0);
      const lastMsg = DevNotificationAdapter.capturedMessages[0];
      expect(lastMsg.recipient).toBe('+919840112233');
      expect(lastMsg.maskedRecipient).toBe('+9198***2233'); // PII masked
    });

    it('3.2: Tracks retry attempts on delivery failure and increments attempt count', async () => {
      // Enqueue a test notification
      const testJob = await outboxService.enqueueNotification({
        tenantId: TENANT_A,
        recipient: '+919840998877',
        templateKey: 'QUOTATION_CREATED',
        params: { quoteNumber: 'QT-RETRY-01', grandTotal: '5000.00' },
        maxAttempts: 3,
      });

      // Simulate vendor timeout
      DevNotificationAdapter.simulateFailure = true;
      DevNotificationAdapter.failureErrorMessage = 'Socket timeout after 8000ms';

      // 1st dispatch attempt
      const attempt1 = await outboxService.dispatchJob(testJob.id, TENANT_A);
      expect(attempt1.status).toBe('FAILED');
      expect(attempt1.attempts).toBe(1);
      expect(attempt1.lastError).toContain('Socket timeout');

      // 2nd dispatch attempt
      const attempt2 = await outboxService.dispatchJob(testJob.id, TENANT_A);
      expect(attempt2.status).toBe('FAILED');
      expect(attempt2.attempts).toBe(2);
    });

    it('3.3: Moves notification to DEAD_LETTER after reaching maxAttempts', async () => {
      const deadJob = await outboxService.enqueueNotification({
        tenantId: TENANT_A,
        recipient: '+919840998877',
        rawMessage: 'Critical production alert',
        maxAttempts: 2,
      });

      DevNotificationAdapter.simulateFailure = true;

      // 1st attempt
      await outboxService.dispatchJob(deadJob.id, TENANT_A);
      // 2nd attempt (hits maxAttempts = 2)
      const finalResult = await outboxService.dispatchJob(deadJob.id, TENANT_A);

      expect(finalResult.status).toBe('DEAD_LETTER');
      expect(finalResult.attempts).toBe(2);
      expect(finalResult.lastError).toBeDefined();
    });

    it('3.4: Re-queues a DEAD_LETTER notification back to PENDING via retry endpoint', async () => {
      // Find the dead letter job from previous test
      const deadJobs = await outboxService.getOutboxJobs(TENANT_A, 'DEAD_LETTER');
      expect(deadJobs.length).toBeGreaterThan(0);
      const targetJob = deadJobs[0];

      const retryRes = await fetch(`${baseUrl}/api/notifications/outbox/${targetJob.id}/retry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(retryRes.status).toBe(201);
      const retried = await retryRes.json();
      expect(retried.status).toBe('PENDING');
      expect(retried.attempts).toBe(0);
      expect(retried.lastError).toBeNull();
    });
  });

  describe('Section 4: Tenant Isolation & PII Protection on Outbox', () => {
    it('4.1: Tenant B cannot view or access Tenant A outbox notifications', async () => {
      // Tenant B queries outbox
      const resB = await fetch(`${baseUrl}/api/notifications/outbox`, {
        headers: {
          Authorization: `Bearer ${tokenB}`,
          'x-tenant-id': TENANT_B,
        },
      });
      expect(resB.status).toBe(200);
      const jobsB = await resB.json();

      // Zero Tenant A jobs present
      const leakedAJob = jobsB.find((j: any) => j.tenantId === TENANT_A);
      expect(leakedAJob).toBeUndefined();
    });

    it('4.2: Development provider logs mask sensitive recipient PII', () => {
      const adapter = new DevNotificationAdapter();
      const masked = adapter.maskRecipient('+919840123456');
      expect(masked).toBe('+9198***3456');
      expect(masked).not.toContain('012');
    });
  });
});
