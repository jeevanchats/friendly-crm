import { Controller, Get, HttpException, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { db, sql } from '@friendly-crm/db';
import { tenantContextStorage } from '../../common/interceptors/tenant-rls.interceptor';
import { SalesService } from './sales.service';
import { QuoteLinkService } from './quote-link.service';

/**
 * The customer-facing quote link. No login: the signed token in the address is the key (see QuoteLinkService).
 * Anything wrong with the token (forged, expired, unknown quote) gets the same plain 404, so the link reveals nothing.
 *
 * The short form /api/q/:token is what customers are sent. /api/public/quotes/:token/pdf is the earlier address,
 * kept so links already sent keep working.
 *
 * The customer always sees the CURRENT version of the quote: a link sent before staff revised it opens the revision.
 */
@Controller(['q', 'public/quotes'])
export class PublicQuotesController {
  constructor(
    private readonly sales: SalesService,
    private readonly links: QuoteLinkService
  ) {}

  @Get(':token')
  open(@Param('token') token: string, @Res() res: Response) {
    return this.send(token, res);
  }

  @Get(':token/pdf')
  openPdf(@Param('token') token: string, @Res() res: Response) {
    return this.send(token, res);
  }

  /**
   * There is no logged-in user here, so row-level security needs the business set by hand, as the staff routes do
   * through TenantRlsInterceptor. Without this the restricted database role would see no rows and every link would 404.
   */
  private async inTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    if (db && typeof db.transaction === 'function') {
      try {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          return tenantContextStorage.run({ tenantId, tx }, fn);
        });
      } catch (err: any) {
        if (err instanceof HttpException) throw err;
        // No database (local development without Postgres): the services fall back to their in-memory stores.
      }
    }
    return tenantContextStorage.run({ tenantId }, fn);
  }

  private async send(token: string, res: Response) {
    const claim = this.links.verify(token);
    if (!claim) throw new NotFoundException();

    let pdf: { buf: Buffer; quoteNumber: string; version: number };
    try {
      pdf = await this.inTenant(claim.tenantId, async () => {
        const latestId = await this.sales.getLatestQuoteId(claim.tenantId, claim.quoteId);
        // 'OWNER' so the customer sees the prices; the token only ever opens this one quote.
        const data = await this.sales.getQuotationById(latestId, claim.tenantId, 'OWNER');
        const buf = await this.sales.generateQuotationPdf(latestId, claim.tenantId, 'OWNER');
        return { buf, quoteNumber: String(data.quote.quoteNumber), version: Number(data.quote.version ?? 1) };
      });
    } catch {
      throw new NotFoundException();
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Quotation-${pdf.quoteNumber.replace(/[^A-Za-z0-9-]/g, '-')}.pdf"`);
    res.setHeader('X-Quote-Version', String(pdf.version));
    // A private document: not stored by shared caches, not indexed, and the address is not passed on as a referrer.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(pdf.buf);
  }
}
