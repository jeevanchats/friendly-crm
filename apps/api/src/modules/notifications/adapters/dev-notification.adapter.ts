import { Injectable, Logger } from '@nestjs/common';
import {
  INotificationAdapter,
  SendMessageOptions,
  SendMessageResult,
} from './notification-adapter.interface';
import { randomUUID } from 'crypto';

export interface CapturedNotificationMessage {
  id: string;
  tenantId: string;
  channel: string;
  recipient: string;
  maskedRecipient: string;
  message: string;
  mediaUrl?: string | null;
  sentAt: Date;
}

@Injectable()
export class DevNotificationAdapter implements INotificationAdapter {
  readonly name = 'dev-sandbox';
  private readonly logger = new Logger(DevNotificationAdapter.name);

  // Static storage for inspecting sent messages during testing
  public static capturedMessages: CapturedNotificationMessage[] = [];
  public static simulateFailure = false;
  public static failureErrorMessage = 'Simulated vendor timeout';

  public static clear(): void {
    this.capturedMessages = [];
    this.simulateFailure = false;
  }

  /**
   * Safely masks a phone number or recipient identifier to prevent customer PII exposure in logs.
   * e.g. "+919840123456" => "+91 98*** **3456"
   */
  public maskRecipient(recipient: string): string {
    if (!recipient) return '***';
    const digits = recipient.replace(/\D/g, '');
    if (digits.length <= 4) return '***' + digits;
    const start = digits.slice(0, 4);
    const end = digits.slice(-4);
    return `+${start}***${end}`;
  }

  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    const masked = this.maskRecipient(options.recipient);

    if (DevNotificationAdapter.simulateFailure) {
      this.logger.warn(
        `[DEV NOTIFICATION GATEWAY] Simulated failure for [${options.channel}] to ${masked}`
      );
      return {
        success: false,
        provider: this.name,
        error: DevNotificationAdapter.failureErrorMessage,
        retryable: true,
      };
    }

    const messageId = `msg-dev-${randomUUID()}`;
    const entry: CapturedNotificationMessage = {
      id: messageId,
      tenantId: options.tenantId,
      channel: options.channel,
      recipient: options.recipient,
      maskedRecipient: masked,
      message: options.message,
      mediaUrl: options.mediaUrl,
      sentAt: new Date(),
    };

    DevNotificationAdapter.capturedMessages.push(entry);

    this.logger.log(
      `[DEV NOTIFICATION GATEWAY] Dispatched [${options.channel}] to ${masked} (ID: ${messageId})`
    );

    return {
      success: true,
      messageId,
      provider: this.name,
    };
  }
}
