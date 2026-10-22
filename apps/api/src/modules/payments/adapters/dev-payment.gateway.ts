import { Injectable, Logger } from '@nestjs/common';
import {
  IPaymentGateway,
  CreatePaymentOrderOptions,
  PaymentOrderResult,
  PaymentWebhookEvent,
} from '../payment-gateway.interface';
import * as crypto from 'crypto';

@Injectable()
export class DevPaymentGateway implements IPaymentGateway {
  private readonly logger = new Logger(DevPaymentGateway.name);
  public static readonly DEV_WEBHOOK_SECRET = 'dev_razorpay_secret_12345';
  public static createdOrders: Map<string, CreatePaymentOrderOptions & { id: string }> = new Map();

  async createOrder(options: CreatePaymentOrderOptions): Promise<PaymentOrderResult> {
    const gatewayOrderId = `order_dev_${crypto.randomBytes(8).toString('hex')}`;

    DevPaymentGateway.createdOrders.set(gatewayOrderId, {
      ...options,
      id: gatewayOrderId,
    });

    this.logger.log(
      `[DEV PAYMENT GATEWAY] Created sandbox order ${gatewayOrderId} for ₹${options.amount} (Receipt: ${options.receiptId})`
    );

    return {
      success: true,
      gatewayOrderId,
      amount: options.amount,
      currency: options.currency || 'INR',
      keyId: 'rzp_test_dev12345678',
    };
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature) return false;
    try {
      const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
      const expected = crypto
        .createHmac('sha256', DevPaymentGateway.DEV_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');

      const expectedBuffer = Buffer.from(expected, 'hex');
      const signatureBuffer = Buffer.from(signature.trim(), 'hex');

      if (expectedBuffer.length !== signatureBuffer.length) {
        return false;
      }
      return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: any): PaymentWebhookEvent {
    const paymentEntity = body?.payload?.payment?.entity || body;
    const amountInRupees = (paymentEntity.amount || 0) / 100 || paymentEntity.amountRupees || 0;

    return {
      event: body.event || 'payment.captured',
      gatewayPaymentId: paymentEntity.id || `pay_dev_${crypto.randomBytes(6).toString('hex')}`,
      gatewayOrderId: paymentEntity.order_id || body.order_id || '',
      amount: amountInRupees,
      status: paymentEntity.status === 'captured' ? 'CAPTURED' : 'FAILED',
      referenceNo: paymentEntity.acquirer_data?.rrn || paymentEntity.referenceNo || paymentEntity.id,
      rawPayload: body,
    };
  }

  static generateValidSignature(payload: string): string {
    return crypto
      .createHmac('sha256', DevPaymentGateway.DEV_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');
  }

  static clear() {
    this.createdOrders.clear();
  }
}
