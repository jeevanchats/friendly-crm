import * as fs from 'fs';
import * as path from 'path';
import { TwilioWhatsAppAdapter } from '../../src/modules/notifications/adapters/twilio-whatsapp.adapter';
import { twilioWebhookUrl } from '../../src/modules/notifications/twilio-webhook.controller';

/**
 * A LIVE check of the Twilio WhatsApp settings (`npm run check:twilio` from apps/api). Not part of the normal test lanes.
 *  1. Always (when the credentials are set): asks Twilio whether the account and token are valid. Sends nothing.
 *  2. Only when TWILIO_TEST_TO is set to a number that can receive WhatsApp (in the sandbox: one that has joined): sends
 *     one short test message to it.
 * The settings are read from the repository's .env (Jest keeps its own copy of process.env, so load-env does not reach it).
 * Nothing secret is printed.
 */
const NAMES = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'TWILIO_MESSAGING_SERVICE_SID', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_WEBHOOK_URL', 'PUBLIC_API_URL', 'TWILIO_TEST_TO'];

function loadEnv(): void {
  for (const dir of [process.cwd(), path.resolve(process.cwd(), '../..')]) {
    const file = path.join(dir, '.env');
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const name of NAMES) {
      if (process.env[name]) continue;
      const m = text.match(new RegExp(`^${name}=(.*)$`, 'm'));
      if (m && m[1].trim()) process.env[name] = m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
}

describe('LIVE: Twilio WhatsApp settings', () => {
  beforeAll(loadEnv);
  const ready = () => TwilioWhatsAppAdapter.isConfigured();

  it('has the settings it needs (names only are shown)', () => {
    const set = (n: string) => (process.env[n] ? 'set' : 'NOT SET');
    // eslint-disable-next-line no-console
    console.log(
      [
        `TWILIO_ACCOUNT_SID: ${set('TWILIO_ACCOUNT_SID')}`,
        `TWILIO_AUTH_TOKEN: ${set('TWILIO_AUTH_TOKEN')}`,
        `TWILIO_WHATSAPP_FROM or TWILIO_MESSAGING_SERVICE_SID: ${process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID ? 'set' : 'NOT SET'}`,
        `Webhook address to enter in Twilio: ${twilioWebhookUrl() ?? 'NOT KNOWN: set TWILIO_WEBHOOK_URL or PUBLIC_API_URL'}`,
      ].join('\n')
    );
    expect(ready()).toBe(true);
  });

  it('Twilio accepts the account and token', async () => {
    if (!ready()) return;
    const sid = process.env.TWILIO_ACCOUNT_SID as string;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}` },
    });
    const body: any = await res.json().catch(() => ({}));
    // eslint-disable-next-line no-console
    console.log(`Twilio account status: ${body?.status ?? res.status}, type: ${body?.type ?? '?'}`);
    expect(res.status).toBe(200);
    expect(body.status).toBe('active');
  });

  it('sends one test message when TWILIO_TEST_TO is set', async () => {
    if (!ready() || !process.env.TWILIO_TEST_TO) return;
    const out = await new TwilioWhatsAppAdapter().sendMessage({
      tenantId: 'live-check',
      recipient: process.env.TWILIO_TEST_TO,
      message: 'Friendly CRM: this is a test message from your WhatsApp setup. You can ignore it.',
      channel: 'WHATSAPP',
    });
    // eslint-disable-next-line no-console
    console.log(out.success ? `Test message accepted by Twilio (${out.messageId})` : `Test message refused: ${out.error}`);
    expect(out.success).toBe(true);
  });
});
