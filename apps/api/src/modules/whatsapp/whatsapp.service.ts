import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly apiUrl = process.env.HOSTINGER_WHATSAPP_API_URL; // e.g. https://vps-ip/api
  private readonly apiKey = process.env.HOSTINGER_WHATSAPP_API_KEY;

  /**
   * Send text message or PDF quotation link via Hostinger WhatsApp API
   */
  async sendMessage(phone: string, message: string) {
    try {
      const cleanPhone = phone.replace(/\D/g, ''); // E.g., 919876543210
      const response = await fetch(`${this.apiUrl}/sendText`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey || '',
        },
        body: JSON.stringify({
          session: 'default',
          chatId: `${cleanPhone}@c.us`,
          text: message,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      this.logger.log(`WhatsApp message sent successfully to ${phone}`);
      return await response.json();
    } catch (error: any) {
      this.logger.error(`Failed to send WhatsApp message to ${phone}`, error.message);
      throw new Error('WhatsApp dispatch failed');
    }
  }

  /**
   * Send media (like a quotation PDF or Job Card image)
   */
  async sendMedia(phone: string, mediaUrl: string, caption: string) {
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const response = await fetch(`${this.apiUrl}/sendFile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.apiKey || '',
        },
        body: JSON.stringify({
          session: 'default',
          chatId: `${cleanPhone}@c.us`,
          file: {
            url: mediaUrl,
            filename: 'Quotation.pdf',
          },
          caption,
        }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error: any) {
      this.logger.error(`Failed to send media to ${phone}`, error.message);
      throw new Error('WhatsApp media dispatch failed');
    }
  }
}