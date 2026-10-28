import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { InvoicesService, IssueInvoiceDto } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
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

@Controller('invoices')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly pdf: InvoicePdfService
  ) {}

  /** GET /api/invoices: recent invoices, newest first. */
  @Get()
  @RequirePermission('invoice:view')
  list(@CurrentTenant() tenant: { id: string }) {
    return this.invoices.list(tenant.id);
  }

  /**
   * GET /api/invoices/prepare/:orderId
   * What is missing and what would be charged, so the screen can ask only for what is needed.
   * `placeOfSupply` (query) previews a different place of supply.
   */
  @Get('prepare/:orderId')
  @RequirePermission('invoice:create')
  prepare(
    @CurrentTenant() tenant: { id: string },
    @Param('orderId') orderId: string,
    @Query('placeOfSupply') placeOfSupply?: string
  ) {
    return this.invoices.prepare(tenant.id, orderId, { placeOfSupply });
  }

  /** POST /api/invoices/prepare { orderId, hsn?, placeOfSupply? }: the same, with the HSN codes typed so far. */
  @Post('prepare')
  @RequirePermission('invoice:create')
  prepareWith(
    @CurrentTenant() tenant: { id: string },
    @Body() body: { orderId?: string } & IssueInvoiceDto
  ) {
    return this.invoices.prepare(tenant.id, String(body?.orderId ?? ''), {
      hsn: body?.hsn && typeof body.hsn === 'object' ? body.hsn : undefined,
      placeOfSupply: typeof body?.placeOfSupply === 'string' ? body.placeOfSupply : undefined,
    });
  }

  /** GET /api/invoices/by-order/:orderId */
  @Get('by-order/:orderId')
  @RequirePermission('invoice:view')
  byOrder(@CurrentTenant() tenant: { id: string }, @Param('orderId') orderId: string) {
    return this.invoices.getByOrder(tenant.id, orderId);
  }

  /** POST /api/invoices { orderId, hsn?, placeOfSupply? }: issue the GST invoice for an order. */
  @Post()
  @RequirePermission('invoice:create')
  issue(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Body() body: { orderId?: string } & IssueInvoiceDto
  ) {
    return this.invoices.issue(tenant.id, user?.id ?? null, String(body?.orderId ?? ''), {
      hsn: body?.hsn && typeof body.hsn === 'object' ? body.hsn : undefined,
      placeOfSupply: typeof body?.placeOfSupply === 'string' ? body.placeOfSupply : undefined,
    });
  }

  /** GET /api/invoices/:id */
  @Get(':id')
  @RequirePermission('invoice:view')
  get(@CurrentTenant() tenant: { id: string }, @Param('id') id: string) {
    return this.invoices.getById(tenant.id, id);
  }

  /** GET /api/invoices/:id/pdf */
  @Get(':id/pdf')
  @RequirePermission('invoice:view')
  async getPdf(@CurrentTenant() tenant: { id: string }, @Param('id') id: string, @Res() res: Response) {
    const inv = await this.invoices.getById(tenant.id, id);
    const buf = await this.pdf.generate(inv, await this.invoices.getPaymentDetails(tenant.id));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Invoice-${inv.invoiceNumber.replace(/[^A-Za-z0-9-]/g, '-')}.pdf"`);
    res.send(buf);
  }
}
