import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { InvoicesService } from '../src/modules/invoices/invoices.service';
import {
  MAX_EWAY_BILLS_PER_INVOICE,
  MAX_FILE_BYTES,
  gstinCheckChar,
  likelyNeedsEwayBill,
  normalizeEwayBillNumber,
  normalizeVehicleNumber,
  parseIsoDate,
} from '@friendly-crm/shared';
import { globalMemoryTenants, globalMemoryCustomers, globalMemoryOrders, globalMemoryOrderItems } from '../src/modules/crm/memory-store';

const gstin = (first14: string) => first14 + gstinCheckChar(first14);

describe('e-way bill helpers', () => {
  it('accepts the 12 digit number however it was copied, and nothing else', () => {
    expect(normalizeEwayBillNumber('351 0012 34567')).toBe('351001234567');
    expect(normalizeEwayBillNumber('3510-0123-4567')).toBe('351001234567');
    expect(normalizeEwayBillNumber(351001234567)).toBe('351001234567');
    for (const bad of ['35100123456', '3510012345678', 'abcdefghijkl', '', null, undefined]) expect(normalizeEwayBillNumber(bad)).toBeNull();
  });

  it('cleans up a vehicle number and refuses nonsense', () => {
    expect(normalizeVehicleNumber('tn 38 ab 1234')).toBe('TN38AB1234');
    expect(normalizeVehicleNumber('22BH1234AA')).toBe('22BH1234AA');
    for (const bad of ['1234', 'ABCDEFGH', '12345678', 'TN38 AB 1234 EXTRA LONG']) expect(normalizeVehicleNumber(bad)).toBeNull();
  });

  it('accepts only real calendar dates', () => {
    expect(parseIsoDate('2026-10-25')).toBe('2026-10-25');
    for (const bad of ['2026-02-30', '25-10-2026', '2026-13-01', 'tomorrow', '']) expect(parseIsoDate(bad)).toBeNull();
  });

  it('advises an e-way bill only for goods worth more than Rs. 50,000', () => {
    expect(likelyNeedsEwayBill(50000, ['4910'])).toBe(false);
    expect(likelyNeedsEwayBill(50000.01, ['4910'])).toBe(true);
    expect(likelyNeedsEwayBill(120000, ['998391', '998392'])).toBe(false); // services only
    expect(likelyNeedsEwayBill(120000, ['998391', '4910'])).toBe(true);
  });
});

describe('E-way bills recorded against an invoice', () => {
  let app: INestApplication;
  let baseUrl: string;
  let invoices: InvoicesService;

  const T = '96969696-9696-4969-8969-969696969696';
  const OTHER = '97979797-9797-4979-8979-979797979797';
  const U_OWNER = '11111111-9696-4969-8969-969696969696';
  const U_PROD = '22222222-9696-4969-8969-969696969696';
  const U_OTHER = '33333333-9696-4969-8969-969696969696';
  let owner: string;
  let production: string;
  let stranger: string;
  let seq = 0;
  let ewbSeq = 100000000000;

  const headers = (token: string, tenant = T) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenant });
  const nextEwb = () => String(++ewbSeq);
  const upload = (
    token: string,
    fields: Record<string, string>,
    file?: { bytes: Buffer; name: string; type: string },
    tenant = T
  ) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file) form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
    return fetch(`${baseUrl}/api/eway-bills`, { method: 'POST', headers: headers(token, tenant), body: form });
  };
  const get = (token: string, path: string, tenant = T) => fetch(`${baseUrl}/api${path}`, { headers: headers(token, tenant) });

  const issueInvoice = async () => {
    const customerId = `cust-ew-${++seq}`;
    globalMemoryCustomers.push({
      id: customerId, tenantId: T, name: `EW Customer ${seq}`, phone: `+9198409800${String(seq).padStart(2, '0')}`, stateCode: '33',
      openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date(),
    } as any);
    const orderId = `ord-ew-${seq}`;
    globalMemoryOrders.unshift({
      id: orderId, tenantId: T, orderNumber: `ORD-EW-${seq}`, customerId, productionStage: 'ORDER_CONFIRMED', totalAmount: '59000.00',
      advanceReceived: '0.00', balanceDue: '59000.00', createdAt: new Date(), updatedAt: new Date(),
    } as any);
    globalMemoryOrderItems.push({
      id: `item-ew-${seq}`, tenantId: T, orderId, itemName: 'MS flat bar', description: null, quantity: '1000.00', unit: 'Kg', unitPrice: '50.00',
      taxPercent: '18.00', hsnCode: '7214', lineTotal: '59000.00',
    } as any);
    return invoices.issue(T, null, orderId);
  };

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
    for (const id of [T, OTHER]) {
      globalMemoryTenants.set(id, {
        id, name: 'Steel Traders', industryKey: 'trading', defaultLanguage: 'en', phone: '+919999933333', isActive: true,
        gstNumber: gstin('33AABCS1234A1Z'), legalName: 'Steel Traders', address: '9 Foundry Rd, Madurai', stateCode: '33',
      } as any);
    }
    auth.registerUser({ id: U_OWNER, fullName: 'EW Owner', phone: '+919840982001' });
    auth.registerUser({ id: U_PROD, fullName: 'EW Floor', phone: '+919840982002' });
    auth.registerUser({ id: U_OTHER, fullName: 'EW Stranger', phone: '+919840982003' });
    auth.registerMembership(T, U_OWNER, 'OWNER', true);
    auth.registerMembership(T, U_PROD, 'PRODUCTION', true);
    auth.registerMembership(OTHER, U_OTHER, 'OWNER', true);
    const login = async (phone: string, tenantId: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      return (await auth.verifyOtp({ phone, code: DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!, tenantId })).token;
    };
    owner = await login('+919840982001', T);
    production = await login('+919840982002', T);
    stranger = await login('+919840982003', OTHER);
  });

  afterAll(async () => {
    await app.close();
  });

  it('records the number, dates, vehicle and the downloaded PDF against the invoice', async () => {
    const inv = await issueInvoice();
    const pdf = Buffer.from('%PDF-1.4 e-way bill from the portal');
    const ewb = nextEwb();
    const res = await upload(owner, { invoiceId: inv.id, ewbNumber: `${ewb.slice(0, 4)} ${ewb.slice(4, 8)} ${ewb.slice(8)}`, generatedOn: '2026-10-25', validUntil: '2026-10-27', vehicleNumber: 'tn 38 ab 1234' }, { bytes: pdf, name: 'EWB.pdf', type: 'application/pdf' });
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b).toMatchObject({ invoiceId: inv.id, ewbNumber: ewb, generatedOn: '2026-10-25', validUntil: '2026-10-27', vehicleNumber: 'TN38AB1234', hasFile: true, fileName: 'EWB.pdf', mimeType: 'application/pdf' });

    const list = await (await get(owner, `/eway-bills?invoiceId=${inv.id}`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].data).toBeUndefined(); // the list never carries the file

    const file = await get(owner, `/eway-bills/${b.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await file.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it('accepts a bill with no file (just the number), and says so when the file is asked for', async () => {
    const inv = await issueInvoice();
    const res = await upload(owner, { invoiceId: inv.id, ewbNumber: nextEwb() });
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b).toMatchObject({ hasFile: false, generatedOn: null, validUntil: null, vehicleNumber: null });
    expect((await get(owner, `/eway-bills/${b.id}/file`)).status).toBe(404);
  });

  it('allows several for one invoice (a changed vehicle, a regenerated bill) up to a limit', async () => {
    const inv = await issueInvoice();
    for (let i = 0; i < MAX_EWAY_BILLS_PER_INVOICE; i++) expect((await upload(owner, { invoiceId: inv.id, ewbNumber: nextEwb() })).status).toBe(201);
    const over = await upload(owner, { invoiceId: inv.id, ewbNumber: nextEwb() });
    expect(over.status).toBe(400);
    expect((await over.json()).message).toMatch(/at most 10/);
  });

  it('will not record the same e-way bill number twice', async () => {
    const inv = await issueInvoice();
    const ewb = nextEwb();
    expect((await upload(owner, { invoiceId: inv.id, ewbNumber: ewb })).status).toBe(201);
    const again = await upload(owner, { invoiceId: inv.id, ewbNumber: ewb.replace(/(\d{4})(\d{4})(\d{4})/, '$1-$2-$3') });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('EwayBillExists');
    const other = await issueInvoice();
    expect((await upload(owner, { invoiceId: other.id, ewbNumber: ewb })).status).toBe(409);
  });

  it('rejects wrong numbers, dates, vehicles and file types in plain words, and saves nothing', async () => {
    const inv = await issueInvoice();
    const bad = async (fields: Record<string, string>, file?: { bytes: Buffer; name: string; type: string }) => upload(owner, { invoiceId: inv.id, ewbNumber: nextEwb(), ...fields }, file);
    expect(((await (await bad({ ewbNumber: '12345' })).json()).message)).toMatch(/12 digits/);
    expect((await bad({ generatedOn: '2026-02-30' })).status).toBe(400);
    expect((await bad({ validUntil: 'soon' })).status).toBe(400);
    const before = await bad({ generatedOn: '2026-10-25', validUntil: '2026-10-20' });
    expect(before.status).toBe(400);
    expect((await before.json()).message).toMatch(/before/);
    expect((await bad({ vehicleNumber: '12' })).status).toBe(400);
    expect((await bad({}, { bytes: Buffer.from('<svg/>'), name: 'x.svg', type: 'image/svg+xml' })).status).toBe(400);
    expect((await bad({}, { bytes: Buffer.from('x'), name: 'x.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).status).toBe(400);
    expect((await bad({}, { bytes: Buffer.alloc(MAX_FILE_BYTES + 1024), name: 'big.pdf', type: 'application/pdf' })).status).toBe(413);
    expect(await (await get(owner, `/eway-bills?invoiceId=${inv.id}`)).json()).toHaveLength(0);
  });

  it('removes one recorded by mistake', async () => {
    const inv = await issueInvoice();
    const b = await (await upload(owner, { invoiceId: inv.id, ewbNumber: nextEwb() }, { bytes: Buffer.from('%PDF'), name: 'a.pdf', type: 'application/pdf' })).json();
    expect((await fetch(`${baseUrl}/api/eway-bills/${b.id}`, { method: 'DELETE', headers: headers(owner) })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/eway-bills/${b.id}`, { method: 'DELETE', headers: headers(owner) })).status).toBe(404);
    expect(await (await get(owner, `/eway-bills?invoiceId=${inv.id}`)).json()).toHaveLength(0);
  });

  it('answers 404 for an unknown invoice and 400 for a missing or malformed one', async () => {
    expect((await upload(owner, { invoiceId: '00000000-0000-4000-8000-000000000000', ewbNumber: nextEwb() })).status).toBe(404);
    expect((await upload(owner, { invoiceId: 'nope', ewbNumber: nextEwb() })).status).toBe(400);
    expect((await upload(owner, { ewbNumber: nextEwb() })).status).toBe(400);
    expect((await get(owner, '/eway-bills?invoiceId=nope')).status).toBe(400);
  });

  it('is closed to roles that cannot invoice, and one business cannot see or change another\'s', async () => {
    const inv = await issueInvoice();
    const b = await (await upload(owner, { invoiceId: inv.id, ewbNumber: nextEwb() }, { bytes: Buffer.from('%PDF'), name: 'a.pdf', type: 'application/pdf' })).json();
    expect((await upload(production, { invoiceId: inv.id, ewbNumber: nextEwb() })).status).toBe(403);
    expect((await get(production, `/eway-bills?invoiceId=${inv.id}`)).status).toBe(403);
    expect((await get(production, `/eway-bills/${b.id}/file`)).status).toBe(403);
    expect((await upload(stranger, { invoiceId: inv.id, ewbNumber: nextEwb() }, undefined, OTHER)).status).toBe(404);
    expect((await get(stranger, `/eway-bills?invoiceId=${inv.id}`, OTHER)).status).toBe(404);
    expect((await get(stranger, `/eway-bills/${b.id}/file`, OTHER)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/eway-bills/${b.id}`, { method: 'DELETE', headers: headers(stranger, OTHER) })).status).toBe(404);
  });
});
