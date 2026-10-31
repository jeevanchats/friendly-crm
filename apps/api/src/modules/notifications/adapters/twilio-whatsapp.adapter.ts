import { Injectable, Logger } from '@nestjs/common';
import { INotificationAdapter, SendMessageOptions, SendMessageResult } from './notification-adapter.interface';

/** WhatsApp accepts at most 1600 characters in one message through Twilio. Longer text is sent as several, split at line ends. */
export const TWILIO_MAX_BODY = 1500;

/** "whatsapp:+14155238886" from "+14155238886", "14155238886" or an already prefixed number. */
export function toTwilioWhatsApp(number: string): string {
  const digits = String(number ?? '').replace(/^whatsapp:/i, '').replace(/\D/g, '');
  return `whatsapp:+${digits}`;
}

/** Cuts long text at line ends (or spaces) so each part fits in one WhatsApp message. */
export function splitForWhatsApp(text: string, max = TWILIO_MAX_BODY): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** What Twilio's error codes mean here, in words the business can act on. Codes not listed fall through with Twilio's own text. */
const FRIENDLY: Record<number, { text: string; retryable: boolean }> = {
  63016: { text: 'The customer has not messaged in the last 24 hours, so only an approved WhatsApp template can be sent to them.', retryable: false },
  63015: { text: 'The recipient has not joined the Twilio WhatsApp sandbox yet (they must send the join code first).', retryable: false },
  63007: { text: 'The sending number is not enabled for WhatsApp in Twilio. Check TWILIO_WHATSAPP_FROM.', retryable: false },
  63018: { text: 'WhatsApp rate limit reached for this sender. It will be retried.', retryable: true },
  21211: { text: 'That is not a valid phone number.', retryable: false },
  21614: { text: 'That number cannot receive WhatsApp messages.', retryable: false },
  21608: { text: 'This Twilio account is a trial and can only message verified numbers.', retryable: false },
  20003: { text: 'Twilio rejected the account credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.', retryable: false },
};

/**
 * Sends WhatsApp messages through Twilio (https://www.twilio.com/docs/whatsapp). Configuration comes from the environment:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN         always needed (the auth token also verifies Twilio's webhooks)
 *   TWILIO_WHATSAPP_FROM                          the sender, e.g. +14155238886 (sandbox) or your approved number
 *   or TWILIO_MESSAGING_SERVICE_SID               instead of a single sender
 *   TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET    optional: send with an API key instead of the auth token
 *   TWILIO_STATUS_CALLBACK_URL                    optional: where Twilio reports delivered / read / failed
 * Free-form text can only be sent within 24 hours of the customer's last message; Twilio refuses it otherwise (error 63016).
 */
@Injectable()
export class TwilioWhatsAppAdapter implements INotificationAdapter {
  readonly name = 'twilio-whatsapp';
  private readonly logger = new Logger(TwilioWhatsAppAdapter.name);

  /** True when the three things needed to send are set. */
  static isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_WHATSAPP_FROM || env.TWILIO_MESSAGING_SERVICE_SID));
  }

  private get accountSid() {
    return process.env.TWILIO_ACCOUNT_SID as string;
  }

  private authHeader(): string {
    const user = process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET ? process.env.TWILIO_API_KEY_SID : this.accountSid;
    const pass = process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET ? process.env.TWILIO_API_KEY_SECRET : (process.env.TWILIO_AUTH_TOKEN as string);
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }

  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    if (!TwilioWhatsAppAdapter.isConfigured()) {
      return { success: false, provider: this.name, error: 'Twilio is not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM)', retryable: false };
    }
    if (options.channel !== 'WHATSAPP') {
      return { success: false, provider: this.name, error: 'This adapter sends WhatsApp messages only', retryable: false };
    }
    if (!String(options.recipient ?? '').replace(/\D/g, '')) {
      return { success: false, provider: this.name, error: 'No recipient number', retryable: false };
    }

    // One Twilio message per part. A picture or document goes with the first part; the rest of the text follows.
    const parts = splitForWhatsApp(String(options.message ?? ''));
    let firstId: string | undefined;
    for (let i = 0; i < parts.length; i++) {
      const sent = await this.sendOne(options, parts[i], i === 0 ? options.mediaUrl : null);
      if (!sent.success) return firstId ? { ...sent, messageId: firstId } : sent;
      firstId = firstId ?? sent.messageId;
    }
    return { success: true, provider: this.name, messageId: firstId };
  }

  private async sendOne(options: SendMessageOptions, body: string, mediaUrl?: string | null): Promise<SendMessageResult> {
    const form = new URLSearchParams();
    form.set('To', toTwilioWhatsApp(options.recipient));
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
    else form.set('From', toTwilioWhatsApp(process.env.TWILIO_WHATSAPP_FROM as string));
    if (body) form.set('Body', body);
    if (mediaUrl) form.set('MediaUrl', mediaUrl);
    if (!body && !mediaUrl) return { success: false, provider: this.name, error: 'Nothing to send', retryable: false };
    if (process.env.TWILIO_STATUS_CALLBACK_URL) form.set('StatusCallback', process.env.TWILIO_STATUS_CALLBACK_URL);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: this.authHeader(), 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(15_000),
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok) return { success: true, provider: this.name, messageId: typeof data.sid === 'string' ? data.sid : undefined };

      const code = Number(data?.code);
      const known = FRIENDLY[code];
      // The raw reply may mention the account or the number: only the code and Twilio's own message go to the log
      this.logger.warn(`Twilio returned ${res.status}, code ${Number.isFinite(code) ? code : '?'}: ${String(data?.message ?? '').slice(0, 200)}`);
      return {
        success: false,
        provider: this.name,
        error: known ? `${known.text} (Twilio ${code})` : `Twilio ${res.status}${Number.isFinite(code) ? ` / ${code}` : ''}: ${String(data?.message ?? res.statusText).slice(0, 200)}`,
        retryable: known ? known.retryable : res.status >= 500 || res.status === 429,
      };
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      this.logger.error(`Twilio request failed: ${err?.message}`);
      return { success: false, provider: this.name, error: timedOut ? 'Twilio did not answer in time' : `Could not reach Twilio: ${err?.message}`, retryable: true };
    }
  }
}
