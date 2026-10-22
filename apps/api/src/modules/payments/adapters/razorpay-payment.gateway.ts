import { Injectable, Logger } from '@nestjs/common';
import {
  IPaymentGateway,
  CreatePaymentOrderOptions,
  PaymentOrderResult,
  PaymentWebhookEvent,
} from '../payment-gateway.interface';
import * as crypto from 'crypto';

@Injectable()
export class RazorpayPaymentGateway implements IPaymentGateway {
  private readonly logger = new Logger(RazorpayPaymentGateway.name);

  private readonly keyId = process.env.RAZORPAY_KEY_ID || '';
  private readonly keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  private readonly webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

  async createOrder(options: CreatePaymentOrderOptions): Promise<PaymentOrderResult> {
    const amountInPaise = Math.round(options.amount * 100);
    const authHeader = `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;

    try {
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: options.currency || 'INR',
          receipt: options.receiptId,
          notes: {
            tenantId: options.tenantId,
            ...(options.notes || {}),
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Razorpay Order API failed: ${response.status} - ${errorText}`);
      }

      const orderData = (await response.json()) as any;
      return {
        success: true,
        gatewayOrderId: orderData.id,
        amount: options.amount,
        currency: orderData.currency,
        keyId: this.keyId,
      };
    } catch (err: any) {
      this.logger.error(`Failed to create Razorpay order: ${err.message}`);
      throw err;
    }
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    if (!signature || !this.webhookSecret) return false;
    try {
      const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
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
    const paymentEntity = body?.payload?.payment?.entity || {};
    const amountInRupees = (paymentEntity.amount || 0) / 100;

    return {
      event: body.event,
      gatewayPaymentId: paymentEntity.id || '',
      gatewayOrderId: paymentEntity.order_id || '',
      amount: amountInRupees,
      status: paymentEntity.status === 'captured' ? 'CAPTURED' : 'FAILED',
      referenceNo: paymentEntity.acquirer_data?.rrn || paymentEntity.id,
      rawPayload: body,
    };
  }
}
