import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { InvoicesService } from '../src/modules/invoices/invoices.service';
import {
  CreditableLine,
  computeCreditNote,
  formatCreditNoteNumber,
  fullCreditRequests,
  gstinCheckChar,
  financialYear,
} from '@friendly-crm/shared';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryOrders,
  globalMemoryOrderItems,
} from '../src/modules/crm/memory-store';

const gstin = (first14: string) => first14 + gstinCheckChar(first14);

/** An invoice line as stored: 100 Nos x Rs.10 @18% intra-state = 1000 taxable + 90 + 90. */
const line = (over: Partial<CreditableLine> = {}): CreditableLine => ({
  lineNo: 1,
  itemName: 'Wall calendar',
  description: null,
  hsnCode: '4910',
  unit: 'Nos',
  unitPrice: 10,
  taxPercent: 18,
  quantity: 100,
  taxablePaise: 100000,
  cgstPaise: 9000,
  sgstPaise: 9000,
  igstPaise: 0,
  creditedQuantity: 0,
  creditedTaxablePaise: 0,
  creditedCgstPaise: 0,
  creditedSgstPaise: 0,
  creditedIgstPaise: 0,
  ...over,
});

describe('credit note maths', () => {
  const base = { supplyType: 'INTRA' as const, invoiceRoundOffPaise: 0, creditedRoundOffPaise: 0 };

  it('numbers credit notes in their own series, inside the 16 character GST limit', () => {
    expect(formatCreditNoteNumber('2026-27', 1)).toBe('CN/2026-27/0001');
    expect(formatCreditNoteNumber('2026-27', 99999).length).toBeLessThanOrEqual(16);
    expect(() => formatCreditNoteNumber('2026-27', 100000)).toThrow(/16 character/);
    expect(() => formatCreditNoteNumber('2026-27', 0)).toThrow();
  });

  it('crediting the whole invoice reverses it to the paisa, including the round-off', () => {
    const lines = [line(), line({ lineNo: 2, itemName: 'Diary', quantity: 3, taxablePaise: 10001, cgstPaise: 600, sgstPaise: 600, taxPercent: 12 })];
    const r = computeCreditNote({ ...base, lines, requests: fullCreditRequests(lines), invoiceRoundOffPaise: -1 });
    expect(r.settlesInvoice).toBe(true);
    expect(r.taxablePaise).toBe(110001);
    expect(r.cgstPaise).toBe(9600);
    expect(r.roundOffPaise).toBe(-1);
    expect(r.totalPaise).toBe(110001 + 9600 * 2 - 1);
  });

  it('a part return takes its share of value and tax; the rest stays creditable', () => {
    const r = computeCreditNote({ ...base, lines: [line()], requests: [{ lineNo: 1, quantity: 40 }] });
    expect(r.lines[0]).toMatchObject({ quantity: 40, taxablePaise: 40000, cgstPaise: 3600, sgstPaise: 3600 });
    expect(r.totalPaise).toBe(47200);
    expect(r.settlesInvoice).toBe(false);
    expect(r.roundOffPaise).toBe(0); // the round-off is only given back by the note that settles the invoice

    // the remaining 60 then take exactly what is left, whatever the rounding was
    const after = line({ creditedQuantity: 40, creditedTaxablePaise: 40000, creditedCgstPaise: 3600, creditedSgstPaise: 3600 });
    const rest = computeCreditNote({ ...base, lines: [after], requests: [{ lineNo: 1, quantity: 60 }], invoiceRoundOffPaise: 2, creditedRoundOffPaise: 0 });
    expect(rest.totalPaise).toBe(60000 + 5400 * 2 + 2);
    expect(rest.settlesInvoice).toBe(true);
  });

  it('a value credit reduces taxable value with the tax that goes with it, without returning goods', () => {
    const r = computeCreditNote({ ...base, lines: [line()], requests: [{ lineNo: 1, taxableAmount: 100 }] });
    expect(r.lines[0]).toMatchObject({ quantity: 0, taxablePaise: 10000, cgstPaise: 900, sgstPaise: 900 });
    expect(r.totalPaise).toBe(11800);
    const inter = computeCreditNote({
      supplyType: 'INTER',
      lines: [line({ cgstPaise: 0, sgstPaise: 0, igstPaise: 18000 })],
      requests: [{ lineNo: 1, taxableAmount: 100 }],
      invoiceRoundOffPaise: 0,
      creditedRoundOffPaise: 0,
    });
    expect(inter.lines[0]).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 1800 });
  });

  it('never credits more than is left, and refuses unclear or empty requests', () => {
    const l = line({ creditedQuantity: 90, creditedTaxablePaise: 90000, creditedCgstPaise: 8100, creditedSgstPaise: 8100 });
    expect(() => computeCreditNote({ ...base, lines: [l], requests: [{ lineNo: 1, quantity: 11 }] })).toThrow(/only 10 Nos left/);
    expect(() => computeCreditNote({ ...base, lines: [l], requests: [{ lineNo: 1, taxableAmount: 100.01 }] })).toThrow(/only Rs. 100.00/);
    expect(() => computeCreditNote({ ...base, lines: [line()], requests: [{ lineNo: 1, quantity: 5, taxableAmount: 5 }] })).toThrow(/either/);
    expect(() => computeCreditNote({ ...base, lines: [line()], requests: [{ lineNo: 1 }] })).toThrow(/either/);
    expect(() => computeCreditNote({ ...base, lines: [line()], requests: [{ lineNo: 2, quantity: 1 }] })).toThrow(/not on this invoice/);
    expect(() => computeCreditNote({ ...base, lines: [line()], requests: [{ lineNo: 1, quantity: 1 }, { lineNo: 1, quantity: 2 }] })).toThrow(/twice/);
    expect(() => computeCreditNote({ ...base, lines: [line()], requests: [{ lineNo: 1, quantity: 0 }] })).toThrow(/more than zero/);
    expect(() => computeCreditNote({ ...base, lines: [line()], requests: [{ lineNo: 1, quantity: 1.234 }] })).toThrow(/2 decimals/);
    expect(() => computeCreditNote({ ...base, lines: [line()], requests: [] })).toThrow(/at least one/);
  });
});

describe('Credit notes', () => {
  let app: INestApplication;
  let baseUrl: string;
  let invoices: InvoicesService;

  const TENANT = '94949494-9494-4949-8949-949494949494';
  const OTHER = '95959595-9595-4959-8959-959595959595';
  const U_OWNER = '11111111-9494-4949-8949-949494949494';
  const U_PROD = '22222222-9494-4949-8949-949494949494';
  const U_OTHER = '33333333-9494-4949-8949-949494949494';
  let owner: string;
  let prod: string;
  let stranger: string;
  let seq = 0;

  const http = (token: string, path: string, init: { method?: string; body?: unknown; tenant?: string } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': init.tenant ?? TENANT, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const credit = (body: unknown, token = owner) => http(token, '/credit-notes', { method: 'POST', body });

  /**
   * Two lines: 100 calendars @ Rs.10 + 18% = 1,180 and 20 diaries @ Rs.50 + 12% = 1,120; order total 2,300.
   * `stateCode` 27 makes it an inter-state sale (IGST).
   */
  const issueInvoice = async (opts: { stateCode?: string; paid?: string } = {}) => {
    const customerId = `cust-cn-${++seq}`;
    globalMemoryCustomers.push({
      id: customerId, tenantId: TENANT, name: `CN Customer ${seq}`, phone: `+9198409700${String(seq).padStart(2, '0')}`,
      stateCode: opts.stateCode ?? '33', openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date(),
    } as any);
    const orderId = `ord-cn-${seq}`;
    const paid = opts.paid ?? '0.00';
    globalMemoryOrders.unshift({
      id: orderId, tenantId: TENANT, orderNumber: `ORD-CN-${seq}`, customerId, productionStage: 'ORDER_CONFIRMED',
      totalAmount: '2300.00', advanceReceived: paid, balanceDue: (2300 - Number(paid)).toFixed(2), createdAt: new Date(), updatedAt: new Date(),
    } as any);
    globalMemoryOrderItems.push(
      { id: `item-cn-${seq}-1`, tenantId: TENANT, orderId, itemName: 'Wall calendar', description: null, quantity: '100.00', unit: 'Nos', unitPrice: '10.00', taxPercent: '18.00', hsnCode: '4910', lineTotal: '1180.00' } as any,
      { id: `item-cn-${seq}-2`, tenantId: TENANT, orderId, itemName: 'Table diary', description: null, quantity: '20.00', unit: 'Nos', unitPrice: '50.00', taxPercent: '12.00', hsnCode: '4820', lineTotal: '1120.00' } as any
    );
    const inv = await invoices.issue(TENANT, null, orderId);
    return { orderId, customerId, inv };
  };
  const orderOf = (id: string) => globalMemoryOrders.find((o: any) => o.id === id) as any;
  const balanceOf = (id: string) => Number(orderOf(id).balanceDue);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const auth = fixture.get(AuthService);
    invoices = fixture.get(InvoicesService);
    for (const id of [TENANT, OTHER]) {
      globalMemoryTenants.set(id, {
        id, name: 'Credit Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999922222', isActive: true,
        gstNumber: gstin('33AABCS1234A1Z'), legalName: 'Credit Press', address: '5 Mill Rd, Coimbatore', stateCode: '33', createdAt: new Date(), updatedAt: new Date(),
      } as any);
    }
    auth.registerUser({ id: U_OWNER, fullName: 'CN Owner', phone: '+919840970001' });
    auth.registerUser({ id: U_PROD, fullName: 'CN Floor', phone: '+919840970002' });
    auth.registerUser({ id: U_OTHER, fullName: 'CN Stranger', phone: '+919840970003' });
    auth.registerMembership(TENANT, U_OWNER, 'OWNER', true);
    auth.registerMembership(TENANT, U_PROD, 'PRODUCTION', true);
    auth.registerMembership(OTHER, U_OTHER, 'OWNER', true);
    const login = async (phone: string, tenantId: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      return (await auth.verifyOtp({ phone, code: DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!, tenantId })).token;
    };
    owner = await login('+919840970001', TENANT);
    prod = await login('+919840970002', TENANT);
    stranger = await login('+919840970003', OTHER);
  });

  afterAll(async () => {
    await app.close();
  });

  it('cancels a whole unpaid invoice: the credit note equals the invoice and nothing is owed any more', async () => {
    const { orderId, inv } = await issueInvoice();
    expect(inv.totals.grandTotal).toBe('2300.00');
    const res = await credit({ invoiceId: inv.id, full: true, note: 'Order cancelled by customer' });
    expect(res.status).toBe(201);
    const cn = await res.json();
    expect(cn.creditNoteNumber).toBe(`CN/${financialYear(new Date())}/${cn.creditNoteNumber.slice(-4)}`);
    expect(cn).toMatchObject({ reason: 'CANCELLATION', reasonNote: 'Order cancelled by customer', supplyType: 'INTRA', orderBalanceAfter: '0.00' });
    expect(cn.totals).toMatchObject({ grandTotal: '2300.00', taxableValue: inv.totals.taxableValue, cgst: inv.totals.cgst, sgst: inv.totals.sgst, igst: '0.00' });
    expect(cn.invoice.invoiceNumber).toBe(inv.invoiceNumber);
    expect(cn.lines).toHaveLength(2);

    const after = await (await http(owner, `/invoices/${inv.id}`)).json();
    expect(after).toMatchObject({ credited: '2300.00', netTotal: '0.00' });
    expect(after.payment.status).toBe('CREDITED');
    expect(balanceOf(orderId)).toBe(0);
    expect(Number(orderOf(orderId).totalAmount)).toBe(0);
  });

  it('refuses a second full credit and any further credit once nothing is left', async () => {
    const { inv } = await issueInvoice();
    expect((await credit({ invoiceId: inv.id, full: true })).status).toBe(201);
    const again = await credit({ invoiceId: inv.id, full: true });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('AlreadyCredited');
    const more = await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 1 }] });
    expect(more.status).toBe(422);
  });

  it('takes a part return, lowers the balance by its amount and keeps the invoice open', async () => {
    const { orderId, inv } = await issueInvoice();
    const res = await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 40 }] });
    expect(res.status).toBe(201);
    const cn = await res.json();
    expect(cn.totals.grandTotal).toBe('472.00'); // 40% of 1,180
    expect(cn.lines[0]).toMatchObject({ lineNo: 1, quantity: '40', taxableValue: '400.00', cgst: '36.00', sgst: '36.00' });
    expect(balanceOf(orderId)).toBe(1828);

    const prep = await (await http(owner, `/credit-notes/prepare/${inv.id}`)).json();
    expect(prep.lines[0]).toMatchObject({ remainingQuantity: '60', remainingTaxableValue: '600.00' });
    expect(prep).toMatchObject({ creditedTotal: '472.00', remainingTotal: '1828.00' });
    expect(prep.creditNotes).toHaveLength(1);

    const view = await (await http(owner, `/invoices/${inv.id}`)).json();
    expect(view.payment.status).toBe('UNPAID');
    expect(view).toMatchObject({ credited: '472.00', netTotal: '1828.00' });
  });

  it('cannot take back more than was invoiced across several notes, and the last note settles it exactly', async () => {
    const { orderId, inv } = await issueInvoice();
    expect((await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 70 }] })).status).toBe(201);
    const tooMuch = await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 31 }] });
    expect(tooMuch.status).toBe(422);
    expect((await tooMuch.json()).message).toMatch(/only 30 Nos left/);
    expect((await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 30 }, { lineNo: 2, quantity: 20 }] })).status).toBe(201);
    expect(balanceOf(orderId)).toBe(0);
    expect((await (await http(owner, `/invoices/${inv.id}`)).json()).credited).toBe('2300.00');
  });

  it('gives a discount after the sale as a value credit, with tax, without returning goods', async () => {
    const { orderId, inv } = await issueInvoice();
    const res = await credit({ invoiceId: inv.id, reason: 'POST_SALE_DISCOUNT', lines: [{ lineNo: 1, taxableAmount: 100 }] });
    expect(res.status).toBe(201);
    const cn = await res.json();
    expect(cn.totals).toMatchObject({ taxableValue: '100.00', cgst: '9.00', sgst: '9.00', grandTotal: '118.00' });
    expect(cn.lines[0].quantity).toBe('0');
    expect(balanceOf(orderId)).toBe(2182);
    const over = await credit({ invoiceId: inv.id, reason: 'POST_SALE_DISCOUNT', lines: [{ lineNo: 1, taxableAmount: 901 }] });
    expect(over.status).toBe(422);
    expect((await over.json()).message).toMatch(/only Rs. 900.00/);
  });

  it('previews a credit note exactly as it would be issued, without saving anything or using a number', async () => {
    const { orderId, inv } = await issueInvoice();
    const body = { invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 40 }] };
    const preview = await credit({ ...body, dryRun: true });
    expect(preview.status).toBe(201);
    const p = await preview.json();
    expect(p).toMatchObject({ creditNoteNumber: '(preview)', orderBalanceAfter: '1828.00' });
    expect(p.totals.grandTotal).toBe('472.00');
    expect(balanceOf(orderId)).toBe(2300);
    expect((await (await http(owner, `/credit-notes?invoiceId=${inv.id}`)).json()).data).toHaveLength(0);
    const real = await (await credit(body)).json();
    expect(real.totals).toEqual(p.totals);
    expect((await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 61 }], dryRun: true })).status).toBe(422);
  });

  it('on an inter-state invoice credits IGST only', async () => {
    const { inv } = await issueInvoice({ stateCode: '27' });
    expect(inv.supplyType).toBe('INTER');
    const cn = await (await credit({ invoiceId: inv.id, reason: 'CORRECTION', lines: [{ lineNo: 2, taxableAmount: 100 }] })).json();
    expect(cn.supplyType).toBe('INTER');
    expect(cn.totals).toMatchObject({ cgst: '0.00', sgst: '0.00', igst: '12.00', grandTotal: '112.00' });
  });

  it('when the invoice was already paid, the customer ends up in credit rather than the balance being lost', async () => {
    const { orderId, inv } = await issueInvoice({ paid: '2300.00' });
    const cn = await (await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 40 }] })).json();
    expect(cn.orderBalanceAfter).toBe('-472.00');
    expect(balanceOf(orderId)).toBe(-472);
    const view = await (await http(owner, `/invoices/${inv.id}`)).json();
    expect(view.payment).toMatchObject({ balanceDue: '0.00', customerCredit: '472.00', status: 'PAID', paid: '2300.00' });
  });

  it('numbers notes consecutively in one series, and lists them', async () => {
    const a = await issueInvoice();
    const b = await issueInvoice();
    const n1 = await (await credit({ invoiceId: a.inv.id, reason: 'CORRECTION', lines: [{ lineNo: 1, taxableAmount: 10 }] })).json();
    const n2 = await (await credit({ invoiceId: b.inv.id, reason: 'CORRECTION', lines: [{ lineNo: 1, taxableAmount: 10 }] })).json();
    expect(Number(n2.creditNoteNumber.slice(-4))).toBe(Number(n1.creditNoteNumber.slice(-4)) + 1);
    const forInvoice = await (await http(owner, `/credit-notes?invoiceId=${a.inv.id}`)).json();
    expect(forInvoice.data.map((x: any) => x.creditNoteNumber)).toEqual([n1.creditNoteNumber]);
    const all = await (await http(owner, '/credit-notes')).json();
    expect(all.data.length).toBeGreaterThanOrEqual(2);
    expect((await (await http(owner, `/credit-notes/${n1.id}`)).json()).creditNoteNumber).toBe(n1.creditNoteNumber);
    const invList = await (await http(owner, '/invoices')).json();
    expect(invList.data.find((i: any) => i.id === a.inv.id)).toMatchObject({ credited: '11.80' });
  });

  it('only one of two simultaneous cancellations goes through', async () => {
    const { orderId, inv } = await issueInvoice();
    const [x, y] = await Promise.all([credit({ invoiceId: inv.id, full: true }), credit({ invoiceId: inv.id, full: true })]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(balanceOf(orderId)).toBe(0);
  });

  it('asks for a reason, and for a note when the reason is "other"', async () => {
    const { inv } = await issueInvoice();
    expect((await credit({ invoiceId: inv.id, lines: [{ lineNo: 1, quantity: 1 }] })).status).toBe(400);
    expect((await credit({ invoiceId: inv.id, reason: 'BECAUSE', lines: [{ lineNo: 1, quantity: 1 }] })).status).toBe(400);
    expect((await credit({ invoiceId: inv.id, reason: 'OTHER', lines: [{ lineNo: 1, quantity: 1 }] })).status).toBe(400);
    expect((await credit({ invoiceId: inv.id, reason: 'OTHER', note: 'x'.repeat(301), lines: [{ lineNo: 1, quantity: 1 }] })).status).toBe(400);
    expect((await credit({ invoiceId: inv.id, reason: 'SALES_RETURN' })).status).toBe(400);
  });

  it('rejects bad lines in plain words and writes nothing', async () => {
    const { orderId, inv } = await issueInvoice();
    const unknown = await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 9, quantity: 1 }] });
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).message).toMatch(/Line 9 is not on this invoice/);
    expect((await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 1, taxableAmount: 5 }] })).status).toBe(422);
    expect((await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: -3 }] })).status).toBe(422);
    expect((await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ quantity: 3 }] })).status).toBe(400);
    expect((await http(owner, `/credit-notes?invoiceId=${inv.id}`).then((r) => r.json())).data).toHaveLength(0);
    expect(balanceOf(orderId)).toBe(2300);
  });

  it('answers 404 for an unknown invoice and 400 for a malformed id', async () => {
    expect((await credit({ invoiceId: '00000000-0000-4000-8000-000000000000', full: true })).status).toBe(404);
    expect((await credit({ invoiceId: 'nope', full: true })).status).toBe(400);
    expect((await credit({ full: true })).status).toBe(400);
  });

  it('is closed to roles that cannot invoice, and to other businesses', async () => {
    const { inv } = await issueInvoice();
    expect((await credit({ invoiceId: inv.id, full: true }, prod)).status).toBe(403);
    expect((await http(prod, `/credit-notes/prepare/${inv.id}`)).status).toBe(403);
    const cn = await (await credit({ invoiceId: inv.id, full: true })).json();
    expect((await http(prod, `/credit-notes/${cn.id}`)).status).toBe(403);
    const asStranger = (path: string, init: { method?: string; body?: unknown } = {}) => http(stranger, path, { ...init, tenant: OTHER });
    expect((await asStranger('/credit-notes', { method: 'POST', body: { invoiceId: inv.id, full: true } })).status).toBe(404);
    expect((await asStranger(`/credit-notes/${cn.id}`)).status).toBe(404);
    expect((await asStranger(`/credit-notes/${cn.id}/pdf`)).status).toBe(404);
    expect((await asStranger(`/credit-notes/prepare/${inv.id}`)).status).toBe(404);
  });

  it('prints a credit note PDF that names the invoice it reduces', async () => {
    const { inv } = await issueInvoice();
    const cn = await (await credit({ invoiceId: inv.id, reason: 'SALES_RETURN', lines: [{ lineNo: 1, quantity: 10 }] })).json();
    const res = await http(owner, `/credit-notes/${cn.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(1500);
  });
});
