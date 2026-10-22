import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryLeads,
  globalMemoryQuotations,
  globalMemoryQuotationItems,
  globalMemoryOrders,
  globalMemoryOrderItems,
  globalMemoryPayments,
  globalMemoryActivities,
  globalMemoryTasks,
} from '../src/modules/crm/memory-store';
import { randomUUID } from 'crypto';

describe('Friendly CRM — Phase 5: Consistent Role-Aware Responses Suite', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authService: AuthService;

  // Dedicated Test Tenant
  const TENANT_ID = '99999999-9999-4999-8999-999999999999';

  // Test Users across RBAC Roles
  const USER_OWNER = '11111111-9999-4999-8999-999999999999';
  const USER_PRODUCTION = '22222222-9999-4999-8999-999999999999';
  const USER_ACCOUNTS = '33333333-9999-4999-8999-999999999999';
  const USER_SALES = '44444444-9999-4999-8999-999999999999';

  // Bearer Session Tokens
  let tokenOwner: string;
  let tokenProduction: string;
  let tokenAccounts: string;
  let tokenSales: string;

  // Seeded Business IDs
  const customerId = 'cust-role-test-1';
  const quoteId = 'quote-role-test-1';
  const orderId = 'order-role-test-1';

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

    // 1. Seed Tenant
    globalMemoryTenants.set(TENANT_ID, {
      id: TENANT_ID,
      name: 'Apex Printing Works',
      industryKey: 'printing',
      defaultLanguage: 'en',
      phone: '+919999999999',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // 2. Register users & memberships
    authService.registerUser({ id: USER_OWNER, fullName: 'Apex Owner', phone: '+919840111111' });
    authService.registerUser({ id: USER_PRODUCTION, fullName: 'Apex Prod Op', phone: '+919840222222' });
    authService.registerUser({ id: USER_ACCOUNTS, fullName: 'Apex Accounts', phone: '+919840333333' });
    authService.registerUser({ id: USER_SALES, fullName: 'Apex Salesperson', phone: '+919840444444' });

    authService.registerMembership(TENANT_ID, USER_OWNER, 'OWNER', true);
    authService.registerMembership(TENANT_ID, USER_PRODUCTION, 'PRODUCTION', true);
    authService.registerMembership(TENANT_ID, USER_ACCOUNTS, 'ACCOUNTS', true);
    authService.registerMembership(TENANT_ID, USER_SALES, 'SALESPERSON', true);

    // 3. Issue verified session tokens via SMS gateway
    const loginRole = async (phone: string): Promise<string> => {
      await authService.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const session = await authService.verifyOtp({ phone, code, tenantId: TENANT_ID });
      return session.token;
    };

    tokenOwner = await loginRole('+919840111111');
    tokenProduction = await loginRole('+919840222222');
    tokenAccounts = await loginRole('+919840333333');
    tokenSales = await loginRole('+919840444444');

    // 4. Seed Customer with opening balance and credit limit
    globalMemoryCustomers.push({
      id: customerId,
      tenantId: TENANT_ID,
      name: 'Karpagam Packaging Ltd',
      phone: '+919840555555',
      companyName: 'Karpagam Group',
      gstin: '33AABCK1234F1Z5',
      openingBalance: '15000.00',
      creditLimit: '250000.00',
      activeOrdersCount: 1,
      totalReceivable: '45000.00',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // 5. Seed Quotation with line items and customData physical specs
    globalMemoryQuotations.push({
      id: quoteId,
      tenantId: TENANT_ID,
      customerId,
      quoteNumber: 'QT-2026-9001',
      version: 1,
      status: 'CONVERTED',
      subTotal: '30000.00',
      taxTotal: '5400.00',
      discountTotal: '0.00',
      grandTotal: '35400.00',
      customData: {
        job_type: 'PACKAGING_BOX',
        paper_board_gsm: '350 GSM Cyber Premium Board',
        plate_size: '28x40 inch CTP',
        dimensions_lwh: '12x8x4 inches',
        artwork_approved: true,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    globalMemoryQuotationItems.push({
      id: 'qitem-role-test-1',
      quotationId: quoteId,
      tenantId: TENANT_ID,
      itemName: 'Embossed Sweet Box',
      description: '350 GSM Cyber Premium Board with Gold Foil',
      quantity: 1000,
      unit: 'Nos',
      unitPrice: '30.00',
      taxPercent: '18.00',
      discountPercent: '0.00',
      lineTotal: '35400.00',
    } as any);

    // 6. Seed Order with line items, advance, and balance due
    globalMemoryOrders.push({
      id: orderId,
      tenantId: TENANT_ID,
      customerId,
      quotationId: quoteId,
      orderNumber: 'ORD-2026-9001',
      productionStage: 'PRINTING_CMYK',
      totalAmount: '35400.00',
      advanceReceived: '10000.00',
      balanceDue: '25400.00',
      customData: {
        job_type: 'PACKAGING_BOX',
        paper_board_gsm: '350 GSM Cyber Premium Board',
        plate_size: '28x40 inch CTP',
        dimensions_lwh: '12x8x4 inches',
        artwork_approved: true,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    globalMemoryOrderItems.push({
      id: 'oitem-role-test-1',
      orderId,
      tenantId: TENANT_ID,
      itemName: 'Embossed Sweet Box',
      description: '350 GSM Cyber Premium Board with Gold Foil',
      quantity: 1000,
      unit: 'Nos',
      unitPrice: '30.00',
      taxPercent: '18.00',
      lineTotal: '35400.00',
    } as any);

    // 7. Seed Payment receipt
    globalMemoryPayments.push({
      id: 'pay-role-test-1',
      tenantId: TENANT_ID,
      customerId,
      orderId,
      receiptNumber: 'RCP-2026-9001',
      amount: 10000.00,
      mode: 'UPI',
      referenceNo: 'UPI-REF-998877',
      receivedById: USER_ACCOUNTS,
      paidAt: new Date(),
      notes: 'Initial advance payment',
    });

    // 8. Seed Activities: One stage update and one payment recording
    globalMemoryActivities.push(
      {
        id: randomUUID(),
        tenantId: TENANT_ID,
        actorId: USER_OWNER,
        entityType: 'ORDER',
        entityId: orderId,
        action: 'STAGE_UPDATED',
        metadata: {
          prevStage: 'PLATE_CTP',
          nextStage: 'PRINTING_CMYK',
          operatorNote: 'Plates verified and mounted on Heidelberg press',
          totalAmount: '35400.00', // sensitive financial field that must be redacted
        },
        createdAt: new Date(Date.now() - 3600000),
      },
      {
        id: randomUUID(),
        tenantId: TENANT_ID,
        actorId: USER_ACCOUNTS,
        entityType: 'ORDER',
        entityId: orderId,
        action: 'PAYMENT_RECORDED',
        metadata: {
          receiptNumber: 'RCP-2026-9001',
          amount: 10000.0,
          balanceRemaining: 25400.0,
        },
        createdAt: new Date(Date.now() - 1800000),
      }
    );

    // 9. Seed Follow-up Task
    globalMemoryTasks.push({
      id: 'task-role-test-1',
      tenantId: TENANT_ID,
      customerId,
      type: 'PRODUCTION_CHECK',
      title: 'Inspect First 50 Proof Sheets on Heidelberg',
      dueAt: new Date(Date.now() + 86400000),
      status: 'PENDING',
      assignedToId: USER_PRODUCTION,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Section 1: Orders Endpoints Masking (GET /api/orders and GET /api/orders/:id)', () => {
    it('1.1: PRODUCTION role on GET /api/orders receives null for financial fields', async () => {
      const res = await fetch(`${baseUrl}/api/orders`, {
        headers: {
          Authorization: `Bearer ${tokenProduction}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const orders = await res.json();
      expect(orders.length).toBeGreaterThan(0);

      const targetOrder = orders.find((o: any) => o.id === orderId);
      expect(targetOrder).toBeDefined();
      expect(targetOrder.totalAmount).toBeNull();
      expect(targetOrder.advanceReceived).toBeNull();
      expect(targetOrder.balanceDue).toBeNull();

      // Operational details remain intact for production floor
      expect(targetOrder.orderNumber).toBe('ORD-2026-9001');
      expect(targetOrder.productionStage).toBe('PRINTING_CMYK');
      expect(targetOrder.customer.name).toBe('Karpagam Packaging Ltd');
    });

    it('1.2: OWNER role on GET /api/orders receives full financial amounts', async () => {
      const res = await fetch(`${baseUrl}/api/orders`, {
        headers: {
          Authorization: `Bearer ${tokenOwner}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const orders = await res.json();
      const targetOrder = orders.find((o: any) => o.id === orderId);
      expect(targetOrder).toBeDefined();
      expect(targetOrder.totalAmount).toBe('35400.00');
      expect(targetOrder.advanceReceived).toBe('10000.00');
      expect(targetOrder.balanceDue).toBe('25400.00');
    });

    it('1.3: ACCOUNTS role on GET /api/orders receives full financial amounts', async () => {
      const res = await fetch(`${baseUrl}/api/orders`, {
        headers: {
          Authorization: `Bearer ${tokenAccounts}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const orders = await res.json();
      const targetOrder = orders.find((o: any) => o.id === orderId);
      expect(targetOrder).toBeDefined();
      expect(targetOrder.totalAmount).toBe('35400.00');
      expect(targetOrder.advanceReceived).toBe('10000.00');
      expect(targetOrder.balanceDue).toBe('25400.00');
    });

    it('1.4: PRODUCTION role on GET /api/orders/:id masks order totals, item unit prices & line totals, and payment history', async () => {
      const res = await fetch(`${baseUrl}/api/orders/${orderId}`, {
        headers: {
          Authorization: `Bearer ${tokenProduction}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const detail = await res.json();

      // Masked financial figures
      expect(detail.totalAmount).toBeNull();
      expect(detail.advanceReceived).toBeNull();
      expect(detail.balanceDue).toBeNull();
      expect(detail.items[0].unitPrice).toBeNull();
      expect(detail.items[0].lineTotal).toBeNull();
      expect(detail.payments).toEqual([]);

      // Preserved Job Specifications for Factory Operators
      expect(detail.customData.job_type).toBe('PACKAGING_BOX');
      expect(detail.customData.paper_board_gsm).toBe('350 GSM Cyber Premium Board');
      expect(detail.customData.plate_size).toBe('28x40 inch CTP');
      expect(detail.items[0].quantity).toBe(1000);
      expect(detail.items[0].unit).toBe('Nos');
    });

    it('1.5: PRODUCTION role on GET /api/orders/:id filters PAYMENT activities and sanitizes metadata', async () => {
      const res = await fetch(`${baseUrl}/api/orders/${orderId}`, {
        headers: {
          Authorization: `Bearer ${tokenProduction}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const detail = await res.json();

      // Zero PAYMENT_RECORDED or ADVANCE_RECORDED activities
      const paymentActs = detail.timeline.filter(
        (a: any) => a.action === 'PAYMENT_RECORDED' || a.action === 'ADVANCE_RECORDED'
      );
      expect(paymentActs).toHaveLength(0);

      // Remaining activities have financial fields stripped from metadata
      for (const act of detail.timeline) {
        expect(act.metadata?.amount).toBeUndefined();
        expect(act.metadata?.balanceRemaining).toBeUndefined();
        expect(act.metadata?.totalAmount).toBeUndefined();
        expect(act.metadata?.grandTotal).toBeUndefined();
      }

      // Operational metadata remains intact
      const stageAct = detail.timeline.find((a: any) => a.action === 'STAGE_UPDATED');
      if (stageAct) {
        expect(stageAct.metadata.nextStage).toBe('PRINTING_CMYK');
        expect(stageAct.metadata.operatorNote).toBe('Plates verified and mounted on Heidelberg press');
      }
    });

    it('1.6: OWNER role on GET /api/orders/:id receives full order financials, item pricing, payments, and payment timeline', async () => {
      const res = await fetch(`${baseUrl}/api/orders/${orderId}`, {
        headers: {
          Authorization: `Bearer ${tokenOwner}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const detail = await res.json();

      expect(detail.totalAmount).toBe('35400.00');
      expect(detail.advanceReceived).toBe('10000.00');
      expect(detail.balanceDue).toBe('25400.00');
      expect(detail.items[0].unitPrice).toBe('30.00');
      expect(detail.items[0].lineTotal).toBe('35400.00');
      expect(detail.payments.length).toBeGreaterThan(0);
      expect(detail.payments[0].receiptNumber).toBe('RCP-2026-9001');

      // Payment activities are visible to OWNER with monetary amounts
      const paymentAct = detail.timeline.find((a: any) => a.action === 'PAYMENT_RECORDED');
      expect(paymentAct).toBeDefined();
      expect(paymentAct.metadata.amount).toBe(10000.0);
    });
  });

  describe('Section 2: Customer Endpoints Masking (GET /api/crm/customers and GET /api/crm/customers/:id)', () => {
    it('2.1: PRODUCTION role on GET /api/crm/customers receives null for openingBalance and totalReceivable', async () => {
      const res = await fetch(`${baseUrl}/api/crm/customers`, {
        headers: {
          Authorization: `Bearer ${tokenProduction}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      // PRODUCTION does not have customer:view, receives 403 Forbidden
      expect(res.status).toBe(403);
    });

    it('2.2: SALESPERSON role (lacks payment:view) on GET /api/crm/customers receives masked balances', async () => {
      const res = await fetch(`${baseUrl}/api/crm/customers`, {
        headers: {
          Authorization: `Bearer ${tokenSales}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const custs = await res.json();
      const targetCust = custs.find((c: any) => c.id === customerId);
      expect(targetCust).toBeDefined();
      expect(targetCust.openingBalance).toBeNull();
      expect(targetCust.totalReceivable).toBeNull();
      expect(targetCust.creditLimit).toBeNull();
      expect(targetCust.name).toBe('Karpagam Packaging Ltd');
      expect(targetCust.phone).toBe('+919840555555');
    });

    it('2.3: OWNER role on GET /api/crm/customers receives full ledger balances', async () => {
      const res = await fetch(`${baseUrl}/api/crm/customers`, {
        headers: {
          Authorization: `Bearer ${tokenOwner}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const custs = await res.json();
      const targetCust = custs.find((c: any) => c.id === customerId);
      expect(targetCust).toBeDefined();
      expect(targetCust.openingBalance).toBe('15000.00');
      expect(parseFloat(targetCust.totalReceivable)).toBeGreaterThan(0);
    });

    it('2.4: SALESPERSON role on GET /api/crm/customers/:id masks financialSummary, quote values, order balances & timeline', async () => {
      const res = await fetch(`${baseUrl}/api/crm/customers/${customerId}`, {
        headers: {
          Authorization: `Bearer ${tokenSales}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();

      // Customer ledger numbers masked
      expect(data.customer.openingBalance).toBeNull();
      expect(data.customer.creditLimit).toBeNull();

      // Financial summary bar is completely null
      expect(data.financialSummary).toBeNull();

      // Embedded orders have masked financials
      expect(data.orders[0].totalAmount).toBeNull();
      expect(data.orders[0].advanceReceived).toBeNull();
      expect(data.orders[0].balanceDue).toBeNull();

      // Embedded quotations have masked monetary totals
      expect(data.quotations[0].subTotal).toBeNull();
      expect(data.quotations[0].taxTotal).toBeNull();
      expect(data.quotations[0].discountTotal).toBeNull();
      expect(data.quotations[0].grandTotal).toBeNull();

      // Payments list is empty
      expect(data.payments).toEqual([]);

      // Timeline has no payment activities
      const payEvents = data.timeline.filter(
        (a: any) => a.action === 'PAYMENT_RECORDED' || a.action === 'ADVANCE_RECORDED'
      );
      expect(payEvents).toHaveLength(0);
    });

    it('2.5: OWNER role on GET /api/crm/customers/:id receives full financialSummary and transactions', async () => {
      const res = await fetch(`${baseUrl}/api/crm/customers/${customerId}`, {
        headers: {
          Authorization: `Bearer ${tokenOwner}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.customer.openingBalance).toBe('15000.00');
      expect(data.financialSummary).toBeDefined();
      expect(data.financialSummary.lifetimeOrderValue).toBe('35400.00');
      expect(data.financialSummary.creditLimit).toBe('250000.00');

      expect(data.orders[0].totalAmount).toBe('35400.00');
      expect(data.quotations[0].grandTotal).toBe('35400.00');
      expect(data.payments.length).toBeGreaterThan(0);
    });
  });

  describe('Section 3: Quotation Endpoints Masking (GET /api/sales/quotations and GET /api/sales/quotations/:id)', () => {
    it('3.1: SALESPERSON role (lacks payment:view) on GET /api/sales/quotations receives masked grandTotal and subTotal', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations`, {
        headers: {
          Authorization: `Bearer ${tokenSales}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.length).toBeGreaterThan(0);

      const quote = json.data.find((q: any) => q.id === quoteId);
      expect(quote).toBeDefined();
      expect(quote.subTotal).toBeNull();
      expect(quote.taxTotal).toBeNull();
      expect(quote.discountTotal).toBeNull();
      expect(quote.grandTotal).toBeNull();
    });

    it('3.2: SALESPERSON role on GET /api/sales/quotations/:id receives masked totals & item prices, but retains physical specs', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations/${quoteId}`, {
        headers: {
          Authorization: `Bearer ${tokenSales}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const json = await res.json();

      // Masked monetary values
      expect(json.quote.subTotal).toBeNull();
      expect(json.quote.taxTotal).toBeNull();
      expect(json.quote.discountTotal).toBeNull();
      expect(json.quote.grandTotal).toBeNull();
      expect(json.items[0].unitPrice).toBeNull();
      expect(json.items[0].lineTotal).toBeNull();

      // Preserved specifications
      expect(json.quote.customData.job_type).toBe('PACKAGING_BOX');
      expect(json.quote.customData.plate_size).toBe('28x40 inch CTP');
      expect(json.items[0].quantity).toBe(1000);
      expect(json.items[0].unit).toBe('Nos');
    });

    it('3.3: OWNER role on GET /api/sales/quotations/:id receives full monetary calculations', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations/${quoteId}`, {
        headers: {
          Authorization: `Bearer ${tokenOwner}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.quote.subTotal).toBe('30000.00');
      expect(json.quote.taxTotal).toBe('5400.00');
      expect(json.quote.grandTotal).toBe('35400.00');
      expect(json.items[0].unitPrice).toBe('30.00');
      expect(json.items[0].lineTotal).toBe('35400.00');
    });
  });

  describe('Section 4: Dashboard & Activity Feed Role Masking', () => {
    it('4.1: PRODUCTION role on GET /api/crm/dashboard receives null for totalReceivables and openQuotationsValue', async () => {
      const res = await fetch(`${baseUrl}/api/crm/dashboard`, {
        headers: {
          Authorization: `Bearer ${tokenProduction}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.summaryCards.totalReceivables).toBeNull();
      expect(data.summaryCards.openQuotationsValue).toBeNull();

      // Operational counts remain visible
      expect(data.summaryCards.activeOrders).toBeGreaterThanOrEqual(1);
    });

    it('4.2: OWNER role on GET /api/crm/dashboard receives non-null monetary KPIs', async () => {
      const res = await fetch(`${baseUrl}/api/crm/dashboard`, {
        headers: {
          Authorization: `Bearer ${tokenOwner}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.summaryCards.totalReceivables).not.toBeNull();
      expect(parseFloat(data.summaryCards.totalReceivables)).toBeGreaterThan(0);
    });

    it('4.3: Unprivileged user without audit:read is blocked from GET /api/crm/activities', async () => {
      const res = await fetch(`${baseUrl}/api/crm/activities`, {
        headers: {
          Authorization: `Bearer ${tokenProduction}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(res.status).toBe(403);
    });
  });
});
