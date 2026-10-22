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
} from '@friendly-crm/shared';

@Controller('orders')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * 1. GET /api/orders
   * Lists all orders for the current tenant, filtered by production stage if provided.
   * RBAC: Requires 'order:view' permission (all roles).
   */
  @Get()
  @RequirePermission('order:view')
  async getOrders(
    @CurrentTenant() tenant: { id: string },
    @Query('stage') stage?: string
  ) {
    return this.ordersService.getOrders(tenant.id, stage);
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
    return this.ordersService.recordPayment(tenant.id, userId, orderId, parsed.data, idempotencyKey);
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
