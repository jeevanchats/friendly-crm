import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { InvoicesService } from '../src/modules/invoices/invoices.service';
import { InvoicePdfService } from '../src/modules/invoices/invoice-pdf.service';
import { PdfEngineService } from '../src/modules/sales/pdf/pdf-engine.service';
import { buildUpiQrPayload, paymentFromTenantRow, preparePdfPayment, qrPng } from '../src/modules/payments/payment-info';
import { completeBank, gstinCheckChar, normalizeAccountNumber, normalizeIfsc, paymentDetailsText } from '@friendly-crm/shared';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryOrders, globalMemoryOrderItems } from '../src/modules/crm/memory-store';

const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const BANK = { accountName: 'Senthaamarai Art Crafts', bankName: 'HDFC Bank', accountNumber: '50200012345678', ifsc: 'HDFC0001234', branch: 'Coimbatore' };

describe('payment details helpers', () => {
  it('checks IFSC codes and account numbers, ignoring the spaces people type', () => {
    expect(normalizeIfsc(' hdfc0001234 ')).toBe('HDFC0001234');
    for (const bad of ['HDFC1001234', 'HDF0001234', 'HDFC000123', '', null, 5]) expect(normalizeIfsc(bad)).toBeNull();
    expect(normalizeAccountNumber('5020 0012-345678')).toBe('50200012345678');
    for (const bad of ['12345678', '1234567890123456789', 'ABC123456789', '']) expect(normalizeAccountNumber(bad)).toBeNull();
  });

  it('counts bank details as usable only when name, account number and IFSC are all there', () => {
    expect(completeBank(BANK)).toMatchObject({ accountName: 'Senthaamarai Art Crafts', accountNumber: '50200012345678', ifsc: 'HDFC0001234' });
    expect(completeBank({ ...BANK, accountName: '' })).toBeNull();
    expect(completeBank({ ...BANK, ifsc: 'nope' })).toBeNull();
    expect(completeBank({ ...BANK, accountNumber: '123' })).toBeNull();
    expect(completeBank({ ...BANK, bankName: undefined, branch: undefined })).not.toBeNull(); // bank and branch names are optional
  });

  it('writes the details as plain text in English and Tamil, and nothing when there are none', () => {
    const en = paymentDetailsText('en', { upiId: 'apex@okhdfc', bank: completeBank(BANK) });
    expect(en).toContain('Account name: Senthaamarai Art Crafts');
    expect(en).toContain('Bank: HDFC Bank, Coimbatore');
    expect(en).toContain('UPI ID: apex@okhdfc');
    expect(en).toContain('send us the reference number');
    expect(paymentDetailsText('ta', { upiId: 'apex@okhdfc', bank: null })).toContain('பணம் செலுத்த');
    expect(paymentDetailsText('en', { upiId: null, bank: null })).toBe('');
    expect(paymentDetailsText('en', null)).toBe('');
  });
});

describe('UPI QR codes', () => {
  it('encodes the UPI ID, name and an exact amount, or leaves the amount out', () => {
    expect(buildUpiQrPayload({ upiId: 'apex@okhdfc', payeeName: 'Apex Press', amountPaise: 123450, note: 'INV/2026-27/0001' })).toBe(
      'upi://pay?pa=apex%40okhdfc&pn=Apex%20Press&am=1234.50&cu=INR&tn=INV%2F2026-27%2F0001'
    );
    expect(buildUpiQrPayload({ upiId: 'apex@okhdfc', payeeName: 'Apex Press' })).toBe('upi://pay?pa=apex%40okhdfc&pn=Apex%20Press&cu=INR');
    expect(() => buildUpiQrPayload({ upiId: 'not a upi id', payeeName: 'x' })).toThrow();
    expect(() => buildUpiQrPayload({ upiId: 'apex@okhdfc', payeeName: 'x', amountPaise: 0 })).toThrow();
    expect(() => buildUpiQrPayload({ upiId: 'apex@okhdfc', payeeName: 'x', amountPaise: 10.5 })).toThrow();
  });

  it('draws a real PNG, and prepares nothing when the business has set no payment details', async () => {
    const png = await qrPng('upi://pay?pa=apex%40okhdfc&pn=Apex&cu=INR');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(await preparePdfPayment(null, 'Apex')).toBeNull();
    expect(await preparePdfPayment({ upiId: null, bank: null }, 'Apex')).toBeNull();
    const bankOnly = await preparePdfPayment({ upiId: null, bank: completeBank(BANK) }, 'Apex');
    expect(bankOnly).toMatchObject({ qrPng: null }); // no UPI ID, so no QR; the bank lines still print
    const both = await preparePdfPayment({ upiId: 'apex@okhdfc', bank: completeBank(BANK) }, 'Apex', { amountPaise: 5000 });
    expect(both?.qrPng?.length).toBeGreaterThan(200);
    expect(both?.amountPaise).toBe(5000);
  }, 30_000); // the first QR in a busy test run loads the library

  it('reads the payment details from a tenant row and ignores an invalid UPI ID or an incomplete bank account', () => {
    expect(paymentFromTenantRow({ upiId: 'apex@okhdfc', bankAccountName: 'A', bankAccountNumber: '50200012345678', bankIfsc: 'HDFC0001234' })).toMatchObject({
      upiId: 'apex@okhdfc',
      bank: { accountName: 'A', ifsc: 'HDFC0001234' },
    });
    expect(paymentFromTenantRow({ upiId: 'bad id', bankAccountName: 'A', bankIfsc: 'HDFC0001234' })).toEqual({ upiId: null, bank: null });
    expect(paymentFromTenantRow(undefined)).toEqual({ upiId: null, bank: null });
  });
});

describe('Bank details in Settings and on documents', () => {
  let app: INestApplication;
  let baseUrl: string;
  let invoices: InvoicesService;
  let invoicePdf: InvoicePdfService;
  let quotePdf: PdfEngineService;

  const T = '98989898-9898-4989-8989-989898989898';
  const OWNER = '11111111-9898-4989-8989-989898989898';
  const SALES = '22222222-9898-4989-8989-989898989898';
  let owner: string;
  let sales: string;
  let seq = 0;

  const http = (token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': T, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const patch = (body: unknown, token = owner) => http(token, '/tenant/settings', { method: 'PATCH', body });
  const tenant = () => globalMemoryTenants.get(T) as any;

  const issueInvoice = async () => {
    const customerId = `cust-pd-${++seq}`;
    globalMemoryCustomers.push({ id: customerId, tenantId: T, name: `PD Customer ${seq}`, phone: `+9198409810${String(seq).padStart(2, '0')}`, stateCode: '33', openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date() } as any);
    const orderId = `ord-pd-${seq}`;
    globalMemoryOrders.unshift({ id: orderId, tenantId: T, orderNumber: `ORD-PD-${seq}`, customerId, productionStage: 'ORDER_CONFIRMED', totalAmount: '1180.00', advanceReceived: '0.00', balanceDue: '1180.00', createdAt: new Date(), updatedAt: new Date() } as any);
    globalMemoryOrderItems.push({ id: `item-pd-${seq}`, tenantId: T, orderId, itemName: 'Wall calendar', description: null, quantity: '100.00', unit: 'Nos', unitPrice: '10.00', taxPercent: '18.00', hsnCode: '4910', lineTotal: '1180.00' } as any);
    return { orderId, inv: await invoices.issue(T, null, orderId) };
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    invoices = fixture.get(InvoicesService);
    invoicePdf = fixture.get(InvoicePdfService);
    quotePdf = fixture.get(PdfEngineService);
    const auth = fixture.get(AuthService);
    globalMemoryTenants.set(T, {
      id: T, name: 'Pay Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999911119', isActive: true,
      gstNumber: gstin('33AABCS1234A1Z'), legalName: 'Pay Press', address: '1 Mill Rd, Coimbatore', stateCode: '33',
    } as any);
    auth.registerUser({ id: OWNER, fullName: 'PD Owner', phone: '+919840981001' });
    auth.registerUser({ id: SALES, fullName: 'PD Sales', phone: '+919840981002' });
    auth.registerMembership(T, OWNER, 'OWNER', true);
    auth.registerMembership(T, SALES, 'SALESPERSON', true);
    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      return (await auth.verifyOtp({ phone, code: DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!, tenantId: T })).token;
    };
    owner = await login('+919840981001');
    sales = await login('+919840981002');
  });

  afterAll(async () => {
    await app.close();
  });

  it('saves the bank account, tidies the IFSC and account number, and returns them', async () => {
    const res = await patch({ bankAccountName: 'Pay Press', bankName: 'HDFC Bank', bankBranch: 'Coimbatore', bankAccountNumber: '5020 0012 345678', bankIfsc: ' hdfc0001234 ', upiId: 'paypress@okhdfc' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ bankAccountName: 'Pay Press', bankName: 'HDFC Bank', bankBranch: 'Coimbatore', bankAccountNumber: '50200012345678', bankIfsc: 'HDFC0001234', upiId: 'paypress@okhdfc' });
    expect(await (await http(owner, '/tenant/settings')).json()).toMatchObject({ bankIfsc: 'HDFC0001234' });
  });

  it('rejects a wrong IFSC or account number, and a bank account that is only half filled in', async () => {
    expect((await patch({ bankIfsc: 'HDFC1001234' })).status).toBe(400);
    expect((await patch({ bankAccountNumber: '12345' })).status).toBe(400);
    expect((await patch({ bankName: 'x'.repeat(121) })).status).toBe(400);
    // a business with no bank account yet cannot save just a name or just a number
    const saved = { ...tenant() };
    for (const k of ['bankAccountName', 'bankName', 'bankAccountNumber', 'bankIfsc', 'bankBranch']) tenant()[k] = null;
    const half = await patch({ bankAccountName: 'Pay Press' });
    expect(half.status).toBe(400);
    expect((await half.json()).message).toMatch(/account name, account number and IFSC together/);
    expect((await patch({ bankAccountNumber: '50200012345678', bankIfsc: 'HDFC0001234' })).status).toBe(400); // still no name
    Object.assign(tenant(), saved);
  });

  it('lets the bank account be cleared again, all together', async () => {
    const saved = { ...tenant() };
    const res = await patch({ bankAccountName: null, bankName: null, bankBranch: null, bankAccountNumber: '', bankIfsc: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ bankAccountName: null, bankAccountNumber: null, bankIfsc: null });
    Object.assign(tenant(), saved);
  });

  it('is for the owner only', async () => {
    expect((await patch({ bankName: 'Sneaky Bank' }, sales)).status).toBe(403);
  });

  it('prints the "how to pay" block with a QR on an unpaid invoice, and leaves it off a paid one', async () => {
    const { inv } = await issueInvoice();
    const payment = paymentFromTenantRow(tenant());
    expect(payment.bank).not.toBeNull();
    const without = await invoicePdf.generate(inv, null);
    const withPay = await invoicePdf.generate(inv, payment);
    expect(withPay.subarray(0, 5).toString()).toBe('%PDF-');
    expect(withPay.length).toBeGreaterThan(without.length + 800); // the QR image and the bank lines

    const paid = await invoices.getById(T, inv.id);
    const cleared = { ...paid, payment: { ...paid.payment, status: 'PAID' as const, balanceDue: '0.00' } };
    const paidWith = await invoicePdf.generate(cleared, payment);
    const paidWithout = await invoicePdf.generate(cleared, null);
    expect(Math.abs(paidWith.length - paidWithout.length)).toBeLessThan(200); // nothing more to pay: no block
  });

  it('serves the invoice PDF through the API with the business\'s details applied', async () => {
    const { inv } = await issueInvoice();
    const res = await http(owner, `/invoices/${inv.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    const bytes = Buffer.from(await res.arrayBuffer());
    const bare = await invoicePdf.generate(inv, null);
    expect(bytes.length).toBeGreaterThan(bare.length + 800);
  });

  it('prints the details on a quotation too, with a QR that has no fixed amount', async () => {
    const doc = {
      quoteNumber: 'QT-2026-0001', business: { name: 'Pay Press' }, customer: { name: 'Ravi' },
      items: [{ itemName: 'Calendar', quantity: 10, unit: 'Nos', unitPrice: 100, taxPercent: 12, lineTotal: 1120 }],
      totals: { subTotal: 1000, taxTotal: 120, discountTotal: 0, grandTotal: 1120 },
    };
    const payment = await preparePdfPayment(paymentFromTenantRow(tenant()), 'Pay Press');
    const withPay = await quotePdf.generateQuotationPdf({ ...doc, payment });
    const without = await quotePdf.generateQuotationPdf({ ...doc, payment: null });
    expect(withPay.length).toBeGreaterThan(without.length + 800);
  });

  it('has no payment gateway endpoints any more', async () => {
    expect((await http(owner, '/payments/create-order', { method: 'POST', body: { orderId: 'x', amount: 1 } })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/payments/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
  });
});
