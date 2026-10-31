import { Body, Controller, Header, Headers, HttpCode, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';
import { verifyTwilioSignature, webhookDeduplication } from './webhook-verification.util';
import { WhatsAppBotService } from '../whatsapp/bot/whatsapp-bot.service';
import { parseStatusUpdates } from '../whatsapp/bot/inbound-parser';

/**
 * The address Twilio was told to call, exactly as typed in the Twilio console (it is part of what Twilio signs).
 * TWILIO_WEBHOOK_URL wins; otherwise it is built from PUBLIC_API_URL.
 */
export function twilioWebhookUrl(): string | null {
  if (process.env.TWILIO_WEBHOOK_URL) return process.env.TWILIO_WEBHOOK_URL;
  const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  return base ? `${base}/api/notifications/twilio/webhook` : null;
}

/**
 * Where Twilio sends the WhatsApp messages people send to us and the delivered / read / failed reports for the messages we
 * sent. Every call is checked against Twilio's signature, made with the account's auth token: there is no default and no
 * development bypass, so without TWILIO_AUTH_TOKEN every call is refused.
 */
@Controller('notifications/twilio')
export class TwilioWebhookController {
  private readonly logger = new Logger(TwilioWebhookController.name);

  constructor(
    private readonly outbox: NotificationOutboxService,
    private readonly bot: WhatsAppBotService
  ) {}

  /** POST /api/notifications/twilio/webhook (form-encoded, as Twilio sends it). Both Twilio webhook fields can point here. */
  @Post('webhook')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async handle(@Headers('x-twilio-signature') signature: string | undefined, @Body() body: any): Promise<string> {
    const token = process.env.TWILIO_AUTH_TOKEN;
    const url = twilioWebhookUrl();
    if (!token || !url) {
      this.logger.error('Twilio webhook refused: set TWILIO_AUTH_TOKEN and TWILIO_WEBHOOK_URL (or PUBLIC_API_URL) to accept Twilio calls');
      throw new UnauthorizedException('Twilio webhook is not configured');
    }
    if (!verifyTwilioSignature(url, body ?? {}, signature, token)) {
      this.logger.warn('Twilio webhook call rejected: the signature does not match (check TWILIO_WEBHOOK_URL is exactly the address set in Twilio)');
      throw new UnauthorizedException('Unauthorized webhook signature');
    }

    // Delivered / read / failed reports update the queued message
    for (const update of parseStatusUpdates(body)) {
      if (webhookDeduplication.isDuplicate(`status:${update.id}:${update.status}`)) continue;
      await this.outbox.handleDeliveryCallback(update.id, update.status);
      this.logger.log(`Twilio delivery status: ${update.id} -> ${update.status}`);
    }

    // A message from a person goes to the WhatsApp bot (never throws; de-duplicated per message id)
    await this.bot.handleWebhook(body);

    // Twilio wants an answer it can read; an empty TwiML response means "nothing more to do". Replies go out through the API.
    return '<Response></Response>';
  }
}
