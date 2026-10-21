import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CrmService } from '../src/modules/crm/crm.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { CustomersService } from '../src/modules/crm/customers.service';

describe('Friendly CRM — P0 Tenant Isolation & RBAC Acceptance Suite', () => {
  let app: INestApplication;
  let crmService: CrmService;
  let ordersService: OrdersService;
  let customersService: CustomersService;

  // Two distinct tenant UUIDs (e.g., Printing Tenant vs Furniture Tenant)
  const TENANT_A_PRINTING = '11111111-1111-4111-8111-111111111111';
  const TENANT_B_FURNITURE = '22222222-2222-4222-8222-222222222222';
  const USER_OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const USER_PROD_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  let tenantACustomerId: string;
  let tenantAOrderId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [CrmService, OrdersService, CustomersService],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    crmService = moduleFixture.get<CrmService>(CrmService);
    ordersService = moduleFixture.get<OrdersService>(OrdersService);
    customersService = moduleFixture.get<CustomersService>(CustomersService);
  });

  it('1. Creates a customer and lead inside Tenant A (Printing)', async () => {
    const res = await crmService.intakeLead(TENANT_A_PRINTING, USER_OWNER_A, 'printing', {
      phone: '9876500001',
      customerName: 'Sivakasi Offset Buyers',
      title: '10,000 Sweet Boxes',
      source: 'WHATSAPP',
      customData: { job_type: 'PACKAGING_BOX' },
    });

    expect(res.customer.tenantId).toBe(TENANT_A_PRINTING);
    expect(res.customer.phone).toBe('+919876500001');
    tenantACustomerId = res.customer.id;
  });

  it('2. ZERO DEFECT RLS CHECK: Tenant B cannot read Tenant A customer by ID', async () => {
    await expect(
      customersService.getCustomer360(TENANT_B_FURNITURE, 'OWNER', tenantACustomerId)
    ).rejects.toThrow(NotFoundException);
  });

  it('3. ZERO DEFECT PHONE MATCH CHECK: Same phone number in Tenant B creates an isolated customer', async () => {
    const resB = await crmService.intakeLead(TENANT_B_FURNITURE, USER_OWNER_A, 'furniture', {
      phone: '9876500001', // Identical phone number to Tenant A's customer
      customerName: 'Sivakasi Offset Buyers (Furniture Account)',
      title: 'Office Teak Table',
      source: 'WALK_IN',
      customData: { material_type: 'TEAK_WOOD' },
    });

    expect(resB.isNewCustomer).toBe(true);
    expect(resB.customer.id).not.toBe(tenantACustomerId);
    expect(resB.customer.tenantId).toBe(TENANT_B_FURNITURE);
  });

  it('4. RBAC CHECK: PRODUCTION role is blocked from recording payments', async () => {
    await expect(
      ordersService.recordOrderPayment(TENANT_A_PRINTING, USER_PROD_A, 'PRODUCTION', {
        orderId: tenantAOrderId || '00000000-0000-4000-8000-000000000000',
        amount: 5000,
        mode: 'UPI',
      })
    ).rejects.toThrow(ForbiddenException);
  });

  afterAll(async () => {
    await app.close();
  });
});