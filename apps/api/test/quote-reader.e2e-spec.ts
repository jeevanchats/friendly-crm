import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { QuoteReaderService } from '../src/modules/sales/quote-reader.service';
import { globalMemoryTenants } from '../src/modules/crm/memory-store';
import { buildSuggestedLines, matchProduct, nameScore } from '@friendly-crm/shared';

const PRODUCTS = [
  { id: 'p-cal', name: 'Wall Calendar', unit: 'Nos', unitPrice: '85', taxPercent: '12', hsnCode: '4910', description: '12 sheet' },
  { id: 'p-desk', name: 'Table Calendar', unit: 'Nos', unitPrice: '60', taxPercent: '12', hsnCode: '4910' },
  { id: 'p-card', name: 'Visiting Card', unit: 'Box', unitPrice: '350', taxPercent: '12', hsnCode: '4911' },
  { id: 'p-free', name: 'Design Charges', unit: 'Job', unitPrice: '0', taxPercent: '18', hsnCode: '998391' },
];

describe('matching what the customer asked for to the product list', () => {
  it('matches plurals and word order, and refuses to guess between two equally good products', () => {
    expect(nameScore('wall calendars', 'Wall Calendar')).toBe(1);
    expect(matchProduct('visiting cards', PRODUCTS)?.id).toBe('p-card');
    expect(matchProduct('calendar', PRODUCTS)).toBeNull(); // wall or table? not for the system to guess
    expect(matchProduct('steel almirah', PRODUCTS)).toBeNull();
  });

  it('lets the customer\'s own quantity, unit and rate win, and fills the rest from the product', () => {
    const [a, b] = buildSuggestedLines(
      [
        { itemName: 'wall calendars', quantity: 500, unitPrice: 90, unit: 'Pcs', productId: 'p-cal', sourceNote: '500 wall calendars @90' },
        { itemName: 'Visiting cards', quantity: '20' },
      ],
      PRODUCTS
    );
    expect(a).toMatchObject({ itemName: 'Wall Calendar', quantity: 500, unitPrice: 90, unit: 'Pcs', taxPercent: 12, hsnCode: '4910', productId: 'p-cal', missing: [] });
    expect(b).toMatchObject({ itemName: 'Visiting Card', quantity: 20, unitPrice: 350, unit: 'Box', hsnCode: '4911', missing: [] });
  });

  it('marks what is still missing and never invents a number', () => {
    const [x, y, z] = buildSuggestedLines(
      [{ itemName: 'Steel almirah' }, { itemName: 'Design charges', quantity: 1 }, { itemName: 'Wall calendar', quantity: -5, unitPrice: 'abc' }],
      PRODUCTS
    );
    expect(x).toMatchObject({ quantity: 0, unitPrice: 0, productId: null, taxPercent: 18, missing: ['quantity', 'rate'] });
    expect(y.missing).toEqual(['rate']); // the product has no rate on file
    expect(z).toMatchObject({ quantity: 0, unitPrice: 85, missing: ['quantity'] });
  });

  it('ignores a product id the model made up, junk entries, and caps the number of lines', () => {
    const lines = buildSuggestedLines([{ itemName: 'Chair', productId: 'not-mine' }, null, 'x', { itemName: '' }, { itemName: 42 }], PRODUCTS);
    expect(lines).toHaveLength(1);
    expect(lines[0].productId).toBeNull();
    expect(buildSuggestedLines(Array.from({ length: 100 }, (_, i) => ({ itemName: `Item ${i}` })), [])).toHaveLength(30);
    expect(buildSuggestedLines('nonsense', PRODUCTS)).toEqual([]);
  });
});

describe('Reading an enquiry to fill the quotation', () => {
  let app: INestApplication;
  let baseUrl: string;
  let reader: QuoteReaderService;
  let model: jest.SpyInstance;

  const T = '85858585-8585-4858-8858-858585858585';
  const OWNER = '11111111-8585-4858-8858-858585858585';
  const PROD = '22222222-8585-4858-8858-858585858585';
  let owner: string;
  let production: string;
  let phoneSeq = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': T });
  const json = (token: string, path: string, body?: unknown, method = body ? 'POST' : 'GET') =>
    fetch(`${baseUrl}/api${path}`, { method, headers: { ...auth(token), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const upload = (leadId: string, bytes: Buffer, name: string, type: string, extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return fetch(`${baseUrl}/api/crm/leads/${leadId}/attachments`, { method: 'POST', headers: auth(owner), body: form });
  };
  const enquire = async (title = '500 wall calendars as in the sketch') => {
    const res = await json(owner, '/crm/intake-lead', {
      name: 'Reader Traders', customerName: 'Reader Traders', phone: `98409990${String(++phoneSeq).padStart(2, '0')}`, title, source: 'PHONE', customData: { job_type: 'CALENDAR' },
    });
    expect(res.status).toBe(201);
    return res.json();
  };
  const modelAnswers = (input: Record<string, unknown>) => model.mockResolvedValue({ content: [{ type: 'tool_use', name: 'record_quote_lines', input }] });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    reader = fixture.get(QuoteReaderService);
    model = jest.spyOn(reader as any, 'callModel');
    const a = fixture.get(AuthService);
    globalMemoryTenants.set(T, { id: T, name: 'Reader Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999955555', isActive: true } as any);
    a.registerUser({ id: OWNER, fullName: 'R Owner', phone: '+919840999101' });
    a.registerUser({ id: PROD, fullName: 'R Floor', phone: '+919840999102' });
    a.registerMembership(T, OWNER, 'OWNER', true);
    a.registerMembership(T, PROD, 'PRODUCTION', true);
    const login = async (phone: string) => {
      await a.requestOtp({ phone, countryCode: '+91' });
      return (await a.verifyOtp({ phone, code: DevSmsGateway.getLatestOtp(a.normalizePhone(phone))!, tenantId: T })).token;
    };
    owner = await login('+919840999101');
    production = await login('+919840999102');
    for (const p of [
      { name: 'Wall Calendar', hsnCode: '4910', unit: 'Nos', unitPrice: 85, taxPercent: 12 },
      { name: 'Visiting Card', hsnCode: '4911', unit: 'Box', unitPrice: 350, taxPercent: 12 },
    ]) expect((await json(owner, '/products', p)).status).toBe(201);
  });

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    model.mockReset();
  });
  afterAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await app.close();
  });

  it('says so, and calls nothing, when no reader is configured on the server', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const e = await enquire();
    const res = await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ enabled: false, lines: [] });
    expect(model).not.toHaveBeenCalled();
  });

  it('sends the sketch, the PDF and the spoken words to the reader, and fills lines from the product list', async () => {
    const e = await enquire();
    await upload(e.lead.id, Buffer.from('png-bytes'), 'sketch.png', 'image/png');
    await upload(e.lead.id, Buffer.from('%PDF-1.4'), 'list.pdf', 'application/pdf');
    await upload(e.lead.id, Buffer.from('opus'), 'voice-note.webm', 'audio/webm', { transcript: 'also twenty boxes of visiting cards please' });
    modelAnswers({
      summary: 'Calendars and visiting cards.',
      lines: [
        { itemName: 'Wall calendars', quantity: 500, sourceNote: '500 wall calendars' },
        { itemName: 'Visiting cards', quantity: 20, unit: 'Box', sourceNote: 'twenty boxes of visiting cards' },
        { itemName: 'Gold foil box' },
      ],
      unreadable: ['bottom of the sketch'],
    });

    const res = await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id });
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.enabled).toBe(true);
    expect(out.lines).toHaveLength(3);
    expect(out.lines[0]).toMatchObject({ itemName: 'Wall Calendar', quantity: 500, unitPrice: 85, taxPercent: 12, hsnCode: '4910', missing: [] });
    expect(out.lines[1]).toMatchObject({ itemName: 'Visiting Card', quantity: 20, unitPrice: 350, hsnCode: '4911' });
    expect(out.lines[2]).toMatchObject({ itemName: 'Gold foil box', productId: null, missing: ['quantity', 'rate'] });
    expect(out.skipped.join(' ')).toMatch(/bottom of the sketch/);

    // what actually went to the model
    const body = model.mock.calls[0][0] as any;
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_quote_lines' });
    const kinds = body.messages[0].content.map((b: any) => b.type);
    expect(kinds).toEqual(expect.arrayContaining(['text', 'image', 'document']));
    const text = body.messages[0].content[0].text as string;
    expect(text).toContain('500 wall calendars as in the sketch');
    expect(text).toContain('twenty boxes of visiting cards');
    expect(text).toMatch(/Wall Calendar \| Nos/); // the product list, for matching
    expect(JSON.stringify(body)).not.toContain('test-key');
  });

  it('reads from the customer when the quote is opened from the customer page', async () => {
    const e = await enquire('Visiting cards for the shop');
    await upload(e.lead.id, Buffer.from('opus'), 'v.webm', 'audio/webm', { transcript: '20 boxes visiting cards' });
    modelAnswers({ lines: [{ itemName: 'Visiting cards', quantity: 20 }] });
    const out = await (await json(owner, '/sales/quotations/suggest', { customerId: e.customer.id })).json();
    expect(out.lines[0]).toMatchObject({ itemName: 'Visiting Card', quantity: 20, unitPrice: 350 });
  });

  it('does not send a voice note that has no written text, and tells staff to listen to it', async () => {
    const e = await enquire('Something is in the recording');
    await upload(e.lead.id, Buffer.from('opus'), 'v.webm', 'audio/webm');
    modelAnswers({ lines: [] });
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(out.skipped.join(' ')).toMatch(/voice note has no written text/);
  });

  it('skips Word and Excel files with a note, and does not call the reader when there is nothing to read', async () => {
    const e = await enquire('x');
    await upload(e.lead.id, Buffer.from('doc'), 'spec.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    modelAnswers({ lines: [{ itemName: 'x' }] });
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(out.skipped.join(' ')).toMatch(/spec\.docx.*cannot be read automatically/);
  });

  it('turns a reader failure into a clear message, not a crash, and never shows the key', async () => {
    const e = await enquire();
    await upload(e.lead.id, Buffer.from('png'), 's.png', 'image/png');
    model.mockImplementation(async () => {
      const { BadGatewayException } = await import('@nestjs/common');
      throw new BadGatewayException('The reading service is busy. Try again in a minute.');
    });
    const res = await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('test-key');
    model.mockResolvedValue({ content: [{ type: 'text', text: 'no tool call' }] });
    expect((await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).status).toBe(502);
  });

  it('is closed to roles that cannot prepare quotes or open enquiries, and rejects a request naming nothing', async () => {
    const e = await enquire();
    expect((await json(production, '/sales/quotations/suggest', { leadId: e.lead.id })).status).toBe(403);
    expect((await json(owner, '/sales/quotations/suggest', {})).status).toBe(400);
    expect((await json(owner, '/sales/quotations/suggest', { leadId: 'not-a-uuid' })).status).toBe(400);
  });

  it('keeps the voice-note text with the voice note', async () => {
    const e = await enquire();
    const a = await (await upload(e.lead.id, Buffer.from('opus'), 'v.webm', 'audio/webm', { transcript: '  500 calendars  ' })).json();
    expect(a.transcript).toBe('500 calendars');
    const f = await (await upload(e.lead.id, Buffer.from('%PDF'), 'f.pdf', 'application/pdf', { transcript: 'ignored for files' })).json();
    expect(f.transcript).toBeNull();
  });
});
