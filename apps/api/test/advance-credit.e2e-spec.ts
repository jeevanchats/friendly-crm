import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryOrders, globalMemoryPayments } from '../src/modules/crm/memory-store';

/**
 * A customer who paid in advance before Friendly CRM comes in through the import as a negative opening balance ("Cr"), is
 * shown as credit owed to them, never as a due, and is used up against their next order. (advance-credit-db covers Postgres.)
 */
describe('Customers in credit: import, display and using the advance', () => {
  let app: INestApplication;
  let baseUrl: string;
  const T = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
  const OWNER = '11111111-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
  let owner: string;

  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${owner}`, 'x-tenant-id': T, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const importRows = async (rows: unknown[], extra: Record<string, unknown> = {}) =>
    (await call('POST', '/crm/customers/import', { dryRun: false, onDuplicate: 'skip', rows, ...extra })).json();
  const orderFor = (customerId: string, total: number, paid = 0) => {
    const o: any = { id: randomUUID(), tenantId: T, customerId, orderNumber: `ORD-D1-${Math.floor(Math.random() * 90000 + 10000)}`, productionStage: 'NEW', totalAmount: total.toFixed(2), advanceReceived: paid.toFixed(2), balanceDue: (total - paid).toFixed(2) };
    globalMemoryOrders.push(o);
    return o;
  };
  const customerNamed = (name: string) => globalMemoryCustomers.find((c) => c.tenantId === T && c.name === name) as any;
  const summaryOf = async (id: string) => (await (await call('GET', `/crm/customers/${id}`)).json()).financialSummary;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const auth = fixture.get(AuthService);
    globalMemoryTenants.set(T, { id: T, name: 'Advance Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999977777', isActive: true } as any);
    auth.registerMembership(T, OWNER, 'OWNER', true);
    auth.registerUser({ id: OWNER, fullName: 'Advance Owner', phone: '+919840986001' });
    await auth.requestOtp({ phone: '+919840986001', countryCode: '+91' });
    owner = (await auth.verifyOtp({ phone: '+919840986001', code: DevSmsGateway.getLatestOtp(auth.normalizePhone('+919840986001'))!, tenantId: T })).token;
  });
  afterAll(async () => {
    await app.close();
  });

  it('imports customers in credit (Cr, minus, brackets) and reports the credit apart from what is owed', async () => {
    const r = await importRows([
      { name: 'Advance Cr Traders', phone: '9840088001', openingBalance: '5000 Cr' },
      { name: 'Advance Minus Stores', phone: '9840088002', openingBalance: '-1200.50' },
      { name: 'Advance Owes Agency', phone: '9840088003', openingBalance: '800 Dr' },
    ]);
    expect(r).toMatchObject({ created: 3, errors: 0, openingBalanceTotal: '800.00', openingCreditTotal: '6200.50' });
    expect(r.rows[0].messages.join(' ')).toMatch(/In credit.*5,000\.00 in advance/);
    expect(customerNamed('Advance Cr Traders').openingBalance).toBe('-5000.00');
    expect(customerNamed('Advance Minus Stores').openingBalance).toBe('-1200.50');
    expect(customerNamed('Advance Owes Agency').openingBalance).toBe('800.00');
  });

  it('shows the advance as credit owed back, not as a due, and does not remind the customer for it', async () => {
    const c = customerNamed('Advance Cr Traders');
    const s = await summaryOf(c.id);
    expect(s).toMatchObject({ openingBalance: '-5000.00', creditHeld: '5000.00' });
    const dues = await (await call('GET', '/receivables')).json();
    expect(JSON.stringify(dues)).not.toContain('Advance Cr Traders');
  });

  it('uses the advance against an order: the order and the advance come down together, with a receipt', async () => {
    const c = customerNamed('Advance Cr Traders');
    const o = orderFor(c.id, 3000);
    expect(await (await call('GET', `/orders/${o.id}/advance`)).json()).toEqual({ credit: '5000.00', balanceDue: '3000.00', available: '3000.00' });

    const res = await call('POST', `/orders/${o.id}/apply-advance`, {});
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.payment).toMatchObject({ amount: '3000.00', mode: 'ADVANCE' });
    expect(out.payment.receiptNumber).toMatch(/^RCP-\d{4}-\d{4}$/);
    expect(o).toMatchObject({ advanceReceived: '3000.00', balanceDue: '0.00' });
    expect(c.openingBalance).toBe('-2000.00'); // 5000 - 3000 left to use
    expect(globalMemoryPayments.some((p) => p.orderId === o.id && p.mode === 'ADVANCE')).toBe(true);

    // nothing left to pay on that order
    const again = await call('POST', `/orders/${o.id}/apply-advance`, {});
    expect(again.status).toBe(400);
    expect((await again.json()).message).toMatch(/nothing left to pay/);
  });

  it('can apply part of the advance, never more than the advance or the order, and a retry pays once', async () => {
    const c = customerNamed('Advance Minus Stores'); // 1200.50 in credit
    const o = orderFor(c.id, 5000);
    const tooMuch = await call('POST', `/orders/${o.id}/apply-advance`, { amount: 1300 });
    expect(tooMuch.status).toBe(400);
    expect((await tooMuch.json()).available).toBe('1200.50');
    expect(o.advanceReceived).toBe('0.00');

    const first = await call('POST', `/orders/${o.id}/apply-advance`, { amount: 200.25 }, { 'idempotency-key': 'adv-1' });
    const retry = await call('POST', `/orders/${o.id}/apply-advance`, { amount: 200.25 }, { 'idempotency-key': 'adv-1' });
    expect(first.status).toBe(201);
    expect((await retry.json()).isIdempotent).toBe(true);
    expect(o).toMatchObject({ advanceReceived: '200.25', balanceDue: '4799.75' });
    expect(c.openingBalance).toBe('-1000.25');
  });

  it('refuses when the customer has no advance (they owe us, or nothing)', async () => {
    const owes = customerNamed('Advance Owes Agency');
    const o = orderFor(owes.id, 1000);
    const res = await call('POST', `/orders/${o.id}/apply-advance`, {});
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/no advance/);
    expect(owes.openingBalance).toBe('800.00'); // untouched
    expect(o.advanceReceived).toBe('0.00');
  });

  it('an existing customer keeps their balance on an update import, with a note', async () => {
    const r = await importRows([{ name: 'Advance Cr Traders', phone: '9840088001', openingBalance: '9999 Cr' }], { onDuplicate: 'update' });
    expect(r.rows[0].messages.join(' ')).toMatch(/Opening balance not changed/);
    expect(customerNamed('Advance Cr Traders').openingBalance).toBe('-2000.00');
  });
});
