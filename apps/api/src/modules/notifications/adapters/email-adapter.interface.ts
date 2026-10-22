export interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  tenantId: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: string;
}

export interface IEmailAdapter {
  sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
}
