export type NotificationChannel = 'WHATSAPP' | 'SMS';

export interface SendMessageOptions {
  tenantId: string;
  recipient: string;
  message: string;
  mediaUrl?: string | null;
  caption?: string | null;
  channel: NotificationChannel;
  metadata?: Record<string, any>;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
  retryable?: boolean;
}

export interface INotificationAdapter {
  readonly name: string;
  sendMessage(options: SendMessageOptions): Promise<SendMessageResult>;
}
