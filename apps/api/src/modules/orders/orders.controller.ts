import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { OrdersService, RecordPaymentDto } from './orders.service';
import {
  TenantGuard,
  PermissionsGuard,
  RequirePermission,
  TenantRlsInterceptor,
  AuditInterceptor,
  CurrentTenant,
  CurrentUser,
} from '../../common';
import { TenantRole } from '@friendly-crm/shared';

@Controller('orders')
@UseGuards(TenantGuard, PermissionsGuard)
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
    const tenantId = tenant?.id || 't-demo-printing';
    return this.ordersService.getOrders(tenantId, stage);
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
    @Body() body: { nextStageId: string; customDataUpdates?: Record<string, any> }
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    const userId = user?.id || 'u-demo-1';
    return this.ordersService.updateOrderStage(
      tenantId,
      userId,
      orderId,
      body.nextStageId,
      body.customDataUpdates
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
    @Param('id') orderId: string,
    @Body() dto: RecordPaymentDto
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    const userId = user?.id || 'u-demo-1';
    return this.ordersService.recordPayment(tenantId, userId, orderId, dto);
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
    const tenantId = tenant?.id || 't-demo-printing';
    const userRole = (user?.role || 'OWNER') as TenantRole;
    return this.ordersService.getOrderDetail(tenantId, userRole, orderId);
  }
}
