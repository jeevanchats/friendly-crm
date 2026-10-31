import { createHmac, randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { TwilioWhatsAppAdapter, splitForWhatsApp, toTwilioWhatsApp } from '../src/modules/notifications/adapters/twilio-whatsapp.adapter';
import { DevNotificationAdapter } from '../src/modules/notifications/adapters/dev-notification.adapter';
import { NotificationOutboxService } from '../src/modules/notifications/notification-outbox.service';
import { TenantNotificationProviderManager } from '../src/modules/notifications/adapters/tenant-provider-manager';
import { verifyTwilioSignature } from '../src/modules/notifications/webhook-verification.util';
import { parseInboundMessages, parseStatusUpdates, webhookEventKeys } from '../src/modules/whatsapp/bot/inbound-parser';
import { globalMemoryOutbox } from '../src/modules/crm/memory-store';

const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: 'ACtest0000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'test-auth-token',
  TWILIO_WHATSAPP_FROM: '+14155238886',
};
const setEnv = (env: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(env)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
};
const clearEnv = () => setEnv({ ...Object.fromEntries(Object.keys(TWILIO_ENV).map((k) => [k, undefined])), TWILIO_MESSAGING_SERVICE_SID: undefined, TWILIO_API_KEY_SID: undefined, TWILIO_API_KEY_SECRET: undefined, TWILIO_STATUS_CALLBACK_URL: undefined, TWILIO_WEBHOOK_URL: undefined });

describe('Twilio request signature', () => {
  it("matches the worked example in Twilio's own documentation", () => {
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' };
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    expect(verifyTwilioSignature(url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=', '12345')).toBe(true);
  });

  it('refuses a changed field, a changed address, a wrong token, and a missing signature', () => {
    const params = { Body: 'hi', From: 'whatsapp:+919876543210' };
    const url = 'https://api.example.in/api/notifications/twilio/webhook';
    const sig = createHmac('sha1', 'tok').update(url + 'Body' + 'hi' + 'From' + 'whatsapp:+919876543210').digest('base64');
    expect(verifyTwilioSignature(url, params, sig, 'tok')).toBe(true);
    expect(verifyTwilioSignature(url, { ...params, Body: 'hello' }, sig, 'tok')).toBe(false);
    expect(verifyTwilioSignature(url + '?x=1', params, sig, 'tok')).toBe(false);
    expect(verifyTwilioSignature(url, params, sig, 'other')).toBe(false);
    expect(verifyTwilioSignature(url, params, undefined, 'tok')).toBe(false);
    expect(verifyTwilioSignature(url, params, 'not-base64-of-the-right-length', 'tok')).toBe(false);
  });
});

describe('Sending through Twilio', () => {
  const adapter = new TwilioWhatsAppAdapter();
  let fetchSpy: jest.SpyInstance;
  const reply = (status: number, body: unknown) => fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  const sent = (n = 0) => {
    const [url, init] = fetchSpy.mock.calls[n];
    return { url: String(url), headers: init.headers as Record<string, string>, form: new URLSearchParams(init.body as string) };
  };
  const send = (over: Record<string, unknown> = {}) => adapter.sendMessage({ tenantId: 't', recipient: '+919876543210', message: 'Hello', channel: 'WHATSAPP', ...over } as any);

  beforeEach(() => {
    clearEnv();
    setEnv(TWILIO_ENV);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    clearEnv();
  });

  it('formats numbers the way Twilio wants and splits long text at line ends', () => {
    expect(toTwilioWhatsApp('+91 98765-43210')).toBe('whatsapp:+919876543210');
    expect(toTwilioWhatsApp('whatsapp:+14155238886')).toBe('whatsapp:+14155238886');
    const long = Array.from({ length: 60 }, (_, i) => `Line ${i} ${'x'.repeat(40)}`).join('\n');
    const parts = splitForWhatsApp(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1500)).toBe(true);
    expect(parts.join('\n')).toBe(long);
    expect(splitForWhatsApp('short')).toEqual(['short']);
  });

  it('posts To, From and Body to the account Messages endpoint with the account credentials, and returns the message sid', async () => {
    reply(201, { sid: 'SM123', status: 'queued' });
    const out = await send();
    expect(out).toEqual({ success: true, provider: 'twilio-whatsapp', messageId: 'SM123' });
    const call = sent();
    expect(call.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ENV.TWILIO_ACCOUNT_SID}/Messages.json`);
    expect(call.headers.authorization).toBe(`Basic ${Buffer.from(`${TWILIO_ENV.TWILIO_ACCOUNT_SID}:${TWILIO_ENV.TWILIO_AUTH_TOKEN}`).toString('base64')}`);
    expect(Object.fromEntries(call.form)).toEqual({ To: 'whatsapp:+919876543210', From: 'whatsapp:+14155238886', Body: 'Hello' });
  });

  it('can send with an API key, through a messaging service, with a picture, and ask for delivery reports', async () => {
    setEnv({ TWILIO_API_KEY_SID: 'SKkey', TWILIO_API_KEY_SECRET: 'secret', TWILIO_MESSAGING_SERVICE_SID: 'MGsvc', TWILIO_STATUS_CALLBACK_URL: 'https://api.example.in/api/notifications/twilio/webhook' });
    reply(201, { sid: 'SM9' });
    await send({ mediaUrl: 'https://api.example.in/q/abc.pdf' });
    const call = sent();
    expect(call.headers.authorization).toBe(`Basic ${Buffer.from('SKkey:secret').toString('base64')}`);
    expect(call.form.get('MessagingServiceSid')).toBe('MGsvc');
    expect(call.form.has('From')).toBe(false);
    expect(call.form.get('MediaUrl')).toBe('https://api.example.in/q/abc.pdf');
    expect(call.form.get('StatusCallback')).toBe('https://api.example.in/api/notifications/twilio/webhook');
  });

  it('sends a long message as several, the picture with the first', async () => {
    reply(201, { sid: 'SM-a' });
    reply(201, { sid: 'SM-b' });
    const long = Array.from({ length: 60 }, (_, i) => `Line ${i} ${'y'.repeat(40)}`).join('\n');
    const out = await send({ message: long, mediaUrl: 'https://x.in/a.pdf' });
    expect(out).toMatchObject({ success: true, messageId: 'SM-a' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sent(0).form.get('MediaUrl')).toBe('https://x.in/a.pdf');
    expect(sent(1).form.has('MediaUrl')).toBe(false);
  });

  it('says plainly why a message was refused, and whether trying again could help', async () => {
    reply(400, { code: 63016, message: 'Failed to send freeform message because you are outside the allowed window' });
    const outside = await send();
    expect(outside).toMatchObject({ success: false, retryable: false });
    expect(outside.error).toMatch(/not messaged in the last 24 hours.*approved WhatsApp template/);

    reply(400, { code: 63015, message: 'x' });
    expect((await send()).error).toMatch(/not joined the Twilio WhatsApp sandbox/);

    reply(400, { code: 21211, message: 'invalid' });
    expect(await send()).toMatchObject({ retryable: false });

    reply(429, { code: 20429, message: 'Too many requests' });
    expect(await send()).toMatchObject({ success: false, retryable: true });
    reply(503, {});
    expect(await send()).toMatchObject({ success: false, retryable: true });

    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await send()).toMatchObject({ success: false, retryable: true });
  });

  it('refuses to send without configuration, an empty message, or a non-WhatsApp channel, and never calls Twilio', async () => {
    clearEnv();
    expect(TwilioWhatsAppAdapter.isConfigured()).toBe(false);
    expect(await send()).toMatchObject({ success: false, retryable: false });
    setEnv(TWILIO_ENV);
    expect(TwilioWhatsAppAdapter.isConfigured()).toBe(true);
    expect(await send({ message: '' })).toMatchObject({ success: false, error: 'Nothing to send' });
    expect(await send({ channel: 'SMS' })).toMatchObject({ success: false });
    expect(await send({ recipient: '' })).toMatchObject({ success: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Reading what Twilio posts', () => {
  const inbound = (over: Record<string, string> = {}) => ({ MessageSid: 'SMin1', From: 'whatsapp:+919876543210', To: 'whatsapp:+14155238886', Body: 'hi', NumMedia: '0', SmsStatus: 'received', ...over });

  it('reads a text message, a tapped reply, and a photo or voice note', () => {
    expect(parseInboundMessages(inbound())).toEqual([{ id: 'SMin1', from: '+919876543210', type: 'text', text: 'hi' }]);
    expect(parseInboundMessages(inbound({ ButtonPayload: '2', ButtonText: 'Quotes' }))[0].text).toBe('2');
    expect(parseInboundMessages(inbound({ Body: '', NumMedia: '1', MediaUrl0: 'https://api.twilio.com/m', MediaContentType0: 'audio/ogg' }))).toEqual([{ id: 'SMin1', from: '+919876543210', type: 'media', text: '' }]);
  });

  it('does not treat a delivery report as a message, and maps its status', () => {
    const report = (status: string) => ({ MessageSid: 'SMout1', From: 'whatsapp:+14155238886', To: 'whatsapp:+919876543210', MessageStatus: status });
    expect(parseInboundMessages(report('delivered'))).toEqual([]);
    expect(parseStatusUpdates(report('delivered'))).toEqual([{ id: 'SMout1', status: 'DELIVERED' }]);
    expect(parseStatusUpdates(report('read'))).toEqual([{ id: 'SMout1', status: 'READ' }]);
    expect(parseStatusUpdates(report('failed'))).toEqual([{ id: 'SMout1', status: 'FAILED' }]);
    expect(parseStatusUpdates(report('undelivered'))).toEqual([{ id: 'SMout1', status: 'FAILED' }]);
    expect(parseStatusUpdates(report('queued'))).toEqual([]);
    expect(parseStatusUpdates(report('sent'))).toEqual([]);
    expect(webhookEventKeys(report('read'))).toContain('status:SMout1:READ');
    expect(webhookEventKeys(inbound())).toContain('msg:SMin1');
    expect(parseStatusUpdates(inbound())).toEqual([]); // an inbound message is not a report
  });
});

describe('The Twilio webhook and the message queue', () => {
  let app: INestApplication;
  let baseUrl: string;
  let outbox: NotificationOutboxService;
  const URL_AT_TWILIO = 'https://api.example.in/api/notifications/twilio/webhook';
  const TENANT = '33333333-3333-4333-8333-333333333333';

  const sign = (params: Record<string, string>, url = URL_AT_TWILIO, token = TWILIO_ENV.TWILIO_AUTH_TOKEN) =>
    createHmac('sha1', token).update(url + Object.keys(params).sort().map((k) => k + params[k]).join('')).digest('base64');
  const post = (params: Record<string, string>, signature: string | null = sign(params)) =>
    fetch(`${baseUrl}/api/notifications/twilio/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(signature ? { 'x-twilio-signature': signature } : {}) },
      body: new URLSearchParams(params).toString(),
    });
  const queued = (over: Record<string, unknown> = {}) => {
    const job: any = { id: randomUUID(), tenantId: TENANT, channel: 'WHATSAPP', recipient: '+919876543210', renderedMessage: 'x', status: 'SENT', attempts: 1, maxAttempts: 3, providerMessageId: `SM${randomUUID().slice(0, 8)}`, createdAt: new Date(), updatedAt: new Date(), ...over };
    globalMemoryOutbox.unshift(job);
    return job;
  };
  const report = (sid: string, status: string) => ({ MessageSid: sid, From: 'whatsapp:+14155238886', To: 'whatsapp:+919876543210', MessageStatus: status });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    outbox = fixture.get(NotificationOutboxService);
  });
  beforeEach(() => {
    clearEnv();
    setEnv({ TWILIO_AUTH_TOKEN: TWILIO_ENV.TWILIO_AUTH_TOKEN, TWILIO_WEBHOOK_URL: URL_AT_TWILIO });
    DevNotificationAdapter.clear();
  });
  afterAll(async () => {
    clearEnv();
    await app.close();
  });

  it('refuses calls with no signature, a wrong signature, a different address, and when the token or address is not set', async () => {
    const params = { MessageSid: 'SMx', From: 'whatsapp:+919000000001', Body: 'hi', NumMedia: '0' };
    expect((await post(params, null)).status).toBe(401);
    expect((await post(params, 'AAAA')).status).toBe(401);
    expect((await post(params, sign(params, 'https://evil.example/api/notifications/twilio/webhook'))).status).toBe(401);
    expect((await post(params, sign(params, URL_AT_TWILIO, 'a-different-token'))).status).toBe(401);
    setEnv({ TWILIO_WEBHOOK_URL: undefined });
    expect((await post(params)).status).toBe(401); // nothing says what address Twilio signed
    setEnv({ TWILIO_WEBHOOK_URL: URL_AT_TWILIO, TWILIO_AUTH_TOKEN: undefined });
    expect((await post(params)).status).toBe(401); // no token: there is no development bypass
  });

  it('builds the address from PUBLIC_API_URL when TWILIO_WEBHOOK_URL is not set', async () => {
    setEnv({ TWILIO_WEBHOOK_URL: undefined, PUBLIC_API_URL: 'https://api.example.in/' });
    const params = { MessageSid: `SM${randomUUID()}`, From: 'whatsapp:+919000000002', Body: 'hi', NumMedia: '0' };
    expect((await post(params)).status).toBe(200);
    delete process.env.PUBLIC_API_URL;
  });

  it('accepts a signed message, answers Twilio with empty TwiML, and the bot replies to the sender', async () => {
    const params = { MessageSid: `SM${randomUUID()}`, From: 'whatsapp:+919000000003', To: 'whatsapp:+14155238886', Body: 'hi', NumMedia: '0', SmsStatus: 'received' };
    const res = await post(params);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('xml');
    expect(await res.text()).toBe('<Response></Response>');
    const replies = DevNotificationAdapter.capturedMessages.filter((m) => m.recipient === '+919000000003');
    expect(replies).toHaveLength(1);
    expect(replies[0].message).toMatch(/registered with Friendly CRM/); // an unknown number is told so, and nothing else

    // The same message delivered again (Twilio retries) is answered once
    expect((await post(params)).status).toBe(200);
    expect(DevNotificationAdapter.capturedMessages.filter((m) => m.recipient === '+919000000003')).toHaveLength(1);
  });

  it('matches delivery reports to the queued message by the id Twilio gave it, and never steps back from read', async () => {
    const job = queued();
    expect((await post(report(job.providerMessageId, 'sent'))).status).toBe(200);
    expect(job.status).toBe('SENT'); // "sent" changes nothing
    await post(report(job.providerMessageId, 'delivered'));
    expect(job.status).toBe('DELIVERED');
    await post(report(job.providerMessageId, 'read'));
    expect(job.status).toBe('READ');
    await post(report(job.providerMessageId, 'delivered')); // arrives late
    expect(job.status).toBe('READ');

    const failing = queued();
    await post(report(failing.providerMessageId, 'undelivered'));
    expect(failing.status).toBe('DEAD_LETTER');

    const stranger = queued({ providerMessageId: 'SMother' });
    await post(report('SMunknown', 'delivered'));
    expect(stranger.status).toBe('SENT'); // an id nobody has changes nothing
  });

  it('remembers the id the provider gave when a message is sent, and does not retry a refusal that cannot change', async () => {
    const fake = { name: 'fake', sendMessage: jest.fn() };
    const spy = jest.spyOn(outbox, 'getAdapter').mockReturnValue(fake as any);
    try {
      fake.sendMessage.mockResolvedValueOnce({ success: true, messageId: 'SM-from-twilio', provider: 'fake' });
      const ok = await outbox.enqueueNotification({ tenantId: TENANT, recipient: '+919840000001', rawMessage: 'hello', maxAttempts: 5 });
      const sentJob = await outbox.dispatchJob(ok.id, TENANT);
      expect(sentJob).toMatchObject({ status: 'SENT', providerMessageId: 'SM-from-twilio' });

      fake.sendMessage.mockResolvedValueOnce({ success: false, error: 'outside the 24 hour window', retryable: false, provider: 'fake' });
      const hopeless = await outbox.enqueueNotification({ tenantId: TENANT, recipient: '+919840000002', rawMessage: 'hello', maxAttempts: 5 });
      expect(await outbox.dispatchJob(hopeless.id, TENANT)).toMatchObject({ status: 'DEAD_LETTER', attempts: 1 });

      fake.sendMessage.mockResolvedValueOnce({ success: false, error: 'timeout', retryable: true, provider: 'fake' });
      const flaky = await outbox.enqueueNotification({ tenantId: TENANT, recipient: '+919840000003', rawMessage: 'hello', maxAttempts: 5 });
      expect(await outbox.dispatchJob(flaky.id, TENANT)).toMatchObject({ status: 'FAILED', attempts: 1 }); // this one is worth another go
    } finally {
      spy.mockRestore();
    }
  });

  it('uses Twilio for sending only when it is configured, and the development sandbox in tests', () => {
    const manager = new TenantNotificationProviderManager();
    expect(manager.getAdapterForTenant('t').name).toBe('dev-sandbox'); // NODE_ENV=test
    const saved = process.env.NODE_ENV;
    const savedDev = process.env.ENABLE_DEV_SMS_GATEWAY;
    try {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_DEV_SMS_GATEWAY = 'false';
      setEnv(TWILIO_ENV);
      expect(new TenantNotificationProviderManager().getAdapterForTenant('t').name).toBe('twilio-whatsapp');
      setEnv({ TWILIO_WHATSAPP_FROM: undefined });
      expect(new TenantNotificationProviderManager().getAdapterForTenant('t').name).not.toBe('twilio-whatsapp'); // not complete: not used
    } finally {
      process.env.NODE_ENV = saved;
      process.env.ENABLE_DEV_SMS_GATEWAY = savedDev;
      clearEnv();
    }
  });
});
