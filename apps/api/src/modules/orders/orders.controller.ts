import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  Headers,
  BadRequestException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { RefundsService } from './refunds.service';
import { AdvanceCreditService } from './advance-credit.service';
import { CreditTransferService } from './credit-transfer.service';
import {
  AuthGuard,
  TenantGuard,
  PermissionsGuard,
  RequirePermission,
  TenantRlsInterceptor,
  AuditInterceptor,
  CurrentTenant,
  CurrentUser,
} from '../../common';
import {
  TenantRole,
  UpdateOrderStageSchema,
  RecordPaymentSchema,
  RecordPaymentDto,
  RecordRefundSchema,
  TransferCreditSchema,
} from '@friendly-crm/shared';

@Controller('orders')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly refundsService: RefundsService,
    private readonly advanceService: AdvanceCreditService,
    private readonly transferService: CreditTransferService
  ) {}

  /**
   * 1. GET /api/orders
   * Lists all orders for the current tenant, filtered by production stage if provided.
   * RBAC: Requires 'order:view' permission (all roles).
   */
  @Get()
  @RequirePermission('order:view')
  async getOrders(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Query('stage') stage?: string
  ) {
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    return this.ordersService.getOrders(tenant.id, stage, userRole);
  }

  /**
   * 2. PATCH /api/orders/:id/stage
   * Updates the production stage of an order.
   * RBAC: Requires 'order:update_stage' permission (OWNER, MANAGER, PRODUCTION).
   */
  @Patch(':id/stage')
  @RequirePermission('order:update_stage')
  async updateOrderStage(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') orderId: string,
    @Body() rawBody: unknown
  ) {
    const parsed = UpdateOrderStageSchema.safeParse(rawBody);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: errorMsg,
      });
    }

    const userId = user?.id || '';
    return this.ordersService.updateOrderStage(
      tenant.id,
      userId,
      orderId,
      parsed.data.nextStageId,
      parsed.data.customDataUpdates
    );
  }

  /**
   * 3. POST /api/orders/:id/payments
   * Records a partial or full payment receipt for an order.
   * RBAC: Requires 'payment:create' permission (OWNER, ACCOUNTS).
   */
  @Post(':id/payments')
  @RequirePermission('payment:create')
  async recordPayment(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Headers('x-idempotency-key') xHeaderKey: string | undefined,
    @Param('id') orderId: string,
    @Body() rawBody: unknown
  ) {
    const parsed = RecordPaymentSchema.safeParse(rawBody);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: errorMsg,
      });
    }

    const userId = user?.id || '';
    const idempotencyKey = headerKey || xHeaderKey || parsed.data.idempotencyKey;
    return this.ordersService.recordPayment(tenant.id, userId, orderId, parsed.data as any, idempotencyKey);
  }

  /**
   * POST /api/orders/:id/refunds { amount, mode?, referenceNo?, notes? }
   * Records money handed back to a customer whose order is in credit (a credit note lowered the order below what they
   * had paid). Cannot exceed the credit. RBAC: 'payment:create' (money out is recorded by the people who record money in).
   */
  @Post(':id/refunds')
  @RequirePermission('payment:create')
  async recordRefund(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Param('id') orderId: string,
    @Body() rawBody: unknown
  ) {
    const parsed = RecordRefundSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      });
    }
    return this.refundsService.record(tenant.id, user?.id || '', orderId, parsed.data, headerKey || parsed.data.idempotencyKey);
  }

  /** GET /api/orders/:id/advance : the customer's advance (brought in as a negative opening balance) and how much can go to this order. */
  @Get(':id/advance')
  @RequirePermission('payment:view')
  advanceAvailable(@CurrentTenant() tenant: { id: string }, @Param('id') orderId: string) {
    return this.advanceService.check(tenant.id, orderId);
  }

  /**
   * POST /api/orders/:id/apply-advance { amount? }
   * Uses the customer's advance against this order (the most possible when no amount is sent): the order's balance and
   * the advance both come down, and a receipt is written. RBAC: 'payment:create'.
   */
  @Post(':id/apply-advance')
  @RequirePermission('payment:create')
  applyAdvance(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Param('id') orderId: string,
    @Body() body: { amount?: unknown } | undefined
  ) {
    const raw = body?.amount;
    const amount = raw === undefined || raw === null || raw === '' ? undefined : Number(raw);
    if (amount !== undefined && !Number.isFinite(amount)) throw new BadRequestException('Amount must be a number');
    return this.advanceService.apply(tenant.id, user?.id || '', orderId, amount, headerKey);
  }

  /** GET /api/orders/:id/credit-transfer : where this order's credit can go and where credit for its dues can come from (same customer). */
  @Get(':id/credit-transfer')
  @RequirePermission('payment:view')
  creditTransferOptions(@CurrentTenant() tenant: { id: string }, @Param('id') orderId: string) {
    return this.transferService.options(tenant.id, orderId);
  }

  /**
   * POST /api/orders/:id/credit-transfer { toOrderId, amount?, notes? }
   * Moves the credit on this order (the customer paid more than it comes to) to another order of the SAME customer that
   * still owes money. The most possible when no amount is sent. RBAC: 'payment:create'.
   */
  @Post(':id/credit-transfer')
  @RequirePermission('payment:create')
  transferCredit(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Param('id') orderId: string,
    @Body() rawBody: unknown
  ) {
    const parsed = TransferCreditSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      });
    }
    return this.transferService.transfer(tenant.id, user?.id || '', orderId, parsed.data, headerKey || parsed.data.idempotencyKey);
  }

  /** GET /api/orders/:id/credit-transfers : the moves of credit into or out of this order. */
  @Get(':id/credit-transfers')
  @RequirePermission('payment:view')
  listCreditTransfers(@CurrentTenant() tenant: { id: string }, @Param('id') orderId: string) {
    return this.transferService.list(tenant.id, orderId);
  }

  /** GET /api/orders/:id/refunds : the refunds recorded for this order and the credit still left on it. */
  @Get(':id/refunds')
  @RequirePermission('payment:view')
  listRefunds(@CurrentTenant() tenant: { id: string }, @Param('id') orderId: string) {
    return this.refundsService.list(tenant.id, orderId);
  }

  /**
   * 4. GET /api/orders/:id
   * Fetches full order detail with customer, line items, payments, and audit timeline.
   * RBAC: Requires 'order:view' permission.
   */
  @Get(':id')
  @RequirePermission('order:view')
  async getOrderDetail(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Param('id') orderId: string
  ) {
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    return this.ordersService.getOrderDetail(tenant.id, userRole, orderId);
  }
}
