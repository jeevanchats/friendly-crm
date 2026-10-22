import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { randomUUID } from 'crypto';
import { globalMemoryCustomers } from '../src/modules/crm/memory-store';

describe('Friendly CRM — Phase 2: Close Data Leaks and Fix Persistence Suite', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authService: AuthService;

  // Test Tenants
  const TENANT_A_PRINTING = '11111111-1111-4111-8111-111111111111';
  const TENANT_B_FURNITURE = '22222222-2222-4222-8222-222222222222';

  // Test Users
  const USER_OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USER_SALES_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const USER_OWNER_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  // Session Tokens
  let tokenOwnerA: string;
  let tokenSalesA: string;
  let tokenOwnerB: string;

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

    // Register Users & Memberships
    authService.registerUser({ id: USER_OWNER_A, fullName: 'Owner A', phone: '+919811111111' });
    authService.registerUser({ id: USER_SALES_A, fullName: 'Sales Rep A', phone: '+919811111112' });
    authService.registerUser({ id: USER_OWNER_B, fullName: 'Owner B', phone: '+919822222222' });

    authService.registerMembership(TENANT_A_PRINTING, USER_OWNER_A, 'OWNER', true);
    authService.registerMembership(TENANT_A_PRINTING, USER_SALES_A, 'SALESPERSON', true);
    authService.registerMembership(TENANT_B_FURNITURE, USER_OWNER_B, 'OWNER', true);

    // Register test customer for Tenant A
    globalMemoryCustomers.push({
      id: 'c-tenant-a-1',
      tenantId: TENANT_A_PRINTING,
      name: 'Tenant A Customer',
      phone: '+919811199999',
      companyName: 'Tenant A Corp',
      openingBalance: '0.00',
      creditLimit: '100000.00',
      activeOrdersCount: 0,
      totalReceivable: '0.00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const getSession = async (phone: string, tenantId: string) => {
      await authService.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const session = await authService.verifyOtp({ phone, code, tenantId });
      return session.token;
    };

    tokenOwnerA = await getSession('+919811111111', TENANT_A_PRINTING);
    tokenSalesA = await getSession('+919811111112', TENANT_A_PRINTING);
    tokenOwnerB = await getSession('+919822222222', TENANT_B_FURNITURE);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Atomic Onboarding & Persistence', () => {
    it('creates a new tenant with UUID, owner user, and membership', async () => {
      const onboardRes = await fetch(`${baseUrl}/api/tenants/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Coimbatore Offset Printers',
          slug: 'coimbatore-offset',
          industry: 'printing',
          ownerPhone: '+919844455566',
          ownerName: 'Murugesan K',
          gstNumber: '33AAAAA0000A1Z5',
        }),
      });

      expect(onboardRes.status).toBe(201);
      const onboardData = await onboardRes.json();
      expect(onboardData.tenantId).toBeDefined();
      expect(typeof onboardData.tenantId).toBe('string');
      // Verify tenantId is a valid UUID
      expect(onboardData.tenantId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(onboardData.ownerId).toBeDefined();
      expect(onboardData.industry).toBe('printing');

      // Verify the new owner can request OTP and authenticate
      await authService.requestOtp({ phone: '+919844455566', countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone('+919844455566'))!;
      const session = await authService.verifyOtp({
        phone: '+919844455566',
        code,
        tenantId: onboardData.tenantId,
      });

      expect(session.token).toBeDefined();
      expect(session.user.role).toBe('OWNER');

      // Verify tenant details
      const detailsRes = await fetch(`${baseUrl}/api/tenants/current`, {
        headers: {
          'Authorization': `Bearer ${session.token}`,
          'X-Tenant-Id': onboardData.tenantId,
        },
      });
      expect(detailsRes.status).toBe(200);
      const details = await detailsRes.json();
      expect(details.id).toBe(onboardData.tenantId);
      expect(details.name).toBe('Coimbatore Offset Printers');
      expect(details.activeMembers).toBeGreaterThanOrEqual(1);
    });
  });

  describe('2. Anti-Leak: Unknown and Cross-Tenant Quotation Reads', () => {
    it('returns 404 for non-existent quotation ID without leaking sample demo quotations', async () => {
      const nonExistentQuoteId = randomUUID();
      const res = await fetch(`${baseUrl}/api/sales/quotations/${nonExistentQuoteId}`, {
        headers: {
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.message).toContain('not found');
      // Must NOT return demo quotation 'quote-demo-1' or 'QT-2026-0042'
      expect(body.quoteNumber).toBeUndefined();
    });

    it('returns 404 when Tenant B attempts to read Tenant A quotation', async () => {
      // First create a quotation in Tenant A for the registered customer
      const createRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
        body: JSON.stringify({
          customerId: 'c-tenant-a-1',
          items: [
            {
              itemName: 'Custom Mono Cartons',
              quantity: 1000,
              unit: 'Nos',
              unitPrice: 15,
              taxPercent: 18,
            },
          ],
        }),
      });

      expect(createRes.status).toBe(201);
      const createdQuote = await createRes.json();
      const quoteId = createdQuote.id;
      expect(quoteId).toBeDefined();

      // Tenant B attempts to access Tenant A's quote
      const crossTenantRes = await fetch(`${baseUrl}/api/sales/quotations/${quoteId}`, {
        headers: {
          'Authorization': `Bearer ${tokenOwnerB}`,
          'X-Tenant-Id': TENANT_B_FURNITURE,
        },
      });

      expect(crossTenantRes.status).toBe(404);
    });

    it('returns 404 when attempting to create a revision on a non-existent or foreign quotation', async () => {
      const fakeId = randomUUID();
      const res = await fetch(`${baseUrl}/api/sales/quotations/${fakeId}/revisions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
        body: JSON.stringify({
          items: [
            {
              itemName: 'Revised Mono Cartons',
              quantity: 2000,
              unit: 'Nos',
              unitPrice: 14,
            },
          ],
        }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('3. Anti-Leak: Unknown and Cross-Tenant Order Operations', () => {
    it('returns 404 for non-existent order ID', async () => {
      const fakeOrderId = randomUUID();
      const res = await fetch(`${baseUrl}/api/orders/${fakeOrderId}`, {
        headers: {
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when updating stage of an order in another tenant', async () => {
      // ord-demo-1 belongs to t-demo-printing, not TENANT_B_FURNITURE
      const res = await fetch(`${baseUrl}/api/orders/ord-demo-1/stage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwnerB}`,
          'X-Tenant-Id': TENANT_B_FURNITURE,
        },
        body: JSON.stringify({ nextStageId: 'PRINTING' }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when recording payment for an order in another tenant', async () => {
      const res = await fetch(`${baseUrl}/api/orders/ord-demo-1/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwnerB}`,
          'X-Tenant-Id': TENANT_B_FURNITURE,
        },
        body: JSON.stringify({ amount: 5000, mode: 'UPI' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('4. Full Cross-Domain Persistence: Lead Intake -> Quote -> Convert -> Orders -> Customer 360 -> Reports', () => {
    let createdCustomerId: string;
    let createdLeadId: string;
    let createdTaskId: string;
    let createdQuoteId: string;
    let createdOrderId: string;
    const testPhone = '+919988776655';

    it('step 1: intakes rapid lead, matches customer and auto-schedules follow-up task', async () => {
      const intakeRes = await fetch(`${baseUrl}/api/crm/intake-lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
          'x-industry-key': 'printing',
        },
        body: JSON.stringify({
          name: 'Saravana Sweets & Bakes',
          companyName: 'Saravana Confectionery LLP',
          phone: testPhone,
          source: 'WHATSAPP',
          priority: 'HIGH',
          title: 'Diwali Sweet Boxes 10k units order inquiry',
          customData: {
            job_type: 'PACKAGING_BOX',
            paper_board_gsm: '350 GSM Cyber Premium Board',
          },
        }),
      });

      expect(intakeRes.status).toBe(201);
      const intakeData = await intakeRes.json();
      expect(intakeData.success).toBe(true);
      expect(intakeData.customer.id).toBeDefined();
      expect(intakeData.lead.id).toBeDefined();
      expect(intakeData.followUpTask.id).toBeDefined();

      createdCustomerId = intakeData.customer.id;
      createdLeadId = intakeData.lead.id;
      createdTaskId = intakeData.followUpTask.id;
    });

    it('step 2: verifies newly scheduled follow-up task appears immediately in Home Dashboard', async () => {
      const dashRes = await fetch(`${baseUrl}/api/crm/dashboard`, {
        headers: {
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });

      expect(dashRes.status).toBe(200);
      const dash = await dashRes.json();
      expect(dash.summaryCards.dueFollowUps).toBeGreaterThanOrEqual(1);

      // Verify the task is present in priorityTasks
      const foundTask = dash.priorityTasks.find((t: any) => t.id === createdTaskId);
      expect(foundTask).toBeDefined();
      expect(foundTask.customerName).toContain('Saravana');
    });

    it('step 3: completes follow-up task and confirms real-time KPI update', async () => {
      const completeRes = await fetch(`${baseUrl}/api/crm/tasks/${createdTaskId}/complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
        body: JSON.stringify({
          outcomeNote: 'Spoke with Mr. Saravanan. Approved 10k sweet box specs. Ready for quotation.',
        }),
      });

      expect(completeRes.status).toBe(200);
      const completeData = await completeRes.json();
      expect(completeData.task.status).toBe('COMPLETED');
      expect(completeData.task.outcomeNote).toContain('Approved 10k sweet box specs');
    });

    it('step 4: creates a quotation for the lead', async () => {
      const quoteRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
        body: JSON.stringify({
          customerId: createdCustomerId,
          leadId: createdLeadId,
          items: [
            {
              itemName: 'Premium Embossed Sweet Box 1kg',
              description: '350 GSM Cyber Board, CMYK + Gold Foil Stamping',
              quantity: 10000,
              unit: 'Nos',
              unitPrice: 25.0,
              taxPercent: 18.0,
            },
          ],
          customData: {
            job_type: 'PACKAGING_BOX',
            paper_board_gsm: '350 GSM Cyber Premium Board',
          },
        }),
      });

      expect(quoteRes.status).toBe(201);
      const quoteData = await quoteRes.json();
      expect(quoteData.id).toBeDefined();
      expect(quoteData.grandTotal).toBe('295000.00'); // (10000 * 25) + 18% tax = 250000 + 45000 = 295000
      expect(quoteData.status).toBe('SENT');

      createdQuoteId = quoteData.id;
    });

    it('step 5: converts the quotation into a confirmed production order', async () => {
      const convertRes = await fetch(`${baseUrl}/api/sales/quotations/${createdQuoteId}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
        body: JSON.stringify({
          advanceAmount: 100000.0,
          paymentMode: 'UPI',
          paymentReference: 'UPI/SARAVANA/88129',
          notes: 'Received initial 1 lakh advance via Google Pay',
        }),
      });

      expect(convertRes.status).toBe(201);
      const convertData = await convertRes.json();
      expect(convertData.success).toBe(true);
      expect(convertData.orderId).toBeDefined();
      expect(convertData.orderNumber).toBeDefined();
      expect(convertData.quotation.status).toBe('CONVERTED');

      createdOrderId = convertData.orderId;
    });

    it('step 6: verifies converted order immediately appears in Orders list with isolated tenant scope', async () => {
      const ordersRes = await fetch(`${baseUrl}/api/orders`, {
        headers: {
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });

      expect(ordersRes.status).toBe(200);
      const ordersList = await ordersRes.json();
      const foundOrder = ordersList.find((o: any) => o.id === createdOrderId);
      expect(foundOrder).toBeDefined();
      expect(foundOrder.customerId).toBe(createdCustomerId);
      expect(parseFloat(foundOrder.totalAmount)).toBe(295000.0);
      expect(parseFloat(foundOrder.advanceReceived)).toBe(100000.0);
      expect(parseFloat(foundOrder.balanceDue)).toBe(195000.0);

      // Verify Tenant B CANNOT see this order
      const tenantBOrdersRes = await fetch(`${baseUrl}/api/orders`, {
        headers: {
          'Authorization': `Bearer ${tokenOwnerB}`,
          'X-Tenant-Id': TENANT_B_FURNITURE,
        },
      });
      const tenantBOrders = await tenantBOrdersRes.json();
      const leak = tenantBOrders.find((o: any) => o.id === createdOrderId);
      expect(leak).toBeUndefined();
    });

    it('step 7: verifies converted order and quotation appear in Customer 360', async () => {
      const c360Res = await fetch(`${baseUrl}/api/crm/customers/${createdCustomerId}`, {
        headers: {
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });

      expect(c360Res.status).toBe(200);
      const c360 = await c360Res.json();
      expect(c360.customer.id).toBe(createdCustomerId);
      expect(c360.customer.phone).toBe(testPhone);

      // Check linked quotes
      const quoteInC360 = c360.quotations.find((q: any) => q.id === createdQuoteId);
      expect(quoteInC360).toBeDefined();

      // Check linked orders
      const orderInC360 = c360.orders.find((o: any) => o.id === createdOrderId);
      expect(orderInC360).toBeDefined();
      expect(parseFloat(orderInC360.balanceDue)).toBe(195000.0);

      // Check linked payments
      expect(c360.payments.length).toBeGreaterThanOrEqual(1);
      const paymentInC360 = c360.payments.find((p: any) => p.orderId === createdOrderId);
      expect(paymentInC360).toBeDefined();
      expect(parseFloat(paymentInC360.amount)).toBe(100000.0);

      // Financial summary
      expect(c360.financialSummary).toBeDefined();
      expect(parseFloat(c360.financialSummary.lifetimeOrderValue)).toBeGreaterThanOrEqual(295000.0);

      // Cross-tenant access check: Tenant B requesting Tenant A's customer returns 404
      const foreignC360Res = await fetch(`${baseUrl}/api/crm/customers/${createdCustomerId}`, {
        headers: {
          'Authorization': `Bearer ${tokenOwnerB}`,
          'X-Tenant-Id': TENANT_B_FURNITURE,
        },
      });
      expect(foreignC360Res.status).toBe(404);
    });

    it('step 8: verifies converted order reflects in Executive Business Reports', async () => {
      const reportsRes = await fetch(`${baseUrl}/api/crm/reports`, {
        headers: {
          'Authorization': `Bearer ${tokenOwnerA}`,
          'X-Tenant-Id': TENANT_A_PRINTING,
        },
      });

      expect(reportsRes.status).toBe(200);
      const reports = await reportsRes.json();
      expect(reports.financials).toBeDefined();
      expect(parseFloat(reports.financials.totalSalesBooked)).toBeGreaterThanOrEqual(295000.0);
      expect(parseFloat(reports.financials.totalCollected)).toBeGreaterThanOrEqual(100000.0);
      expect(parseFloat(reports.financials.totalPendingReceivables)).toBeGreaterThanOrEqual(195000.0);
    });
  });
});
