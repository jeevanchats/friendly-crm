import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import { globalMemoryTenants, globalMemoryTasks, globalMemoryLeads } from '../src/modules/crm/memory-store';

/**
 * An enquiry's first job is sending the customer a quote. That must be visible (a "Quotes to send" list), be the
 * task the person is reminded about, and settle itself the moment the quote is made.
 */
describe('Enquiry -> send quote -> follow up on the quote', () => {
  let app: INestApplication;
  let baseUrl: string;

  const T = '82828282-8282-4828-8828-828282828282';
  const OWNER = '11111111-8282-4828-8828-828282828282';
  const SALES = '22222222-8282-4828-8828-828282828282';
  let owner: string;
  let sales: string;
  let phoneSeq = 0;

  const http = (token: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${baseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': T, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  const enquire = async (name: string, extra: Record<string, unknown> = {}, token = owner) => {
    const res = await http(token, '/crm/intake-lead', {
      method: 'POST',
      body: {
        name,
        customerName: name,
        phone: `98409970${String(++phoneSeq).padStart(2, '0')}`,
        title: `${name} wants 500 wall calendars`,
        source: 'PHONE',
        customData: { job_type: 'CALENDAR' },
        ...extra,
      },
    });
    expect(res.status).toBe(201);
    return res.json();
  };
  const dashboard = async (token = owner) => (await http(token, '/crm/dashboard')).json();
  const quoteFor = (customerId: string, extra: Record<string, unknown> = {}) =>
    http(owner, '/sales/quotations', {
      method: 'POST',
      body: { customerId, items: [{ itemName: 'Wall Calendar', quantity: 500, unitPrice: 85, taxPercent: 12, hsnCode: '4910' }], ...extra },
    });
  const tasksOf = (leadId: string) => globalMemoryTasks.filter((t: any) => t.leadId === leadId && t.tenantId === T);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    const auth = fixture.get(AuthService);
    globalMemoryTenants.set(T, { id: T, name: 'Enquiry Press', industryKey: 'printing', defaultLanguage: 'en', phone: '+919999988888', isActive: true } as any);
    auth.registerUser({ id: OWNER, fullName: 'E Owner', phone: '+919840997101' });
    auth.registerUser({ id: SALES, fullName: 'E Sales', phone: '+919840997102' });
    auth.registerMembership(T, OWNER, 'OWNER', true);
    auth.registerMembership(T, SALES, 'SALESPERSON', true);
    const login = async (phone: string) => {
      await auth.requestOtp({ phone, countryCode: '+91' });
      const code = DevSmsGateway.getLatestOtp(auth.normalizePhone(phone))!;
      return (await auth.verifyOtp({ phone, code, tenantId: T })).token;
    };
    owner = await login('+919840997101');
    sales = await login('+919840997102');
  });

  afterAll(async () => {
    await app.close();
  });

  it('turns a saved enquiry into a "send quote" job, due soon, listed under Quotes to send', async () => {
    const before = (await dashboard()).summaryCards.quotesToSend;
    const e = await enquire('Anand Traders');
    expect(e.lead.stage).toBe('NEW');
    expect(e.followUpTask.type).toBe('SEND_QUOTE');
    expect(e.followUpTask.title).toMatch(/^Send quote to Anand Traders: /);
    const hours = (new Date(e.followUpTask.dueAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(3.9);
    expect(hours).toBeLessThan(4.1);

    const d = await dashboard();
    expect(d.summaryCards.quotesToSend).toBe(before + 1);
    const row = d.pendingQuotes.find((q: any) => q.leadId === e.lead.id);
    expect(row).toMatchObject({ customerId: e.customer.id, customerName: 'Anand Traders', title: expect.stringContaining('500 wall calendars') });
    expect(row.customerPhone).toMatch(/^\+91/);
    expect(row.dueAt).toBeTruthy();
  });

  it('keeps the send-quote job out of the ordinary follow-up queue, even when it is overdue', async () => {
    const e = await enquire('Overdue Traders', { followUpDueAt: new Date(Date.now() - 60_000).toISOString() });
    const d = await dashboard();
    expect(d.pendingQuotes.some((q: any) => q.leadId === e.lead.id)).toBe(true);
    expect(d.priorityTasks.some((t: any) => t.id === e.followUpTask.id)).toBe(false);
    expect(d.priorityTasks.every((t: any) => t.type !== 'SEND_QUOTE')).toBe(true);
  });

  it('lists the enquiry whatever its due date: one due next week is still waiting for a quote', async () => {
    const e = await enquire('Later Traders', { followUpDueAt: new Date(Date.now() + 7 * 86400000).toISOString() });
    expect((await dashboard()).pendingQuotes.some((q: any) => q.leadId === e.lead.id)).toBe(true);
  });

  it('settles the job when the quote is made, and schedules a follow-up on that quote two days out', async () => {
    const e = await enquire('Quoted Traders');
    const res = await quoteFor(e.customer.id, { leadId: e.lead.id });
    expect(res.status).toBe(201);
    const quote = await res.json();

    expect(globalMemoryLeads.find((l: any) => l.id === e.lead.id)!.stage).toBe('QUOTED');
    const sendJob = tasksOf(e.lead.id).find((t: any) => t.type === 'SEND_QUOTE')!;
    expect(sendJob.status).toBe('COMPLETED');
    expect(sendJob.outcomeNote).toContain(quote.quoteNumber);

    const follow = tasksOf(e.lead.id).find((t: any) => t.type === 'FOLLOW_UP_CALL' && t.status === 'PENDING')!;
    expect(follow.title).toBe(`Follow up on quote ${quote.quoteNumber} with Quoted Traders`);
    const days = (new Date(follow.dueAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(1.99);
    expect(days).toBeLessThan(2.01);
    expect((await dashboard()).pendingQuotes.some((q: any) => q.leadId === e.lead.id)).toBe(false);
  });

  it('a quote made from the customer page (no enquiry named) answers their open enquiry', async () => {
    const e = await enquire('Customer Page Traders');
    const quote = await (await quoteFor(e.customer.id)).json();
    expect(quote.leadId).toBe(e.lead.id);
    expect(globalMemoryLeads.find((l: any) => l.id === e.lead.id)!.stage).toBe('QUOTED');
    expect((await dashboard()).pendingQuotes.some((q: any) => q.leadId === e.lead.id)).toBe(false);
  });

  it('a quote for a customer with no open enquiry still gets a follow-up', async () => {
    const e = await enquire('Repeat Traders');
    await quoteFor(e.customer.id, { leadId: e.lead.id }); // closes the only enquiry
    const second = await (await quoteFor(e.customer.id)).json();
    expect(second.leadId).toBeNull();
    const follow = globalMemoryTasks.find((t: any) => t.title === `Follow up on quote ${second.quoteNumber} with Repeat Traders`);
    expect(follow).toBeTruthy();
    expect(follow!.status).toBe('PENDING');
  });

  it('moves the follow-up to the new version when the quote is revised, and closes it when the customer accepts', async () => {
    const e = await enquire('Revised Traders');
    const v1 = await (await quoteFor(e.customer.id, { leadId: e.lead.id })).json();
    const title = `Follow up on quote ${v1.quoteNumber} with Revised Traders`;
    const pending = () => globalMemoryTasks.filter((t: any) => t.title === title && t.status === 'PENDING');
    expect(pending()).toHaveLength(1);

    const v2 = await (await http(owner, `/sales/quotations/${v1.id}/revise`, { method: 'POST', body: { items: [{ itemName: 'Wall Calendar', quantity: 400, unitPrice: 85, taxPercent: 12 }] } })).json();
    expect(v2.version).toBe(2);
    expect(pending()).toHaveLength(1); // the old one was cancelled, one new one stands
    expect(globalMemoryTasks.filter((t: any) => t.title === title && t.status === 'CANCELLED')).toHaveLength(1);

    const conv = await http(owner, `/sales/quotations/${v2.id}/convert`, { method: 'POST', body: { industryKey: 'printing' } });
    expect(conv.status).toBe(201);
    expect(pending()).toHaveLength(0);
    expect(globalMemoryTasks.filter((t: any) => t.title === title && t.status === 'COMPLETED' && t.outcomeNote === 'Customer approved the quote')).toHaveLength(1);
  });

  it('closing an enquiry as lost removes it from Quotes to send and cancels its send-quote job', async () => {
    const e = await enquire('Lost Traders');
    const res = await http(owner, `/crm/leads/${e.lead.id}/stage`, { method: 'PATCH', body: { stage: 'LOST', notes: 'Went elsewhere' } });
    expect(res.status).toBe(200);
    expect(tasksOf(e.lead.id).find((t: any) => t.type === 'SEND_QUOTE')!.status).toBe('CANCELLED');
    expect((await dashboard()).pendingQuotes.some((q: any) => q.leadId === e.lead.id)).toBe(false);
  });

  it('an enquiry that is already past the quoting stage just gets an ordinary follow-up', async () => {
    const e = await enquire('Already Quoted Traders', { stage: 'QUOTED' });
    expect(e.followUpTask.type).toBe('FOLLOW_UP_CALL');
    expect(e.followUpTask.title).toMatch(/^Follow up with Already Quoted Traders/);
    expect((await dashboard()).pendingQuotes.some((q: any) => q.leadId === e.lead.id)).toBe(false);
  });

  it('a salesperson sees only the enquiries assigned to them', async () => {
    const mine = await enquire('Sales Own Traders', {}, sales);
    const theirs = await enquire('Owner Own Traders', {}, owner);
    const d = await dashboard(sales);
    const ids = d.pendingQuotes.map((q: any) => q.leadId);
    expect(ids).toContain(mine.lead.id);
    expect(ids).not.toContain(theirs.lead.id);
    expect(d.summaryCards.quotesToSend).toBe(d.pendingQuotes.length);
  });

  it('lists the oldest enquiry first, so nothing waits forever behind newer ones', async () => {
    const d = await dashboard();
    const times = d.pendingQuotes.map((q: any) => +new Date(q.createdAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
