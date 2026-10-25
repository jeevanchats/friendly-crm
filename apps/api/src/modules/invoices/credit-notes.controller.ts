import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { Response } from 'express';
import { CreditNotesService, IssueCreditNoteDto } from './credit-notes.service';
import { CreditNotePdfService } from './credit-note-pdf.service';
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

/** Credit notes reduce an issued invoice. Issuing one needs the same permission as issuing an invoice. */
@Controller('credit-notes')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class CreditNotesController {
  constructor(
    private readonly creditNotes: CreditNotesService,
    private readonly pdf: CreditNotePdfService
  ) {}

  /** GET /api/credit-notes?invoiceId= : recent credit notes, newest first. */
  @Get()
  @RequirePermission('invoice:view')
  list(@CurrentTenant() tenant: { id: string }, @Query('invoiceId') invoiceId?: string) {
    return this.creditNotes.list(tenant.id, { invoiceId: invoiceId || undefined });
  }

  /** GET /api/credit-notes/prepare/:invoiceId : what can still be credited on the invoice. */
  @Get('prepare/:invoiceId')
  @RequirePermission('invoice:create')
  prepare(@CurrentTenant() tenant: { id: string }, @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string) {
    return this.creditNotes.prepare(tenant.id, invoiceId);
  }

  /**
   * POST /api/credit-notes { invoiceId, reason?, note?, full?, lines?: [{ lineNo, quantity | taxableAmount }] }
   * `full: true` credits everything still left on the invoice (a cancellation).
   */
  @Post()
  @RequirePermission('invoice:create')
  issue(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Body() body: IssueCreditNoteDto & { invoiceId?: string }
  ) {
    const invoiceId = String(body?.invoiceId ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) {
      throw new BadRequestException('Say which invoice to credit.');
    }
    return this.creditNotes.issue(tenant.id, user?.id ?? null, invoiceId, body);
  }

  /** GET /api/credit-notes/:id */
  @Get(':id')
  @RequirePermission('invoice:view')
  get(@CurrentTenant() tenant: { id: string }, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.creditNotes.getById(tenant.id, id);
  }

  /** GET /api/credit-notes/:id/pdf */
  @Get(':id/pdf')
  @RequirePermission('invoice:view')
  async getPdf(@CurrentTenant() tenant: { id: string }, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    const cn = await this.creditNotes.getById(tenant.id, id);
    const buf = await this.pdf.generate(cn);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="CreditNote-${cn.creditNoteNumber.replace(/[^A-Za-z0-9-]/g, '-')}.pdf"`);
    res.send(buf);
  }
}
