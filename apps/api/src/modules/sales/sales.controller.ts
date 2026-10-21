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
  TenantGuard,
  TenantRlsInterceptor,
  AuditInterceptor,
  CurrentTenant,
  CurrentUser,
} from '../../common';

@Controller('sales')
@UseGuards(TenantGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  /**
   * 1. POST /api/sales/quotations
   * Create Initial Quotation (v1) & auto-advance Lead to QUOTED
   */
  @Post('quotations')
  async createQuotation(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Body() dto: CreateQuotationDto
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    const userId = user?.id || 'u-demo-1';
    return this.salesService.createQuotation(tenantId, userId, dto);
  }

  /**
   * 2. POST /api/sales/quotations/:id/revise
   * Create Quotation Revision (v2, v3...) superseding previous version
   */
  @Post('quotations/:id/revise')
  async createRevision(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Param('id') quotationId: string,
    @Body() dto: CreateQuotationDto
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    const userId = user?.id || 'u-demo-1';
    return this.salesService.createRevision(tenantId, userId, quotationId, dto);
  }

  /**
   * 3. POST /api/sales/quotations/:id/convert
   * 1-Click Convert accepted quotation into an active production Order
   */
  @Post('quotations/:id/convert')
  async convertQuoteToOrder(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Headers('x-industry-key') industryHeader: string | undefined,
    @Param('id') quotationId: string,
    @Body() body?: { advanceReceived?: number; expectedDeliveryAt?: string; industryKey?: string }
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    const userId = user?.id || 'u-demo-1';
    const industryKey = (body?.industryKey || industryHeader || 'printing').toLowerCase();

    return this.salesService.convertQuoteToOrder(
      tenantId,
      userId,
      industryKey,
      quotationId,
      body?.advanceReceived || 0,
      body?.expectedDeliveryAt
    );
  }

  /**
   * 4. GET /api/sales/quotations/:id
   * Fetch quotation, customer, line items, and customData (used by /q/[id]/pdf)
   */
  @Get('quotations/:id')
  async getQuotation(
    @CurrentTenant() tenant: { id: string } | undefined,
    @Param('id') id: string
  ) {
    const tenantId = tenant?.id || 't-demo-printing';
    return this.salesService.getQuotationById(id, tenantId);
  }

  /**
   * 5. GET /api/sales/quotations
   * List all quotations for tenant
   */
  @Get('quotations')
  async getQuotations(@CurrentTenant() tenant: { id: string }) {
    const tenantId = tenant?.id || 't-demo-printing';
    return this.salesService.getQuotations(tenantId);
  }
}
