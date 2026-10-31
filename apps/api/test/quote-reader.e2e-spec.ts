import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { QuoteReaderService } from '../src/modules/sales/quote-reader.service';
import { zipSync, strToU8 } from 'fflate';
import { DocumentTextService } from '../src/modules/sales/document-text.service';
import { readFileSync } from 'fs';
import { join } from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
import { globalMemoryTenants } from '../src/modules/crm/memory-store';
import { buildSuggestedLines, matchProduct, nameScore, parseRequestText } from '@friendly-crm/shared';

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
    expect(x).toMatchObject({ quantity: 0, unitPrice: 0, productId: null, taxPercent: 18, unit: '', missing: ['quantity', 'unit', 'rate'] });
    expect(y.missing).toEqual(['rate']); // the product has no rate on file
    expect(z).toMatchObject({ quantity: 0, unitPrice: 85, missing: ['quantity'] });
  });

  it('keeps the size in the description, and leaves the unit for staff when the customer did not give one', () => {
    const [rod, cards] = buildSuggestedLines(
      [
        { itemName: 'MS Round Rod', description: '50 mm dia, 1 m length', sourceNote: 'ms rod 50diameter 1 meter length' },
        { itemName: 'Flyers', quantity: 1000, unit: 'Nos' },
      ],
      PRODUCTS
    );
    expect(rod).toMatchObject({ itemName: 'MS Round Rod', description: '50 mm dia, 1 m length', quantity: 0, unit: '', missing: ['quantity', 'unit', 'rate'] });
    expect(cards).toMatchObject({ unit: 'Nos', missing: ['rate'] }); // a stated unit is never marked missing
  });

  it('ignores a product id the model made up, junk entries, and caps the number of lines', () => {
    const lines = buildSuggestedLines([{ itemName: 'Chair', productId: 'not-mine' }, null, 'x', { itemName: '' }, { itemName: 42 }], PRODUCTS);
    expect(lines).toHaveLength(1);
    expect(lines[0].productId).toBeNull();
    expect(buildSuggestedLines(Array.from({ length: 100 }, (_, i) => ({ itemName: `Item ${i}` })), [])).toHaveLength(30);
    expect(buildSuggestedLines('nonsense', PRODUCTS)).toEqual([]);
  });
});

describe('reading plain words without any AI service', () => {
  const read = (text: string) => parseRequestText(text, PRODUCTS as any).map((l) => [l.itemName, l.quantity ?? null, l.unit ?? null, l.unitPrice ?? null]);

  it('finds the products the business sells, with quantity, unit and rate written next to them', () => {
    expect(read('500 wall calendars')).toEqual([['Wall Calendar', 500, null, null]]);
    expect(read('Please send me a quote for 500 wall calendars by Friday')).toEqual([['Wall Calendar', 500, null, null]]);
    expect(read('20 boxes of visiting cards @ 350')).toEqual([['Visiting Card', 20, 'Box', 350]]);
    expect(read('visiting cards - 20 box\nwall calendar x 300 rate 90')).toEqual([['Visiting Card', 20, 'Box', null], ['Wall Calendar', 300, null, 90]]);
  });

  it('gives each product its own number when several are in one sentence', () => {
    expect(read('need table calendar 100 nos, wall calendar 200 nos')).toEqual([['Table Calendar', 100, 'Nos', null], ['Wall Calendar', 200, 'Nos', null]]);
    expect(read('500 wall calendars and 20 visiting cards')).toEqual([['Wall Calendar', 500, null, null], ['Visiting Card', 20, null, null]]);
  });

  it('takes short list-style lines for things that are not in the product list', () => {
    expect(read('1. 250 steel almirah\n2. tea cups - 12 box')).toEqual([['Steel Almirah', 250, null, null], ['Tea Cups', 12, 'Box', null]]);
    expect(read('calendars 500')).toEqual([['Calendars', 500, null, null]]);
    expect(read('tea cups rs 40 x 12 nos')).toEqual([['Tea Cups', 12, 'Nos', 40]]);
  });

  it('does not turn phone numbers, dates and delivery notes into items', () => {
    expect(read('Call me at 9840012345 tomorrow 5 pm, delivery in 10 days')).toEqual([]);
    expect(read('Delivery by 25')).toEqual([]);
    expect(read('Size A4 300 gsm')).toEqual([]);
    expect(read('Calendars as per the voice note')).toEqual([]);
  });

  it('lists a product once when the title and the voice note both mention it', () => {
    expect(read('500 wall calendars\nwall calendar')).toEqual([['Wall Calendar', 500, null, null]]);
  });
});

describe('Reading an enquiry to fill the quotation', () => {
  let app: INestApplication;
  let baseUrl: string;
  let reader: QuoteReaderService;
  let model: jest.SpyInstance;
  let local: jest.SpyInstance;
  let ocr: jest.SpyInstance;
  let pdfText: jest.SpyInstance;

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
    local = jest.spyOn(reader as any, 'callLocalModel');
    ocr = jest.spyOn(fixture.get(DocumentTextService), 'ocrImage');
    pdfText = jest.spyOn(fixture.get(DocumentTextService), 'pdfText');
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
    delete process.env.OLLAMA_URL;
    model.mockReset();
    local.mockReset();
    ocr.mockReset();
    pdfText.mockReset().mockResolvedValue('');
  });
  afterAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await app.close();
  });

  it('with no AI configured, still fills lines from the typed and spoken words, and calls nothing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const e = await enquire();
    await upload(e.lead.id, Buffer.from('opus'), 'v.webm', 'audio/webm', { transcript: 'also 20 boxes of visiting cards at 340' });
    const res = await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id });
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.mode).toBe('basic');
    expect(out.lines.map((l: any) => [l.itemName, l.quantity, l.unitPrice])).toEqual([['Wall Calendar', 500, 85], ['Visiting Card', 20, 340]]);
    expect(model).not.toHaveBeenCalled();
  });

  it('when two places give different quantities for the same item, keeps the first and tells staff to check', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const e = await enquire(); // 500 wall calendars as in the sketch
    await upload(e.lead.id, Buffer.from('opus'), 'v.webm', 'audio/webm', { transcript: 'make it 600 wall calendars, and 20 visiting cards' });
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(out.lines.map((l: any) => [l.itemName, l.quantity])).toEqual([['Wall Calendar', 500], ['Visiting Card', 20]]);
    expect(out.skipped.join(' ')).toMatch(/Wall Calendar: 500 in "Enquiry" but 600 in "Voice note \(as written down\)"\. Used 500; please check/);
  });

  it('with no AI, reads the text inside a PDF', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const e = await enquire('Requirement is in the attached list');
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.text('Order list\n1. 300 wall calendars\n2. visiting cards - 15 box @ 360');
    doc.end();
    await new Promise((r) => doc.on('end', r));
    await upload(e.lead.id, Buffer.concat(chunks), 'list.pdf', 'application/pdf');
    // pdf.js cannot start inside jest's sandbox (it needs a dynamic import); it is checked for real against the running API
    pdfText.mockResolvedValue('Order list\n1. 300 wall calendars\n2. visiting cards - 15 box @ 360\n\n-- 1 of 1 --');
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(out.lines.map((l: any) => [l.itemName, l.quantity, l.unitPrice])).toEqual([['Wall Calendar', 300, 85], ['Visiting Card', 15, 360]]);
    expect(out.sources).toContain('list.pdf');
  });

  const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  it('with no AI, reads a Word file: paragraphs and the rows of a table', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const e = await enquire('Requirement is in the attached Word file');
    const w = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    const row = (...cells: string[]) => `<w:tr>${cells.map((c) => `<w:tc>${w(c)}</w:tc>`).join('')}</w:tr>`;
    const docx = zip({
      'word/document.xml': `<?xml version="1.0"?><w:document><w:body>${w('Please quote &amp; send')}<w:tbl>${row('Visiting cards', '15 box', '@ 360')}</w:tbl>${w('300 wall calendars')}</w:body></w:document>`,
    });
    await upload(e.lead.id, docx, 'enquiry.docx', DOCX_TYPE);
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(out.sources).toContain('enquiry.docx');
    expect(out.skipped.join(' ')).not.toMatch(/enquiry\.docx/);
    expect(out.lines.map((l: any) => [l.itemName, l.quantity])).toEqual(expect.arrayContaining([['Wall Calendar', 300], ['Visiting Card', 15]]));
  });

  it('with no AI, reads an Excel file: shared strings, numbers and inline text, by column', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const e = await enquire('Requirement is in the attached sheet');
    const xlsx = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Order" sheetId="1"/></sheets></workbook>',
      'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Qty</t></si><si><t>Wall Calendar</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>300</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>Visiting Card</t></is></c><c r="C3"><v>15</v></c></row>' +
        '</sheetData></worksheet>',
    });
    const text = new DocumentTextService().officeText(xlsx, 'xlsx');
    expect(text).toBe('Sheet Order:\nItem | Qty\nWall Calendar | 300\nVisiting Card |  | 15');
    await upload(e.lead.id, xlsx, 'order.xlsx', XLSX_TYPE);
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(out.sources).toContain('order.xlsx');
  });

  it('shows the AI reader the Word and Excel text, and says plainly when a file cannot be opened or is the old format', async () => {
    const e = await enquire('See the files');
    await upload(e.lead.id, zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Need 40 kg MS Flat 25x5</w:t></w:r></w:p></w:body></w:document>' }), 'need.docx', DOCX_TYPE);
    await upload(e.lead.id, Buffer.from('not a zip'), 'broken.xlsx', XLSX_TYPE);
    await upload(e.lead.id, Buffer.from('old'), 'old.xls', 'application/vnd.ms-excel');
    modelAnswers({ lines: [{ itemName: 'MS Flat', description: '25x5', quantity: 40, unit: 'Kg' }] });
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    const sent = JSON.stringify(model.mock.calls[0][0]);
    expect(sent).toContain('Word file need.docx');
    expect(sent).toContain('Need 40 kg MS Flat 25x5');
    expect(out.skipped.join(' ')).toMatch(/broken\.xlsx could not be opened/);
    expect(out.skipped.join(' ')).toMatch(/old\.xls is an old-format/);
  });

  it('refuses a zip that opens into something enormous, without reading it', () => {
    const big = zip({ 'word/document.xml': `<w:document>${'a'.repeat(31 * 1024 * 1024)}</w:document>` });
    expect(big.length).toBeLessThan(200 * 1024);
    expect(new DocumentTextService().officeText(big, 'docx')).toBe('');
  });

  it('with no AI, reads printed text in a photo, but not a photo that looks handwritten', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const e = await enquire('Requirement is in the photo');
    const png = readFileSync(join(__dirname, 'fixtures', 'printed-request.png'));
    await upload(e.lead.id, png, 'printed.png', 'image/png');
    await upload(e.lead.id, Buffer.from('scribble'), 'handwritten.jpg', 'image/jpeg');
    ocr.mockImplementation(async (data: Buffer) =>
      data.equals(png) ? { text: 'Need 500 wall calendars\n20 boxes visiting cards @ 350', confidence: 95 } : { text: 'n3d 5oo ca1.. ??', confidence: 31 }
    );
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(out.lines.map((l: any) => [l.itemName, l.quantity, l.unitPrice])).toEqual([['Wall Calendar', 500, 85], ['Visiting Card', 20, 350]]);
    expect(out.skipped.join(' ')).toMatch(/handwritten\.jpg looks handwritten/);
    expect(out.skipped.join(' ')).not.toMatch(/printed\.png/);
  });

  it('the OCR engine really reads the printed sample (skipped quietly where it cannot start)', async () => {
    const svc = new DocumentTextService();
    const real = await svc.ocrImage(readFileSync(join(__dirname, 'fixtures', 'printed-request.png')));
    await svc.onModuleDestroy();
    if (!real) return; // engine or its language file not available on this machine
    expect(real.confidence).toBeGreaterThan(60);
    expect(real.text.toLowerCase()).toContain('wall calendars');
  }, 60_000);

  it('uses a vision model on this machine for photos when one is configured, and merges it with the written words', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OLLAMA_URL = 'http://localhost:11434';
    const e = await enquire('Requirement is in the photo');
    await upload(e.lead.id, Buffer.from('png'), 'hand.png', 'image/png');
    local.mockResolvedValue({ summary: 'Cards', lines: [{ itemName: 'Visiting cards', quantity: 40, unit: 'Box' }], unreadable: ['corner'] });
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(out.mode).toBe('local-ai');
    expect(out.lines.map((l: any) => [l.itemName, l.quantity])).toEqual([['Visiting Card', 40]]);
    expect(local.mock.calls[0][1]).toHaveLength(1); // the photo went to the local model
    expect(model).not.toHaveBeenCalled();
    const { BadGatewayException } = await import('@nestjs/common');
    local.mockRejectedValue(new BadGatewayException('The reading model on this server could not be reached.'));
    const down = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(down.skipped.join(' ')).toMatch(/could not be reached/);
  });

  it('falls back to the written words when the AI service is down, instead of failing', async () => {
    const e = await enquire(); // title: 500 wall calendars as in the sketch
    await upload(e.lead.id, Buffer.from('png'), 's.png', 'image/png');
    model.mockImplementation(async () => {
      const { BadGatewayException } = await import('@nestjs/common');
      throw new BadGatewayException('The reading service is busy. Try again in a minute.');
    });
    const res = await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id });
    expect(res.status).toBe(201);
    const out = await res.json();
    expect(out.lines.map((l: any) => [l.itemName, l.quantity])).toEqual([['Wall Calendar', 500]]);
    expect(out.skipped.join(' ')).toMatch(/busy.*typed and spoken words only/);
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
    expect(out.mode).toBe('ai');
    expect(out.lines).toHaveLength(3);
    expect(out.lines[0]).toMatchObject({ itemName: 'Wall Calendar', quantity: 500, unitPrice: 85, taxPercent: 12, hsnCode: '4910', missing: [] });
    expect(out.lines[1]).toMatchObject({ itemName: 'Visiting Card', quantity: 20, unitPrice: 350, hsnCode: '4911' });
    expect(out.lines[2]).toMatchObject({ itemName: 'Gold foil box', productId: null, missing: expect.arrayContaining(['quantity', 'rate']) });
    expect(out.skipped.join(' ')).toMatch(/bottom of the sketch/);

    // what actually went to the model
    const body = model.mock.calls[0][0] as any;
    expect(body.tool_choice).toEqual({ type: 'auto' });
    const kinds = body.messages[0].content.map((b: any) => b.type);
    expect(kinds).toEqual(expect.arrayContaining(['text', 'image', 'document']));
    const text = body.messages[0].content[0].text as string;
    expect(text).toContain('500 wall calendars as in the sketch');
    expect(text).toContain('twenty boxes of visiting cards');
    expect(text).toMatch(/Wall Calendar \| Nos/); // the product list, for matching
    expect(JSON.stringify(body)).not.toContain('test-key');
    // the reader is told to keep sizes out of the name, and that a measurement is not a quantity
    expect(body.system).toMatch(/WITHOUT sizes/);
    expect(body.system).toMatch(/NOT a quantity/);
    expect(body.system).toMatch(/never guess one/);
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

  it('skips a Word file that cannot be opened with a note, and does not call the reader when there is nothing to read', async () => {
    const e = await enquire('x');
    await upload(e.lead.id, Buffer.from('doc'), 'spec.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    modelAnswers({ lines: [{ itemName: 'x' }] });
    const out = await (await json(owner, '/sales/quotations/suggest', { leadId: e.lead.id })).json();
    expect(out.skipped.join(' ')).toMatch(/spec\.docx could not be opened/);
  });

  it('turns a reader failure into a clear message when there is nothing else to go on, and never shows the key', async () => {
    const e = await enquire('As per the attached sketch');
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
