export interface CreatePaymentOrderOptions {
  amount: number; // in INR rupees
  currency?: string; // default 'INR'
  receiptId: string; // our internal order ID or receipt ID
  tenantId: string;
  customerId?: string;
  notes?: Record<string, string>;
}

export interface PaymentOrderResult {
  success: boolean;
  gatewayOrderId: string;
  amount: number;
  currency: string;
  keyId?: string;
  clientSecret?: string;
}

export interface PaymentWebhookEvent {
  event: 'payment.captured' | 'payment.failed' | 'payment.refunded';
  gatewayPaymentId: string;
  gatewayOrderId: string;
  amount: number;
  status: 'CAPTURED' | 'FAILED' | 'REFUNDED';
  referenceNo?: string;
  rawPayload: any;
}

export interface IPaymentGateway {
  createOrder(options: CreatePaymentOrderOptions): Promise<PaymentOrderResult>;
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;
  parseWebhookEvent(body: any): PaymentWebhookEvent;
}
