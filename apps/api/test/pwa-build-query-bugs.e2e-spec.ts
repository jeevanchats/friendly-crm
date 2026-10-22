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
  globalMemoryPayments,
  globalMemoryActivities,
  globalMemoryTasks,
} from '../src/modules/crm/memory-store';
import { randomUUID } from 'crypto';

describe('Friendly CRM — Phase 7: PWA, Build and Query Bugs E2E Suite', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authService: AuthService;

  const TENANT_A = '77777777-7777-4777-8777-777777777777';
  const TENANT_B = '88888888-8888-4888-8888-888888888888';

  const USER_OWNER_A = '11111111-7777-4777-8777-777777777777';
  const USER_OWNER_B = '11111111-8888-4888-8888-888888888888';

  let tokenOwnerA: string;
  let tokenOwnerB: string;

  const customerA1 = 'cust-phase7-a1';
  const customerA2 = 'cust-phase7-a2';
  const leadA1 = 'lead-phase7-a1';
  const leadA2 = 'lead-phase7-a2';
  const leadA3 = 'lead-phase7-a3';
  const quoteA1 = 'quote-phase7-a1';

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

    // Register Tenants
    globalMemoryTenants.set(TENANT_A, {
      id: TENANT_A,
      name: 'Alpha Packaging Press',
      industryKey: 'printing',
      phone: '+919840112233',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    globalMemoryTenants.set(TENANT_B, {
      id: TENANT_B,
      name: 'Beta Furniture Works',
      industryKey: 'furniture',
      phone: '+919840223344',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // Register Users & Memberships
    authService.registerUser({ id: USER_OWNER_A, fullName: 'Owner Alpha', phone: '+919840112233' });
    authService.registerUser({ id: USER_OWNER_B, fullName: 'Owner Beta', phone: '+919840223344' });

    authService.registerMembership(TENANT_A, USER_OWNER_A, 'OWNER', true);
    authService.registerMembership(TENANT_B, USER_OWNER_B, 'OWNER', true);

    // Create Authenticated Sessions
    const loginUser = async (phone: string, tenantId: string): Promise<string> => {
      await authService.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const session = await authService.verifyOtp({ phone, code, tenantId });
      return session.token;
    };

    tokenOwnerA = await loginUser('+919840112233', TENANT_A);
    tokenOwnerB = await loginUser('+919840223344', TENANT_B);

    // Seed Customers
    globalMemoryCustomers.push(
      {
        id: customerA1,
        tenantId: TENANT_A,
        name: 'Ramesh Sundaram',
        phone: '+919840111111',
        companyName: 'Sundaram Garments',
        openingBalance: '1000.00',
        totalReceivable: '1000.00',
        creditLimit: '50000.00',
        activeOrdersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: customerA2,
        tenantId: TENANT_A,
        name: 'Ganesh Murthy',
        phone: '+919840222222',
        companyName: 'Murthy Traders',
        openingBalance: '0.00',
        totalReceivable: '0.00',
        creditLimit: '25000.00',
        activeOrdersCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    );

    // Seed Leads for Tenant A
    globalMemoryLeads.push(
      {
        id: leadA1,
        tenantId: TENANT_A,
        customerId: customerA1,
        title: 'Rigid Box Packaging 10000 pcs',
        source: 'WHATSAPP',
        stage: 'NEW',
        priority: 'HIGH',
        estimatedValue: '45000.00',
        notes: 'Needs gold foil stamping',
        createdAt: new Date(Date.now() - 3600000),
        updatedAt: new Date(),
      },
      {
        id: leadA2,
        tenantId: TENANT_A,
        customerId: customerA1,
        title: 'Sweet Box Packaging 5000 pcs',
        source: 'WALK_IN',
        stage: 'QUOTED',
        priority: 'MEDIUM',
        estimatedValue: '25000.00',
        notes: 'Requested sample proof',
        createdAt: new Date(Date.now() - 7200000),
        updatedAt: new Date(),
      },
      {
        id: leadA3,
        tenantId: TENANT_A,
        customerId: customerA2,
        title: 'Brochure Printing 2000 pcs',
        source: 'REFERRAL',
        stage: 'WON',
        priority: 'LOW',
        estimatedValue: '12000.00',
        notes: 'Standard art paper',
        createdAt: new Date(Date.now() - 10800000),
        updatedAt: new Date(),
      }
    );

    // Seed Activities (mix of Customer A1 and Customer A2 activities)
    globalMemoryActivities.push(
      {
        id: randomUUID(),
        tenantId: TENANT_A,
        entityType: 'CUSTOMER',
        entityId: customerA1,
        action: 'CUSTOMER_CREATED',
        metadata: { customerId: customerA1 },
        actorId: USER_OWNER_A,
        createdAt: new Date(Date.now() - 15000000),
      },
      {
        id: randomUUID(),
        tenantId: TENANT_A,
        entityType: 'LEAD',
        entityId: leadA1,
        action: 'LEAD_INTAKE_COMPLETED',
        metadata: { customerId: customerA1 },
        actorId: USER_OWNER_A,
        createdAt: new Date(Date.now() - 3600000),
      },
      {
        id: randomUUID(),
        tenantId: TENANT_A,
        entityType: 'CUSTOMER',
        entityId: customerA2,
        action: 'CUSTOMER_CREATED',
        metadata: { customerId: customerA2 },
        actorId: USER_OWNER_A,
        createdAt: new Date(Date.now() - 14000000),
      },
      {
        id: randomUUID(),
        tenantId: TENANT_A,
        entityType: 'LEAD',
        entityId: leadA3,
        action: 'LEAD_INTAKE_COMPLETED',
        metadata: { customerId: customerA2 },
        actorId: USER_OWNER_A,
        createdAt: new Date(Date.now() - 10800000),
      }
    );

    // Seed Quotation for Tenant A
    globalMemoryQuotations.push({
      id: quoteA1,
      tenantId: TENANT_A,
      customerId: customerA1,
      leadId: leadA2,
      quoteNumber: 'QT-2026-0001',
      version: 1,
      subTotal: '25000.00',
      taxTotal: '4500.00',
      discountTotal: '500.00',
      grandTotal: '29000.00',
      status: 'SENT',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    globalMemoryQuotationItems.push({
      id: randomUUID(),
      tenantId: TENANT_A,
      quotationId: quoteA1,
      itemName: 'Sweet Boxes 5000 pcs',
      description: '350 GSM Cyber Board',
      quantity: 5000,
      unitPrice: '5.00',
      taxPercent: '18.00',
      lineTotal: '29500.00',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('1. Real Lead Query Filters and True Pagination Count', () => {
    it('filters leads by stage correctly', async () => {
      const res = await fetch(`${baseUrl}/api/crm/leads?stage=QUOTED`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBe(1);
      expect(json.data[0].id).toBe(leadA2);
      expect(json.data[0].stage).toBe('QUOTED');
      expect(json.total).toBe(1);
    });

    it('filters leads by priority correctly', async () => {
      const res = await fetch(`${baseUrl}/api/crm/leads?priority=HIGH`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.length).toBe(1);
      expect(json.data[0].id).toBe(leadA1);
      expect(json.data[0].priority).toBe('HIGH');
      expect(json.total).toBe(1);
    });

    it('filters leads by search term matching title or notes or customer', async () => {
      const res = await fetch(`${baseUrl}/api/crm/leads?search=gold%20foil`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.length).toBe(1);
      expect(json.data[0].id).toBe(leadA1);
      expect(json.data[0].notes).toContain('gold foil');
    });

    it('returns true matching count for paginated queries when limit is smaller than total', async () => {
      // Query with limit=1, offset=0
      const res = await fetch(`${baseUrl}/api/crm/leads?limit=1&offset=0`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      // Returned page slice should have 1 item
      expect(json.data.length).toBe(1);
      // But total MUST be the true matching count (3 seeded leads in Tenant A), not 1!
      expect(json.total).toBe(3);
    });
  });

  describe('2. Customer360 Timeline Scoped Exclusively to That Customer', () => {
    it('scopes Customer 360 timeline activities to customerA1 and does NOT leak customerA2 activities', async () => {
      const res = await fetch(`${baseUrl}/api/crm/customers/${customerA1}`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.customer.id).toBe(customerA1);
      expect(Array.isArray(json.timeline)).toBe(true);

      // Verify that every single activity in timeline relates to customerA1 or customerA1's leads
      for (const act of json.timeline) {
        const isA1 =
          act.entityId === customerA1 ||
          act.metadata?.customerId === customerA1 ||
          act.entityId === leadA1 ||
          act.entityId === leadA2;
        expect(isA1).toBe(true);

        // Explicitly assert that customerA2 and leadA3 NEVER appear in customerA1 timeline
        expect(act.entityId).not.toBe(customerA2);
        expect(act.entityId).not.toBe(leadA3);
        expect(act.metadata?.customerId).not.toBe(customerA2);
      }
    });
  });

  describe('3. Server-Rendered PDF Generation Endpoint & Contract', () => {
    it('streams valid application/pdf with proper Content-Disposition header', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations/${quoteA1}/pdf`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      expect(res.headers.get('content-disposition')).toContain('inline; filename="Quotation-QT-2026-0001.pdf"');

      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      // PDF files always begin with magic bytes %PDF
      expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
    });

    it('returns 404 for unknown quotation ID and does NOT substitute demo data', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations/non-existent-quote-id/pdf`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(res.status).toBe(404);
    });

    it('returns 404 when requesting quotation from a different tenant', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations/${quoteA1}/pdf`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerB}`,
          'x-tenant-id': TENANT_B,
        },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('4. Reports Service Array Structure and RLS Integrity', () => {
    it('returns valid report summaries with array topDebtors and repeatOpportunities', async () => {
      const res = await fetch(`${baseUrl}/api/crm/reports`, {
        headers: {
          Authorization: `Bearer ${tokenOwnerA}`,
          'x-tenant-id': TENANT_A,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.funnel).toBeDefined();
      expect(json.financials).toBeDefined();
      expect(Array.isArray(json.topDebtors)).toBe(true);
      expect(Array.isArray(json.repeatOpportunities)).toBe(true);
    });
  });
});
