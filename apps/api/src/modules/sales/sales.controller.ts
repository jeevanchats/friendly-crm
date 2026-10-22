import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SalesService, CreateQuotationDto } from './sales.service';
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

@Controller('sales')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  /**
   * 1. POST /api/sales/quotations
   * Create Initial Quotation (v1) & auto-advance Lead to QUOTED
   */
  @Post('quotations')
  @RequirePermission('quote:create')
  async createQuotation(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Body() dto: CreateQuotationDto
  ) {
    const tenantId = tenant.id;
    const userId = user?.id || '';
    return this.salesService.createQuotation(tenantId, userId, dto);
  }

  /**
   * 2. POST /api/sales/quotations/:id/revise
   * Create Quotation Revision (v2, v3...) superseding previous version
   */
  @Post('quotations/:id/revise')
  @RequirePermission('quote:update')
  async createRevision(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') quotationId: string,
    @Body() dto: CreateQuotationDto
  ) {
    const tenantId = tenant.id;
    const userId = user?.id || '';
    return this.salesService.createRevision(tenantId, userId, quotationId, dto);
  }

  /**
   * 3. POST /api/sales/quotations/:id/convert
   * 1-Click Convert accepted quotation into an active production Order
   */
  @Post('quotations/:id/convert')
  @RequirePermission('quote:convert')
  async convertQuoteToOrder(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Headers('x-industry-key') industryHeader: string | undefined,
    @Param('id') quotationId: string,
    @Body() body?: { advanceReceived?: number; advanceAmount?: number; expectedDeliveryAt?: string; industryKey?: string }
  ) {
    const tenantId = tenant.id;
    const userId = user?.id || '';
    const industryKey = (body?.industryKey || industryHeader || 'printing').toLowerCase();
    const advance = Number(body?.advanceReceived ?? body?.advanceAmount ?? 0);

    return this.salesService.convertQuoteToOrder(
      tenantId,
      userId,
      industryKey,
      quotationId,
      advance,
      body?.expectedDeliveryAt
    );
  }

  /**
   * 4. GET /api/sales/quotations/:id
   * Fetch quotation, customer, line items, and customData (used by /q/[id]/pdf)
   */
  @Get('quotations/:id')
  @RequirePermission('quote:view')
  async getQuotation(
    @CurrentTenant() tenant: { id: string },
    @Param('id') id: string
  ) {
    return this.salesService.getQuotationById(id, tenant.id);
  }

  /**
   * 5. GET /api/sales/quotations
   * List all quotations for tenant
   */
  @Get('quotations')
  @RequirePermission('quote:view')
  async getQuotations(@CurrentTenant() tenant: { id: string }) {
    return this.salesService.getQuotations(tenant.id);
  }
}
