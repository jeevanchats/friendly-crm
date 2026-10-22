import { Injectable, Logger } from '@nestjs/common';
import {
  INotificationAdapter,
  SendMessageOptions,
  SendMessageResult,
} from './notification-adapter.interface';

@Injectable()
export class HttpWhatsAppAdapter implements INotificationAdapter {
  readonly name = 'hostinger-whatsapp';
  private readonly logger = new Logger(HttpWhatsAppAdapter.name);

  private get apiUrl(): string {
    return process.env.HOSTINGER_WHATSAPP_API_URL || '';
  }

  private get apiKey(): string {
    return process.env.HOSTINGER_WHATSAPP_API_KEY || '';
  }

  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    if (!this.apiUrl) {
      return {
        success: false,
        provider: this.name,
        error: 'WhatsApp API URL is not configured',
        retryable: false,
      };
    }

    const cleanPhone = options.recipient.replace(/\D/g, '');
    const endpoint = options.mediaUrl ? `${this.apiUrl}/sendFile` : `${this.apiUrl}/sendText`;

    const body = options.mediaUrl
      ? {
          session: 'default',
          chatId: `${cleanPhone}@c.us`,
          file: {
            url: options.mediaUrl,
            filename: options.caption || 'Document.pdf',
          },
          caption: options.message,
        }
      : {
          session: 'default',
          chatId: `${cleanPhone}@c.us`,
          text: options.message,
        };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        this.logger.warn(`WhatsApp dispatch returned status ${res.status}: ${errorText}`);
        return {
          success: false,
          provider: this.name,
          error: `HTTP ${res.status}: ${errorText || res.statusText}`,
          retryable: res.status >= 500 || res.status === 429,
        };
      }

      const data = await res.json().catch(() => ({}));
      return {
        success: true,
        messageId: data.id || data.messageId,
        provider: this.name,
      };
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
      this.logger.error(`WhatsApp dispatch failed: ${err.message}`);
      return {
        success: false,
        provider: this.name,
        error: isTimeout ? 'Request timed out (8s)' : err.message,
        retryable: true,
      };
    }
  }
}
