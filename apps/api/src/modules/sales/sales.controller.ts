import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  Res,
  BadRequestException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { Response } from 'express';
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
  CreateQuotationSchema,
  ConvertQuoteToOrderSchema,
  CreateQuotationDto,
  TenantRole,
} from '@friendly-crm/shared';

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
    @Headers('idempotency-key') headerKey: string | undefined,
    @Headers('x-idempotency-key') xHeaderKey: string | undefined,
    @Body() rawBody: unknown
  ) {
    const parsed = CreateQuotationSchema.safeParse(rawBody);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: errorMsg,
      });
    }

    const tenantId = tenant.id;
    const userId = user?.id || '';
    const idempotencyKey = headerKey || xHeaderKey || parsed.data.idempotencyKey;
    return this.salesService.createQuotation(tenantId, userId, parsed.data as any, idempotencyKey);
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
    @Body() rawBody: unknown
  ) {
    const parsed = CreateQuotationSchema.safeParse(rawBody);
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: errorMsg,
      });
    }

    const tenantId = tenant.id;
    const userId = user?.id || '';
    return this.salesService.createRevision(tenantId, userId, quotationId, parsed.data as any);
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
    @Headers('idempotency-key') headerKey: string | undefined,
    @Headers('x-idempotency-key') xHeaderKey: string | undefined,
    @Param('id') quotationId: string,
    @Body() rawBody?: unknown
  ) {
    const parsed = ConvertQuoteToOrderSchema.safeParse(rawBody || {});
    if (!parsed.success) {
      const errorMsg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: errorMsg,
      });
    }

    const tenantId = tenant.id;
    const userId = user?.id || '';
    const data = parsed.data;
    const industryKey = (data.industryKey || industryHeader || 'printing').toLowerCase();
    const advance = Number(data.advanceReceived ?? data.advanceAmount ?? 0);
    const idempotencyKey = headerKey || xHeaderKey || data.idempotencyKey;

    return this.salesService.convertQuoteToOrder(
      tenantId,
      userId,
      industryKey,
      quotationId,
      advance,
      data.expectedDeliveryAt || undefined,
      idempotencyKey,
      {
        mode: data.paymentMode,
        reference: data.paymentReference,
        notes: data.notes || undefined,
      }
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
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Param('id') id: string
  ) {
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    return this.salesService.getQuotationById(id, tenant.id, userRole);
  }

  /**
   * 5. GET /api/sales/quotations
   * List all quotations for tenant
   */
  @Get('quotations')
  @RequirePermission('quote:view')
  async getQuotations(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined
  ) {
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    return this.salesService.getQuotations(tenant.id, userRole);
  }

  /**
   * 6. GET /api/sales/quotations/:id/pdf
   * Server-rendered PDF stream using PdfEngineService
   */
  @Get('quotations/:id/pdf')
  @RequirePermission('quote:view')
  async getQuotationPdf(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Param('id') id: string,
    @Res() res: Response
  ) {
    const userRole = (user?.role || 'READ_ONLY') as TenantRole;
    const data = await this.salesService.getQuotationById(id, tenant.id, userRole);
    const pdfBuffer = await this.salesService.generateQuotationPdf(id, tenant.id, userRole);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="Quotation-${data.quote.quoteNumber}.pdf"`
    );
    res.send(pdfBuffer);
  }
}
