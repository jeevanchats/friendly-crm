import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AttachmentsService, UploadedFile as UploadedFileShape, Viewer } from './attachments.service';
import { AuthGuard, TenantGuard, PermissionsGuard, RequirePermission, TenantRlsInterceptor, AuditInterceptor, CurrentTenant, CurrentUser } from '../../common';
import { MAX_FILE_BYTES, hasPermission, isInlineViewable, sanitizeFileName } from '@friendly-crm/shared';

/** Owners and managers see every enquiry's attachments; others only those of enquiries assigned to them. */
const viewerOf = (user: { id: string; role?: string } | undefined): Viewer => ({
  userId: user?.id ?? null,
  all: hasPermission((user?.role || 'READ_ONLY') as any, 'lead:view_all'),
});

/** Voice notes and files that come with an enquiry, for whoever prepares the quote. */
@Controller('crm')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** POST /api/crm/leads/:id/attachments  (multipart: file, durationSeconds?, transcript?) */
  @Post('leads/:id/attachments')
  @RequirePermission('lead:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async upload(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Param('id', new ParseUUIDPipe()) leadId: string,
    @UploadedFile() file: UploadedFileShape | undefined,
    @Body() body: { durationSeconds?: string; transcript?: string }
  ) {
    return this.attachments.add(tenant.id, user?.id ?? null, viewerOf(user), leadId, file, body?.durationSeconds, body?.transcript);
  }

  /** GET /api/crm/attachments?leadId=… or ?customerId=… */
  @Get('attachments')
  @RequirePermission('lead:view')
  async list(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Query('leadId') leadId?: string,
    @Query('customerId') customerId?: string
  ) {
    return this.attachments.list(tenant.id, viewerOf(user), { leadId: leadId || undefined, customerId: customerId || undefined });
  }

  /** GET /api/crm/attachments/:id/file : the bytes. Only voice notes, photos and PDFs may be shown in place. */
  @Get('attachments/:id/file')
  @RequirePermission('lead:view')
  async download(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response
  ) {
    const a = await this.attachments.get(tenant.id, viewerOf(user), id);
    const inline = isInlineViewable(a.mimeType);
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Length', String(a.data.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(sanitizeFileName(a.fileName))}`
    );
    res.send(a.data);
  }

  /** DELETE /api/crm/attachments/:id */
  @Delete('attachments/:id')
  @RequirePermission('lead:update')
  async remove(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { id: string; role?: string } | undefined,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.attachments.remove(tenant.id, viewerOf(user), id);
  }
}
