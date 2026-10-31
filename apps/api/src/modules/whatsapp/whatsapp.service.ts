import { Injectable, Logger } from '@nestjs/common';
import { HttpWhatsAppAdapter } from '../notifications/adapters/http-whatsapp.adapter';
import { TwilioWhatsAppAdapter } from '../notifications/adapters/twilio-whatsapp.adapter';
import { DevNotificationAdapter } from '../notifications/adapters/dev-notification.adapter';
import { INotificationAdapter } from '../notifications/adapters/notification-adapter.interface';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly httpAdapter = new HttpWhatsAppAdapter();
  private readonly twilioAdapter = new TwilioWhatsAppAdapter();
  private readonly devAdapter = new DevNotificationAdapter();

  private getAdapter(): INotificationAdapter {
    if (process.env.NODE_ENV === 'test' || process.env.ENABLE_DEV_SMS_GATEWAY === 'true') return this.devAdapter;
    if (TwilioWhatsAppAdapter.isConfigured()) return this.twilioAdapter;
    if (!process.env.HOSTINGER_WHATSAPP_API_URL) return this.devAdapter;
    return this.httpAdapter;
  }

  /**
   * Send text message or PDF quotation link via resilient WhatsApp adapter
   */
  async sendMessage(phone: string, message: string, tenantId = 'default') {
    const adapter = this.getAdapter();
    const result = await adapter.sendMessage({
      tenantId,
      recipient: phone,
      message,
      channel: 'WHATSAPP',
    });

    if (!result.success) {
      this.logger.warn(`WhatsApp dispatch returned failure for ${phone}: ${result.error}`);
    } else {
      this.logger.log(`WhatsApp message dispatched successfully to ${phone}`);
    }

    return result;
  }

  /**
   * Send media (like a quotation PDF or Job Card image)
   */
  async sendMedia(phone: string, mediaUrl: string, caption: string, tenantId = 'default') {
    const adapter = this.getAdapter();
    const result = await adapter.sendMessage({
      tenantId,
      recipient: phone,
      message: caption,
      mediaUrl,
      caption,
      channel: 'WHATSAPP',
    });

    if (!result.success) {
      this.logger.warn(`WhatsApp media dispatch returned failure for ${phone}: ${result.error}`);
    }

    return result;
  }
}
