import { BadRequestException, Body, Controller, Get, Headers, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard, TenantGuard, PermissionsGuard, RequirePermission, TenantRlsInterceptor, AuditInterceptor, CurrentTenant, CurrentUser } from '../../common';
import { RecordRefundSchema } from '@friendly-crm/shared';
import { RefundsService } from './refunds.service';

/**
 * Paying back a customer's ADVANCE (money they paid before Friendly CRM, imported as a negative opening balance). It sits
 * with the order refunds because it is the same kind of record; the routes live under the customer because an advance
 * belongs to the customer, not to an order.
 */
@Controller('crm/customers')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class CustomerAdvanceController {
  constructor(private readonly refundsService: RefundsService) {}

  /** POST /api/crm/customers/:id/advance-refunds { amount, mode?, referenceNo?, notes? }. Never more than the advance. RBAC: payment:create. */
  @Post(':id/advance-refunds')
  @RequirePermission('payment:create')
  async refundAdvance(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Headers('idempotency-key') headerKey: string | undefined,
    @Param('id') customerId: string,
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
    return this.refundsService.recordAdvance(tenant.id, user?.id || '', customerId, parsed.data, headerKey || parsed.data.idempotencyKey);
  }

  /** GET /api/crm/customers/:id/advance-refunds : the refunds of this customer's advance, and the advance still on record. */
  @Get(':id/advance-refunds')
  @RequirePermission('payment:view')
  list(@CurrentTenant() tenant: { id: string }, @Param('id') customerId: string) {
    return this.refundsService.listAdvance(tenant.id, customerId);
  }
}
