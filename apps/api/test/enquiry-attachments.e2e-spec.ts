import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants } from '../src/modules/crm/memory-store';
import { validateAttachment, attachmentKindFor, sanitizeFileName, MAX_ATTACHMENTS_PER_LEAD, MAX_FILE_BYTES, MAX_VOICE_BYTES } from '@friendly-crm/shared';

describe('attachment rules (shared)', () => {
  it('tells voice notes from files and refuses what is not on the list', () => {
    expect(attachmentKindFor('audio/webm;codecs=opus')).toBe('VOICE');
    expect(attachmentKindFor('application/pdf')).toBe('FILE');
    expect(attachmentKindFor('image/svg+xml')).toBeNull(); // can carry script
    expect(attachmentKindFor('text/html')).toBeNull();
    expect(attachmentKindFor('application/x-msdownload')).toBeNull();
  });

  it('enforces size by kind, and refuses an empty file', () => {
    expect(validateAttachment({ mimeType: 'audio/webm', size: MAX_VOICE_BYTES }).ok).toBe(true);
    expect(validateAttachment({ mimeType: 'audio/webm', size: MAX_VOICE_BYTES + 1 }).ok).toBe(false);
    expect(validateAttachment({ mimeType: 'application/pdf', size: MAX_FILE_BYTES }).ok).toBe(true);
    expect(validateAttachment({ mimeType: 'application/pdf', size: MAX_FILE_BYTES + 1 }).reason).toMatch(/at most 10 MB/);
    expect(validateAttachment({ mimeType: 'image/png', size: 0 }).reason).toMatch(/empty/);
  });

  it('keeps only a safe readable file name', () => {
    expect(sanitizeFileName('C:\\Users\\me\\..\\design brief.pdf')).toBe('design brief.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('  ..hidden<>.png ')).toBe('hidden.png');
    expect(sanitizeFileName('', 'voice-note')).toBe('voice-note');
  });
});

describe('Enquiry attachments: voice note and files for the person preparing the quote', () => {
  let app: INestApplication;
  let baseUrl: string;

  const T = '83838383-8383-4838-8838-838383838383';
  const OTHER_T = '84848484-8484-4848-8848-848484848484';
  const OWNER = '11111111-8383-4838-8838-838383838383';
  const PROD = '22222222-8383-4838-8838-838383838383';
  const STRANGER = '33333333-8383-4838-8838-838383838383';
  let owner: string;
  let production: string;
  let stranger: string;
  let phoneSeq = 0;

  const auth = (token: string, tenant = T) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenant });
  const json = (token: string, path: string, init: { method?: string; body?: unknown; tenant?: string } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: { ...auth(token, init.tenant), ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  const upload = (token: string, leadId: string, bytes: Buffer, name: string, type: string, extra: Record<string, string> = {}, tenant = T) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type }), name);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return fetch(`${baseUrl}/api/crm/leads/${leadId}/attachments`, { method: 'POST', headers: auth(token, tenant), body: form });
  };
  const enquire = async () => {
    const res = await json(owner, '/crm/intake-lead', {
      method: 'POST',
      body: {
        name: 'Attach Traders',
        customerName: 'Attach Traders',
        phone: `98409980${String(++phoneSeq).padStart(2, '0')}`,
        title: 'Calendars as per the voice note',
        source: 'PHONE',
        customData: { job_type: 'CALENDAR' },
      },
    });
    expect(res.status).toBe(201);
    return res.json();
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const a = fixture.get(AuthService);
    globalMemoryTenants.set(T, { id: T, name: 'Attach Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999977777', isActive: true } as any);
    globalMemoryTenants.set(OTHER_T, { id: OTHER_T, name: 'Other Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999966666', isActive: true } as any);
    a.registerUser({ id: OWNER, fullName: 'A Owner', phone: '+919840998101' });
    a.registerUser({ id: PROD, fullName: 'A Floor', phone: '+919840998102' });
    a.registerUser({ id: STRANGER, fullName: 'B Owner', phone: '+919840998103' });
    a.registerMembership(T, OWNER, 'OWNER', true);
    a.registerMembership(T, PROD, 'PRODUCTION', true);
    a.registerMembership(OTHER_T, STRANGER, 'OWNER', true);
    const login = async (phone: string, tenantId: string) => {
      await a.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(a.normalizePhone(phone))!;
      return (await a.verifyOtp({ phone, code, tenantId })).token;
    };
    owner = await login('+919840998101', T);
    production = await login('+919840998102', T);
    stranger = await login('+919840998103', OTHER_T);
  });

  afterAll(async () => {
    await app.close();
  });

  it('saves a voice note and a file against an enquiry and lists both', async () => {
    const e = await enquire();
    const voice = await upload(owner, e.lead.id, Buffer.from('fake-opus-bytes'), 'voice-note.webm', 'audio/webm;codecs=opus', { durationSeconds: '42' });
    expect(voice.status).toBe(201);
    expect(await voice.json()).toMatchObject({ kind: 'VOICE', mimeType: 'audio/webm', durationSeconds: 42, leadId: e.lead.id });

    const pdf = await upload(owner, e.lead.id, Buffer.from('%PDF-1.4 fake'), 'brief.pdf', 'application/pdf');
    expect(pdf.status).toBe(201);

    const list = await (await json(owner, `/crm/attachments?leadId=${e.lead.id}`)).json();
    expect(list.map((a: any) => a.kind).sort()).toEqual(['FILE', 'VOICE']);
    expect(list.every((a: any) => a.leadTitle === 'Calendars as per the voice note')).toBe(true);
    expect(list[0].data).toBeUndefined(); // listing never carries the bytes
  });

  it('finds the enquiry attachments from the customer, which is how New Quote is opened from the customer page', async () => {
    const e = await enquire();
    await upload(owner, e.lead.id, Buffer.from('bytes'), 'voice-note.webm', 'audio/webm');
    const list = await (await json(owner, `/crm/attachments?customerId=${e.customer.id}`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].leadId).toBe(e.lead.id);
  });

  it('downloads exactly the bytes that were saved; voice and PDF play inline, a Word file only downloads', async () => {
    const e = await enquire();
    const bytes = Buffer.from([1, 2, 3, 250, 251, 252, 0, 7]);
    const a = await (await upload(owner, e.lead.id, bytes, 'voice-note.webm', 'audio/webm')).json();
    const got = await fetch(`${baseUrl}/api/crm/attachments/${a.id}/file`, { headers: auth(owner) });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('audio/webm');
    expect(got.headers.get('content-disposition')).toMatch(/^inline/);
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await got.arrayBuffer()).equals(bytes)).toBe(true);

    const doc = await (await upload(owner, e.lead.id, Buffer.from('doc'), 'spec.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).json();
    const dl = await fetch(`${baseUrl}/api/crm/attachments/${doc.id}/file`, { headers: auth(owner) });
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/);
  });

  it('refuses types that could carry script, empty files and files that are too large', async () => {
    const e = await enquire();
    expect((await upload(owner, e.lead.id, Buffer.from('<svg onload=alert(1)>'), 'x.svg', 'image/svg+xml')).status).toBe(400);
    expect((await upload(owner, e.lead.id, Buffer.from('<script>'), 'x.html', 'text/html')).status).toBe(400);
    expect((await upload(owner, e.lead.id, Buffer.alloc(0), 'empty.pdf', 'application/pdf')).status).toBe(400);
    const big = await upload(owner, e.lead.id, Buffer.alloc(MAX_FILE_BYTES + 1024), 'huge.pdf', 'application/pdf');
    expect(big.status).toBe(413);
    const bigVoice = await upload(owner, e.lead.id, Buffer.alloc(MAX_VOICE_BYTES + 1024), 'long.webm', 'audio/webm');
    expect(bigVoice.status).toBe(400);
    expect(await (await json(owner, `/crm/attachments?leadId=${e.lead.id}`)).json()).toHaveLength(0);
  });

  it('stops at the per-enquiry limit', async () => {
    const e = await enquire();
    for (let i = 0; i < MAX_ATTACHMENTS_PER_LEAD; i++) {
      expect((await upload(owner, e.lead.id, Buffer.from(`f${i}`), `f${i}.pdf`, 'application/pdf')).status).toBe(201);
    }
    const over = await upload(owner, e.lead.id, Buffer.from('one more'), 'extra.pdf', 'application/pdf');
    expect(over.status).toBe(400);
    expect((await over.json()).message).toMatch(/at most 10/);
  });

  it('can remove an attachment, and a second removal is a 404', async () => {
    const e = await enquire();
    const a = await (await upload(owner, e.lead.id, Buffer.from('x'), 'a.pdf', 'application/pdf')).json();
    expect((await json(owner, `/crm/attachments/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await json(owner, `/crm/attachments/${a.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/crm/attachments/${a.id}/file`, { headers: auth(owner) })).status).toBe(404);
  });

  it('keeps one business out of another business\'s attachments', async () => {
    const e = await enquire();
    const a = await (await upload(owner, e.lead.id, Buffer.from('secret brief'), 'brief.pdf', 'application/pdf')).json();
    expect((await fetch(`${baseUrl}/api/crm/attachments/${a.id}/file`, { headers: auth(stranger, OTHER_T) })).status).toBe(404);
    expect((await upload(stranger, e.lead.id, Buffer.from('x'), 'x.pdf', 'application/pdf', {}, OTHER_T)).status).toBe(404);
    expect(await (await json(stranger, `/crm/attachments?leadId=${e.lead.id}`, { tenant: OTHER_T })).json()).toEqual([]);
  });

  it('does not let a role without enquiry access add or read them', async () => {
    const e = await enquire();
    expect((await upload(production, e.lead.id, Buffer.from('x'), 'x.pdf', 'application/pdf')).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/crm/attachments?leadId=${e.lead.id}`, { headers: auth(production) })).status).toBe(403);
  });

  it('answers 400 for a missing file and for a malformed enquiry id', async () => {
    const e = await enquire();
    const empty = await fetch(`${baseUrl}/api/crm/leads/${e.lead.id}/attachments`, { method: 'POST', headers: auth(owner), body: new FormData() });
    expect(empty.status).toBe(400);
    expect((await upload(owner, 'not-a-uuid', Buffer.from('x'), 'x.pdf', 'application/pdf')).status).toBe(400);
  });
});
