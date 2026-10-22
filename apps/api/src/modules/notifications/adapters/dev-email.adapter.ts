import { Injectable, Logger } from '@nestjs/common';
import { IEmailAdapter, SendEmailOptions, SendEmailResult } from './email-adapter.interface';
import { randomUUID } from 'crypto';

@Injectable()
export class DevEmailAdapter implements IEmailAdapter {
  private readonly logger = new Logger(DevEmailAdapter.name);

  // In-memory capture for assertion in test suites
  public static capturedEmails: Array<SendEmailOptions & { messageId: string; timestamp: string }> = [];

  /**
   * Masks email address for secure logging (e.g., r***@example.com)
   */
  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return '***@masked';
    const name = parts[0];
    const domain = parts[1];
    const visibleChars = Math.min(2, Math.floor(name.length / 2));
    return `${name.substring(0, visibleChars)}***@${domain}`;
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const messageId = `dev-email-${randomUUID()}`;
    const timestamp = new Date().toISOString();

    const record = {
      ...options,
      messageId,
      timestamp,
    };

    DevEmailAdapter.capturedEmails.push(record);

    this.logger.log(
      `[DEV EMAIL GATEWAY] Simulated delivery to ${this.maskEmail(options.to)} | Subject: "${options.subject}" (MsgID: ${messageId})`
    );

    return {
      success: true,
      messageId,
      timestamp,
    };
  }

  static getLatestEmail(recipient?: string) {
    if (!recipient) return this.capturedEmails[this.capturedEmails.length - 1];
    return this.capturedEmails.filter((e) => e.to === recipient).pop();
  }

  static clear() {
    this.capturedEmails = [];
  }
}
