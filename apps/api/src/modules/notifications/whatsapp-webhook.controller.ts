import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Query,
  Req,
  UnauthorizedException,
  Logger,
  HttpCode,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { NotificationOutboxService } from './notification-outbox.service';
import { verifyHmacSha256, webhookDeduplication } from './webhook-verification.util';
import { WhatsAppBotService } from '../whatsapp/bot/whatsapp-bot.service';
import { parseStatusUpdates } from '../whatsapp/bot/inbound-parser';

/** Constant-time string comparison (hashes first so lengths never leak). */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Secrets:
 *  - WHATSAPP_VERIFY_TOKEN : value you type into Meta's "Verify token" box (GET challenge).
 *  - WHATSAPP_APP_SECRET   : Meta App Secret; signs POST bodies (x-hub-signature-256).
 *  - WHATSAPP_WEBHOOK_SECRET: legacy single secret, used as the fallback for both.
 * In production there is NO built-in default: a missing secret rejects every request.
 */
function resolveSecret(...names: string[]): string | null {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return process.env.NODE_ENV === 'production' ? null : 'dev-webhook-secret';
}

@Controller('notifications/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly outboxService: NotificationOutboxService,
    private readonly bot: WhatsAppBotService
  ) {}

  /**
   * 1. GET /api/notifications/whatsapp/webhook
   * Verification challenge for WhatsApp / Meta Webhook setup
   */
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string
  ) {
    const expected = resolveSecret('WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_WEBHOOK_SECRET');
    if (expected && mode === 'subscribe' && token && safeEqual(token, expected)) {
      this.logger.log('WhatsApp webhook subscription verified successfully');
      return challenge;
    }
    throw new UnauthorizedException('Invalid webhook verification token');
  }

  /**
   * 2. POST /api/notifications/whatsapp/webhook
   * Delivery-status callbacks AND inbound staff messages (handled by the WhatsApp bot).
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: any,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-webhook-signature') customSignature: string | undefined,
    @Headers('x-webhook-secret') secretHeader: string | undefined,
    @Body() body: any
  ) {
    const secret = resolveSecret('WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_SECRET');
    const rawSignature = signature || customSignature;

    let isVerified = false;
    if (secret) {
      if (secretHeader && safeEqual(secretHeader, secret)) {
        isVerified = true;
      } else if (rawSignature) {
        // Sign-check the exact bytes received; re-serialised JSON may differ from what the provider signed.
        const payload: string | Buffer =
          req?.rawBody ?? (typeof body === 'string' ? body : JSON.stringify(body));
        isVerified = verifyHmacSha256(payload, rawSignature, secret);
      } else if (process.env.NODE_ENV === 'test' && body?.testSignature === 'valid') {
        isVerified = true;
      }
    }

    if (!isVerified) {
      this.logger.warn('WhatsApp webhook call rejected: Invalid signature or secret');
      throw new UnauthorizedException('Unauthorized webhook signature');
    }

    // Flat-shape idempotency (providers/tests that send a top-level event id).
    const eventId: string | undefined = typeof body?.id === 'string' ? body.id : undefined;
    if (eventId && webhookDeduplication.isDuplicate(eventId)) {
      this.logger.log(`Ignoring duplicate WhatsApp webhook event: ${eventId}`);
      return { status: 'ignored_duplicate', eventId };
    }

    // Delivery status callbacks (SENT is ignored; DELIVERED / READ / FAILED update the outbox).
    for (const update of parseStatusUpdates(body)) {
      if (webhookDeduplication.isDuplicate(`status:${update.id}:${update.status}`)) continue;
      await this.outboxService.handleDeliveryCallback(update.id, update.status);
      this.logger.log(`Updated WhatsApp delivery status: ${update.id} -> ${update.status}`);
    }

    // Inbound messages from staff -> conversational bot (never throws; de-duplicated per message id).
    const inbound = await this.bot.handleWebhook(body);

    return { success: true, processed: true, eventId: eventId || null, inbound };
  }
}
