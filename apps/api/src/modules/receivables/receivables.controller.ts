import { Body, Controller, Get, Headers, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ReceivablesService } from './receivables.service';
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

@Controller('receivables')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  /** GET /api/receivables: who owes money, aged, largest first. */
  @Get()
  @RequirePermission('payment:view')
  list(@CurrentTenant() tenant: { id: string }) {
    return this.receivables.list(tenant.id);
  }

  /** POST /api/receivables/customers/:customerId/remind: WhatsApp reminder with a UPI pay link. */
  @Post('customers/:customerId/remind')
  @RequirePermission('payment:create')
  remind(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('customerId') customerId: string
  ) {
    return this.receivables.sendReminder(tenant.id, user?.id ?? null, customerId);
  }

  /**
   * POST /api/receivables/customers/:customerId/payments { amount, mode?, referenceNo?, notes? }
   * Money received against the customer's OPENING balance (owed from before Friendly CRM).
   * Payments against an order's own balance are recorded on the order.
   */
  @Post('customers/:customerId/payments')
  @RequirePermission('payment:create')
  recordOpeningPayment(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('customerId') customerId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { amount?: unknown; mode?: unknown; referenceNo?: unknown; notes?: unknown }
  ) {
    return this.receivables.recordOpeningPayment(tenant.id, user?.id ?? '', customerId, body ?? {}, idempotencyKey);
  }
}
