import {
  Controller,
  Post,
  Body,
  Headers,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import {
  AuthGuard,
  TenantGuard,
  PermissionsGuard,
  RequirePermission,
  TenantRlsInterceptor,
  AuditInterceptor,
  CurrentTenant,
} from '../../common';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * 1. POST /api/payments/create-order
   * Generate an online checkout order (Razorpay / UPI)
   */
  @Post('create-order')
  @UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
  @UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
  @RequirePermission('payment:create')
  async createPaymentOrder(
    @CurrentTenant() tenant: { id: string },
    @Body() body: { orderId: string; amount: number; customerId?: string }
  ) {
    if (!body?.orderId || !body?.amount) {
      throw new BadRequestException('orderId and amount are required');
    }
    return this.paymentsService.createPaymentOrder(
      tenant.id,
      body.orderId,
      Number(body.amount),
      body.customerId
    );
  }

  /**
   * 2. POST /api/payments/webhook
   * Inbound payment gateway webhook with HMAC verification and idempotency
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-webhook-signature') customSignature: string | undefined,
    @Body() body: any
  ) {
    const sig = signature || customSignature;
    return this.paymentsService.handleWebhook(body, sig);
  }
}
