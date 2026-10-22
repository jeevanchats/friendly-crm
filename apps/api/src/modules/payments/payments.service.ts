import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { IPaymentGateway, CreatePaymentOrderOptions } from './payment-gateway.interface';
import { DevPaymentGateway } from './adapters/dev-payment.gateway';
import { RazorpayPaymentGateway } from './adapters/razorpay-payment.gateway';
import { OrdersService } from '../orders/orders.service';
import { webhookDeduplication } from '../notifications/webhook-verification.util';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly devGateway = new DevPaymentGateway();
  private readonly razorpayGateway = new RazorpayPaymentGateway();

  constructor(@Optional() private readonly ordersService?: OrdersService) {}

  public getGateway(): IPaymentGateway {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.ENABLE_DEV_SMS_GATEWAY === 'true' ||
      !process.env.RAZORPAY_KEY_ID
    ) {
      return this.devGateway;
    }
    return this.razorpayGateway;
  }

  /**
   * 1. Create a checkout order for an active CRM order
   */
  async createPaymentOrder(
    tenantId: string,
    orderId: string,
    amount: number,
    customerId?: string
  ) {
    if (amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const gateway = this.getGateway();
    return gateway.createOrder({
      amount,
      currency: 'INR',
      receiptId: orderId,
      tenantId,
      customerId,
      notes: { orderId, tenantId },
    });
  }

  /**
   * 2. Handle inbound webhook callback with signature verification & deduplication
   */
  async handleWebhook(rawBody: string | any, signature: string | undefined) {
    const gateway = this.getGateway();
    const bodyStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);

    const isValid = gateway.verifyWebhookSignature(bodyStr, signature || '');
    if (!isValid) {
      this.logger.warn('Payment webhook rejected: invalid signature');
      throw new UnauthorizedException('Invalid payment webhook signature');
    }

    const event = gateway.parseWebhookEvent(typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody);

    // Deduplication by gateway payment ID
    if (event.gatewayPaymentId && webhookDeduplication.isDuplicate(event.gatewayPaymentId)) {
      this.logger.log(`Ignoring duplicate payment webhook event: ${event.gatewayPaymentId}`);
      return { status: 'ignored_duplicate', eventId: event.gatewayPaymentId };
    }

    this.logger.log(
      `[PAYMENT WEBHOOK] Processing ${event.event} for Payment ${event.gatewayPaymentId} (₹${event.amount})`
    );

    // If payment captured and ordersService available, record payment idempotently
    if (event.status === 'CAPTURED' && this.ordersService) {
      const orderId =
        event.rawPayload?.notes?.orderId ||
        event.rawPayload?.payload?.payment?.entity?.notes?.orderId ||
        event.gatewayOrderId;

      const tenantId =
        event.rawPayload?.notes?.tenantId ||
        event.rawPayload?.payload?.payment?.entity?.notes?.tenantId ||
        '';

      if (orderId && tenantId) {
        try {
          await this.ordersService.recordPayment(
            tenantId,
            'system-gateway',
            orderId,
            {
              amount: event.amount,
              mode: 'ONLINE',
              referenceNo: event.referenceNo || event.gatewayPaymentId,
              notes: `Gateway Auto-Captured: ${event.gatewayPaymentId}`,
            },
            event.gatewayPaymentId
          );
          this.logger.log(`Automatically recorded payment for Order ${orderId}`);
        } catch (err: any) {
          this.logger.warn(`Could not auto-apply payment to order ${orderId}: ${err.message}`);
        }
      }
    }

    return {
      success: true,
      processed: true,
      paymentId: event.gatewayPaymentId,
      status: event.status,
    };
  }
}
