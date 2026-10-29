import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryProducts, globalMemoryOrderItems } from '../src/modules/crm/memory-store';

/**
 * An enquiry can be one line of words; a quote goes to a customer, so each line must be complete (name, unit, rate, GST)
 * and may point at the product it came from. A line without a product is allowed (odd jobs), but one that points at a
 * product from another business, or one that does not exist, is not.
 */
describe('Quote lines: complete fields and the product link', () => {
  let app: INestApplication;
  let baseUrl: string;

  const T = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
  const OTHER = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
  const OWNER = '11111111-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
  const STRANGER = '22222222-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
  const PRODUCT = randomUUID();
  const FOREIGN_PRODUCT = randomUUID();
  let owner: string;

  const call = (path: string, body?: unknown, init: { method?: string; token?: string; tenant?: string } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? (body ? 'POST' : 'GET'),
      headers: { authorization: `Bearer ${init.token ?? owner}`, 'x-tenant-id': init.tenant ?? T, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  const line = (extra: Record<string, unknown> = {}) => ({ itemName: 'Wall Calendar', quantity: 100, unit: 'Nos', unitPrice: 85, taxPercent: 12, hsnCode: '4910', ...extra });
  const quote = (items: unknown[]) => call('/sales/quotations', { customerId: 'ql-c1', items });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const auth = fixture.get(AuthService);
    for (const id of [T, OTHER]) {
      globalMemoryTenants.set(id, { id, name: 'Lines Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999977777', isActive: true } as any);
    }
    auth.registerUser({ id: OWNER, fullName: 'L Owner', phone: '+919840984001' });
    auth.registerUser({ id: STRANGER, fullName: 'L Stranger', phone: '+919840984002' });
    auth.registerMembership(T, OWNER, 'OWNER', true);
    auth.registerMembership(OTHER, STRANGER, 'OWNER', true);
    await auth.requestOtp({ phone: '+919840984001', countryCode: '+91' });
    owner = (await auth.verifyOtp({ phone: '+919840984001', code: DevSmsGateway.getLatestOtp(auth.normalizePhone('+919840984001'))!, tenantId: T })).token;

    globalMemoryCustomers.push({ id: 'ql-c1', tenantId: T, name: 'Quote Lines Customer', phone: '+919840961001', gstin: null, openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date() } as any);
    globalMemoryProducts.push(
      { id: PRODUCT, tenantId: T, name: 'Wall Calendar', code: 'CAL-W', unit: 'Nos', unitPrice: '85.00', taxPercent: '12.00', hsnCode: '4910', isActive: true } as any,
      { id: FOREIGN_PRODUCT, tenantId: OTHER, name: 'Other Business Item', code: null, unit: 'Nos', unitPrice: '10.00', taxPercent: '18.00', isActive: true } as any
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a complete line, linked to a product or free text', async () => {
    const linked = await quote([line({ productId: PRODUCT })]);
    expect(linked.status).toBe(201);
    expect((await linked.json()).items[0]).toMatchObject({ productId: PRODUCT, itemName: 'Wall Calendar', unit: 'Nos' });

    const free = await quote([line({ itemName: 'Odd job: foil sticker', productId: undefined })]);
    expect(free.status).toBe(201);
    expect((await free.json()).items[0].productId).toBeNull();
  });

  it('refuses incomplete lines and lists every problem at once, by line', async () => {
    const res = await quote([
      { itemName: 'Flex Banner', quantity: 2, unitPrice: 0 }, // no unit, no rate, no GST
      { itemName: '', quantity: 1, unit: 'Nos', unitPrice: 50, taxPercent: 18 }, // no name
      line(), // fine
    ]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('IncompleteQuoteLines');
    expect(body.errors).toEqual([
      'Line 1 (Flex Banner): unit is missing',
      'Line 1 (Flex Banner): rate is missing (it must be more than 0)',
      'Line 1 (Flex Banner): GST % is missing',
      'Line 2: item name is missing',
    ]);
  });

  it('still allows an explicit 0% GST (exempt goods) but not a missing one', async () => {
    expect((await quote([line({ taxPercent: 0 })])).status).toBe(201);
    expect((await quote([line({ taxPercent: undefined })])).status).toBe(400);
  });

  it('refuses a line that points at another business\'s product, or one that does not exist', async () => {
    for (const productId of [FOREIGN_PRODUCT, randomUUID()]) {
      const res = await quote([line({ productId })]);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('UnknownProduct');
    }
  });

  it('keeps the link through a revision and onto the order', async () => {
    const v1 = await (await quote([line({ productId: PRODUCT })])).json();
    const v2res = await call(`/sales/quotations/${v1.id}/revise`, { items: [line({ productId: PRODUCT, quantity: 80 })] });
    expect(v2res.status).toBe(201);
    const v2 = await v2res.json();
    expect(v2.items[0]).toMatchObject({ productId: PRODUCT, quantity: '80.00' });

    const conv = await call(`/sales/quotations/${v2.id}/convert`, { advanceReceived: 0 });
    expect(conv.status).toBe(201);
    const order = await conv.json();
    const orderId = order.id ?? order.orderId ?? order.order?.id;
    expect(globalMemoryOrderItems.some((i: any) => i.orderId === orderId && i.productId === PRODUCT)).toBe(true);
  });
});
