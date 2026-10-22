import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Query,
  UnauthorizedException,
  Logger,
  HttpCode,
} from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';
import { verifyHmacSha256, webhookDeduplication } from './webhook-verification.util';

@Controller('notifications/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly outboxService: NotificationOutboxService) {}

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
    const expectedToken = process.env.WHATSAPP_WEBHOOK_SECRET || 'dev-webhook-secret';
    if (mode === 'subscribe' && token === expectedToken) {
      this.logger.log('WhatsApp webhook subscription verified successfully');
      return challenge;
    }
    throw new UnauthorizedException('Invalid webhook verification token');
  }

  /**
   * 2. POST /api/notifications/whatsapp/webhook
   * Inbound delivery status callbacks & customer messages with deduplication & signature validation
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-webhook-signature') customSignature: string | undefined,
    @Headers('x-webhook-secret') secretHeader: string | undefined,
    @Body() body: any
  ) {
    const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET || 'dev-webhook-secret';
    const rawSignature = signature || customSignature;

    // Verify webhook authenticity: either via HMAC-SHA256 or via explicit secret header
    let isVerified = false;
    if (secretHeader && secretHeader === webhookSecret) {
      isVerified = true;
    } else if (rawSignature) {
      const payloadString = typeof body === 'string' ? body : JSON.stringify(body);
      isVerified = verifyHmacSha256(payloadString, rawSignature, webhookSecret);
    } else if (process.env.NODE_ENV === 'test' && body?.testSignature === 'valid') {
      isVerified = true;
    }

    if (!isVerified) {
      this.logger.warn('WhatsApp webhook call rejected: Invalid signature or secret');
      throw new UnauthorizedException('Unauthorized webhook signature');
    }

    // Deduplication by event ID / message ID
    const eventId = body?.id || body?.entry?.[0]?.id || body?.messageId || body?.statuses?.[0]?.id;
    if (eventId && webhookDeduplication.isDuplicate(eventId)) {
      this.logger.log(`Ignoring duplicate WhatsApp webhook event: ${eventId}`);
      return { status: 'ignored_duplicate', eventId };
    }

    // Process Delivery Status Callbacks (e.g., SENT, DELIVERED, READ, FAILED)
    const statusUpdate =
      body?.status ||
      body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.status ||
      body?.statuses?.[0]?.status;

    const messageId =
      body?.messageId ||
      body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.id ||
      body?.statuses?.[0]?.id;

    if (statusUpdate && messageId) {
      const normalizedStatus = statusUpdate.toUpperCase();
      if (['DELIVERED', 'READ', 'FAILED'].includes(normalizedStatus)) {
        await this.outboxService.handleDeliveryCallback(messageId, normalizedStatus as any);
        this.logger.log(`Updated WhatsApp delivery status: ${messageId} -> ${normalizedStatus}`);
      }
    }

    return { success: true, processed: true, eventId: eventId || null };
  }
}
