import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { EwayBillsService, EwayBillInput, UploadedEwayFile } from './eway-bills.service';
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
import { MAX_FILE_BYTES, sanitizeFileName } from '@friendly-crm/shared';

/**
 * E-way bills are generated on the government portal by staff and recorded here against the invoice, with the
 * PDF they downloaded. Uploading uses the invoice permission.
 */
@Controller('eway-bills')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class EwayBillsController {
  constructor(private readonly ewayBills: EwayBillsService) {}

  /** GET /api/eway-bills?invoiceId= */
  @Get()
  @RequirePermission('invoice:view')
  list(@CurrentTenant() tenant: { id: string }, @Query('invoiceId', new ParseUUIDPipe()) invoiceId: string) {
    return this.ewayBills.list(tenant.id, invoiceId);
  }

  /** POST /api/eway-bills  (multipart: invoiceId, ewbNumber, generatedOn?, validUntil?, vehicleNumber?, file?) */
  @Post()
  @RequirePermission('invoice:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  add(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string } | undefined,
    @Body() body: EwayBillInput & { invoiceId?: string },
    @UploadedFile() file: UploadedEwayFile | undefined
  ) {
    const invoiceId = String(body?.invoiceId ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) throw new BadRequestException('Say which invoice this e-way bill is for.');
    return this.ewayBills.add(tenant.id, user?.id ?? null, invoiceId, body, file);
  }

  /** GET /api/eway-bills/:id/file : the PDF or photo that was uploaded. */
  @Get(':id/file')
  @RequirePermission('invoice:view')
  async file(@CurrentTenant() tenant: { id: string }, @Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response) {
    const f = await this.ewayBills.getFile(tenant.id, id);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Length', String(f.data.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(sanitizeFileName(f.fileName))}`);
    res.send(f.data);
  }

  /** DELETE /api/eway-bills/:id : for a bill recorded by mistake. */
  @Delete(':id')
  @RequirePermission('invoice:create')
  remove(@CurrentTenant() tenant: { id: string }, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.ewayBills.remove(tenant.id, id);
  }
}
