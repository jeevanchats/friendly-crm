import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryCustomers } from '../src/modules/crm/memory-store';

describe('Friendly CRM — Phase 4: Financial and Workflow Correctness Suite', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authService: AuthService;

  // Dedicated Test Tenants for Financial & Workflow tests
  const TENANT_FIN_PRINTING = '77777777-7777-4777-8777-777777777777';
  const TENANT_FIN_TEXTILES = '88888888-8888-4888-8888-888888888888';

  // Test Users
  const USER_FIN_OWNER = '11111111-aaaa-4aaa-8aaa-777777777777';
  const USER_FIN_ACCOUNTS = '22222222-aaaa-4aaa-8aaa-777777777777';
  const USER_TEX_OWNER = '33333333-aaaa-4aaa-8aaa-888888888888';

  // Tokens
  let tokenOwner: string;
  let tokenAccounts: string;
  let tokenTexOwner: string;

  // Shared IDs for cross-step tests
  let customerIdPrinting: string;
  let customerIdTextiles: string;

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

    // Seed tenants in memory store
    globalMemoryTenants.set(TENANT_FIN_PRINTING, {
      id: TENANT_FIN_PRINTING,
      name: 'Precision Print Works',
      industryKey: 'printing',
      defaultLanguage: 'en',
      phone: '+919876543210',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    globalMemoryTenants.set(TENANT_FIN_TEXTILES, {
      id: TENANT_FIN_TEXTILES,
      name: 'Coimbatore Silk Weavers',
      industryKey: 'textiles',
      defaultLanguage: 'ta',
      phone: '+919876543211',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    // Register Users
    authService.registerUser({ id: USER_FIN_OWNER, fullName: 'Fin Owner', phone: '+919977777777' });
    authService.registerUser({ id: USER_FIN_ACCOUNTS, fullName: 'Fin Accounts', phone: '+919977777778' });
    authService.registerUser({ id: USER_TEX_OWNER, fullName: 'Tex Owner', phone: '+919988888888' });

    // Register Memberships
    authService.registerMembership(TENANT_FIN_PRINTING, USER_FIN_OWNER, 'OWNER', true);
    authService.registerMembership(TENANT_FIN_PRINTING, USER_FIN_ACCOUNTS, 'ACCOUNTS', true);
    authService.registerMembership(TENANT_FIN_TEXTILES, USER_TEX_OWNER, 'OWNER', true);

    const getSession = async (phone: string, tenantId: string) => {
      await authService.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(authService.normalizePhone(phone))!;
      const session = await authService.verifyOtp({ phone, code, tenantId });
      return session.token;
    };

    tokenOwner = await getSession('+919977777777', TENANT_FIN_PRINTING);
    tokenAccounts = await getSession('+919977777778', TENANT_FIN_PRINTING);
    tokenTexOwner = await getSession('+919988888888', TENANT_FIN_TEXTILES);

    // Seed a customer for TENANT_FIN_PRINTING
    customerIdPrinting = 'cust-fin-print-1';
    globalMemoryCustomers.push({
      id: customerIdPrinting,
      tenantId: TENANT_FIN_PRINTING,
      name: 'Saravana Sweets & Snacks',
      companyName: 'Saravana Sweets Pvt Ltd',
      phone: '+919840112233',
      creditLimit: '500000.00',
      openingBalance: '0.00',
      activeOrdersCount: 0,
      totalReceivable: '0.00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Seed a customer for TENANT_FIN_TEXTILES
    customerIdTextiles = 'cust-fin-tex-1';
    globalMemoryCustomers.push({
      id: customerIdTextiles,
      tenantId: TENANT_FIN_TEXTILES,
      name: 'Nalli Silks Showroom',
      companyName: 'Nalli Silks Chennai',
      phone: '+919840998877',
      creditLimit: '1000000.00',
      openingBalance: '0.00',
      activeOrdersCount: 0,
      totalReceivable: '0.00',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Quantity and Monetary Invariants in Quotations', () => {
    it('rejects line items with quantity <= 0 and does not silently convert zero to 1', async () => {
      // Test quantity: 0
      const resZero = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [
            {
              itemName: 'Foil Stamped Cartons',
              quantity: 0,
              unitPrice: 15.0,
            },
          ],
        }),
      });

      expect(resZero.status).toBe(400);
      const dataZero = await resZero.json();
      expect(dataZero.message).toMatch(/quantity/i);

      // Test negative quantity: -5
      const resNeg = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [
            {
              itemName: 'Foil Stamped Cartons',
              quantity: -5,
              unitPrice: 15.0,
            },
          ],
        }),
      });

      expect(resNeg.status).toBe(400);
    });

    it('rejects line items with negative unit price', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [
            {
              itemName: 'Offset Catalogues',
              quantity: 100,
              unitPrice: -50.0,
            },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toMatch(/unit price/i);
    });

    it('rejects negative discount amounts', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          discountAmount: -200,
          items: [
            {
              itemName: 'Rigid Gift Boxes',
              quantity: 50,
              unitPrice: 100.0,
            },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toMatch(/discount/i);
    });

    it('rejects discount amounts exceeding total quotation value', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          discountAmount: 10000, // Total is 10 * 100 * 1.18 = 1180
          items: [
            {
              itemName: 'Sweet Boxes',
              quantity: 10,
              unitPrice: 100.0,
              taxPercent: 18,
            },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toMatch(/discount/i);
    });

    it('rejects quotation without any items', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [],
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('2. Advance Bounds & Conversion Invariants', () => {
    let quoteToConvert: any;

    beforeAll(async () => {
      // Create a valid quotation with total = 100 * 50 * 1.18 = 5900
      const quoteRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [
            {
              itemName: 'Die-cut Corrugated Boxes',
              quantity: 100,
              unitPrice: 50.0,
              taxPercent: 18,
            },
          ],
        }),
      });

      expect(quoteRes.status).toBe(201);
      quoteToConvert = await quoteRes.json();
      expect(parseFloat(quoteToConvert.grandTotal)).toBe(5900.0);
    });

    it('rejects conversion when advanceReceived is negative', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations/${quoteToConvert.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          advanceReceived: -1000.0,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toMatch(/advance/i);
    });

    it('rejects conversion when advance exceeds total quotation amount', async () => {
      const res = await fetch(`${baseUrl}/api/sales/quotations/${quoteToConvert.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          advanceReceived: 10000.0, // Quote grandTotal is 5900
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toMatch(/advance/i);
    });

    it('rejects converting a superseded/rejected quotation revision', async () => {
      // 1. Create a revision of quoteToConvert, marking quoteToConvert as REJECTED
      const revRes = await fetch(`${baseUrl}/api/sales/quotations/${quoteToConvert.id}/revise`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          items: [
            {
              itemName: 'Die-cut Corrugated Boxes v2',
              quantity: 120,
              unitPrice: 48.0,
              taxPercent: 18,
            },
          ],
        }),
      });

      expect(revRes.status).toBe(201);
      const revisedQuote = await revRes.json();
      expect(revisedQuote.version).toBe(2);

      // 2. Attempt to convert the superseded v1 quote (status: REJECTED)
      const convSuperseded = await fetch(`${baseUrl}/api/sales/quotations/${quoteToConvert.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          advanceReceived: 1000.0,
        }),
      });

      expect(convSuperseded.status).toBe(400);
      const errData = await convSuperseded.json();
      expect(errData.message).toMatch(/rejected/i);
    });
  });

  describe('3. Sequential Document Numbering', () => {
    it('generates sequential quotation, order, and receipt numbers following ERP standards (not timestamp slices)', async () => {
      const currentYear = new Date().getFullYear();

      // Create Quote 1 for Printing
      const q1Res = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [{ itemName: 'Item 1', quantity: 10, unitPrice: 100 }],
        }),
      });
      const q1 = await q1Res.json();

      // Create Quote 2 for Printing
      const q2Res = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [{ itemName: 'Item 2', quantity: 20, unitPrice: 100 }],
        }),
      });
      const q2 = await q2Res.json();

      // Verify Quote numbering format: QT-YYYY-XXXX
      expect(q1.quoteNumber).toMatch(new RegExp(`^QT-${currentYear}-\\d{4}$`));
      expect(q2.quoteNumber).toMatch(new RegExp(`^QT-${currentYear}-\\d{4}$`));

      const seq1 = parseInt(q1.quoteNumber.split('-')[2], 10);
      const seq2 = parseInt(q2.quoteNumber.split('-')[2], 10);
      expect(seq2).toBe(seq1 + 1);

      // Convert Quote 1 to Order with advance
      const conv1Res = await fetch(`${baseUrl}/api/sales/quotations/${q1.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          advanceReceived: 500.0,
        }),
      });
      const ord1 = await conv1Res.json();

      // Convert Quote 2 to Order with advance
      const conv2Res = await fetch(`${baseUrl}/api/sales/quotations/${q2.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          advanceReceived: 1000.0,
        }),
      });
      const ord2 = await conv2Res.json();

      // Verify Order numbering format: ORD-YYYY-XXXX
      expect(ord1.orderNumber).toMatch(new RegExp(`^ORD-${currentYear}-\\d{4}$`));
      expect(ord2.orderNumber).toMatch(new RegExp(`^ORD-${currentYear}-\\d{4}$`));

      const ordSeq1 = parseInt(ord1.orderNumber.split('-')[2], 10);
      const ordSeq2 = parseInt(ord2.orderNumber.split('-')[2], 10);
      expect(ordSeq2).toBe(ordSeq1 + 1);
    });

    it('isolates document numbering series between different tenants', async () => {
      const currentYear = new Date().getFullYear();

      // Create a quote in Textiles tenant
      const texQuoteRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenTexOwner}`,
          'X-Tenant-Id': TENANT_FIN_TEXTILES,
        },
        body: JSON.stringify({
          customerId: customerIdTextiles,
          items: [{ itemName: 'Pure Kanchipuram Silk Saree', quantity: 5, unitPrice: 12000 }],
        }),
      });

      expect(texQuoteRes.status).toBe(201);
      const texQuote = await texQuoteRes.json();
      expect(texQuote.quoteNumber).toMatch(new RegExp(`^QT-${currentYear}-\\d{4}$`));
      // First quote in Textiles tenant should be 0001
      expect(texQuote.quoteNumber).toBe(`QT-${currentYear}-0001`);
    });
  });

  describe('4. Concurrency and Idempotency Protection', () => {
    let idempotencyQuote: any;

    beforeAll(async () => {
      const qRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [{ itemName: 'Brochures', quantity: 500, unitPrice: 20 }],
        }),
      });
      idempotencyQuote = await qRes.json();
    });

    it('re-submitting quotation conversion with Idempotency-Key returns identical response without duplicate orders', async () => {
      const idempotencyKey = `idem-conv-${Date.now()}`;

      // 1. First conversion request
      const res1 = await fetch(`${baseUrl}/api/sales/quotations/${idempotencyQuote.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          advanceReceived: 2000.0,
        }),
      });

      expect(res1.status).toBe(201);
      const data1 = await res1.json();
      expect(data1.success).toBe(true);
      expect(data1.orderId).toBeDefined();

      // 2. Second conversion request with identical Idempotency-Key
      const res2 = await fetch(`${baseUrl}/api/sales/quotations/${idempotencyQuote.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          advanceReceived: 2000.0,
        }),
      });

      expect(res2.status).toBe(201);
      const data2 = await res2.json();
      expect(data2.orderId).toBe(data1.orderId);
      expect(data2.orderNumber).toBe(data1.orderNumber);
      expect(data2.isIdempotent).toBe(true);

      // 3. Third request WITHOUT Idempotency-Key should be rejected because quote is already converted
      const res3 = await fetch(`${baseUrl}/api/sales/quotations/${idempotencyQuote.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          advanceReceived: 2000.0,
        }),
      });

      expect(res3.status).toBe(400);
      const data3 = await res3.json();
      expect(data3.message).toMatch(/already converted/i);
    });

    it('re-submitting payment with Idempotency-Key returns cached receipt without double-charging or double-deducting balance', async () => {
      // 1. Create an order with total 10000, 0 advance, balance 10000
      const quoteRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [{ itemName: 'Luxury Packaging Boxes', quantity: 100, unitPrice: 100, taxPercent: 0 }],
        }),
      });
      const quote = await quoteRes.json();

      const convRes = await fetch(`${baseUrl}/api/sales/quotations/${quote.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({ advanceReceived: 0 }),
      });
      const order = await convRes.json();
      expect(parseFloat(order.balanceDue)).toBe(10000.0);

      // 2. Record payment of 3000 with Idempotency-Key
      const payIdemKey = `idem-pay-${Date.now()}`;
      const payRes1 = await fetch(`${baseUrl}/api/orders/${order.orderId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAccounts}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
          'Idempotency-Key': payIdemKey,
        },
        body: JSON.stringify({
          amount: 3000.0,
          mode: 'UPI',
          referenceNo: `UTR-${Date.now()}`,
          notes: 'First installment via GPay',
        }),
      });

      expect(payRes1.status).toBe(201);
      const payData1 = await payRes1.json();
      expect(parseFloat(payData1.order.balanceDue)).toBe(7000.0);
      expect(parseFloat(payData1.payment.amount)).toBe(3000.0);

      // 3. Retry identical payment with same Idempotency-Key
      const payRes2 = await fetch(`${baseUrl}/api/orders/${order.orderId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAccounts}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
          'Idempotency-Key': payIdemKey,
        },
        body: JSON.stringify({
          amount: 3000.0,
          mode: 'UPI',
        }),
      });

      expect(payRes2.status).toBe(201);
      const payData2 = await payRes2.json();
      expect(payData2.isIdempotent).toBe(true);
      expect(payData2.payment.id).toBe(payData1.payment.id);
      // Balance must STILL be 7000, NOT double-deducted to 4000!
      expect(parseFloat(payData2.order.balanceDue)).toBe(7000.0);
    });

    it('rejects duplicate payment reference number for the same order', async () => {
      // 1. Create an order
      const qRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [{ itemName: 'Visiting Cards', quantity: 1000, unitPrice: 2, taxPercent: 0 }],
        }),
      });
      const quote = await qRes.json();

      const convRes = await fetch(`${baseUrl}/api/sales/quotations/${quote.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({ advanceReceived: 0 }),
      });
      const order = await convRes.json();

      const sharedRefNo = `NEFT-REF-${Date.now()}`;

      // 2. Record first payment with sharedRefNo
      const pay1 = await fetch(`${baseUrl}/api/orders/${order.orderId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAccounts}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          amount: 500.0,
          referenceNo: sharedRefNo,
        }),
      });
      expect(pay1.status).toBe(201);

      // 3. Record second payment with identical referenceNo without idempotency key
      const pay2 = await fetch(`${baseUrl}/api/orders/${order.orderId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAccounts}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          amount: 500.0,
          referenceNo: sharedRefNo,
        }),
      });
      expect(pay2.status).toBe(400);
      const err = await pay2.json();
      expect(err.message).toMatch(/reference number/i);
    });

    it('rejects payment amount exceeding outstanding balance', async () => {
      // Create order with balance 1000
      const qRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [{ itemName: 'Envelopes', quantity: 500, unitPrice: 2, taxPercent: 0 }],
        }),
      });
      const quote = await qRes.json();
      const convRes = await fetch(`${baseUrl}/api/sales/quotations/${quote.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({ advanceReceived: 0 }),
      });
      const order = await convRes.json();

      // Attempt to pay 2000 on balance of 1000
      const payRes = await fetch(`${baseUrl}/api/orders/${order.orderId}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenAccounts}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          amount: 2000.0,
        }),
      });

      expect(payRes.status).toBe(400);
      const data = await payRes.json();
      expect(data.message).toMatch(/exceeds outstanding balance/i);
    });
  });

  describe('5. Industry Template Order Stage Transitions', () => {
    let orderId: string;

    beforeAll(async () => {
      const qRes = await fetch(`${baseUrl}/api/sales/quotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          customerId: customerIdPrinting,
          items: [{ itemName: 'Invitation Cards', quantity: 200, unitPrice: 10 }],
        }),
      });
      const quote = await qRes.json();
      const convRes = await fetch(`${baseUrl}/api/sales/quotations/${quote.id}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({ advanceReceived: 0 }),
      });
      const order = await convRes.json();
      orderId = order.orderId;
    });

    it('rejects arbitrary production stage strings not in the active industry template', async () => {
      const res = await fetch(`${baseUrl}/api/orders/${orderId}/stage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          nextStageId: 'INVALID_STAGE_ARBITRARY_NAME',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toMatch(/invalid production stage/i);
    });

    it('accepts valid production stage defined in the industry template (e.g. PLATE_CTP)', async () => {
      const res = await fetch(`${baseUrl}/api/orders/${orderId}/stage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
        },
        body: JSON.stringify({
          nextStageId: 'PLATE_CTP',
          customDataUpdates: {
            plate_size: '650x550mm',
            artwork_approved: true,
          },
        }),
      });

      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.productionStage).toBe('PLATE_CTP');
      expect(updated.customData.plate_size).toBe('650x550mm');
      expect(updated.customData.artwork_approved).toBe(true);
    });
  });

  describe('6. Lead Intake followUpDueAt Handling', () => {
    it('schedules follow-up task at explicit followUpDueAt timestamp when provided', async () => {
      const targetDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days in future
      const targetIso = targetDate.toISOString();

      const res = await fetch(`${baseUrl}/api/crm/intake-lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
          'X-Industry-Key': 'printing',
        },
        body: JSON.stringify({
          customerName: 'Anand Sweet Stall',
          phone: '+919840556677',
          source: 'WALK_IN',
          title: 'Custom Sweet Box Inquiry',
          followUpDueAt: targetIso,
          customData: {
            job_type: 'PACKAGING_BOX',
          },
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.followUpTask).toBeDefined();

      const taskDue = new Date(data.followUpTask.dueAt).getTime();
      const expectedDue = targetDate.getTime();
      // Verify timestamp matches within 1 second tolerance
      expect(Math.abs(taskDue - expectedDue)).toBeLessThan(1000);
    });

    it('defaults follow-up task to +24 hours when followUpDueAt is omitted', async () => {
      const beforeCall = Date.now();
      const res = await fetch(`${baseUrl}/api/crm/intake-lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenOwner}`,
          'X-Tenant-Id': TENANT_FIN_PRINTING,
          'X-Industry-Key': 'printing',
        },
        body: JSON.stringify({
          customerName: 'Balaji Sweets',
          phone: '+919840556688',
          source: 'WHATSAPP',
          title: 'Brochure Inquiry',
          customData: {
            job_type: 'CATALOG_BROCHURE',
          },
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.followUpTask).toBeDefined();

      const taskDue = new Date(data.followUpTask.dueAt).getTime();
      const expectedDue = beforeCall + 24 * 60 * 60 * 1000;
      // Should be approximately +24 hours from now (within 5 seconds)
      expect(Math.abs(taskDue - expectedDue)).toBeLessThan(5000);
    });
  });
});
