import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { SalesService } from './sales.service';
import { QuoteLinkService } from './quote-link.service';

/**
 * The customer-facing quote link. No login: the signed token in the address is the key (see QuoteLinkService).
 * Anything wrong with the token (forged, expired, unknown quote) gets the same plain 404, so the link reveals nothing.
 */
@Controller('public/quotes')
export class PublicQuotesController {
  constructor(
    private readonly sales: SalesService,
    private readonly links: QuoteLinkService
  ) {}

  /** GET /api/public/quotes/:token/pdf */
  @Get(':token/pdf')
  async pdf(@Param('token') token: string, @Res() res: Response) {
    const claim = this.links.verify(token);
    if (!claim) throw new NotFoundException();
    // 'OWNER' so the customer sees the prices; the token only ever opens this one quote.
    let data;
    try {
      data = await this.sales.getQuotationById(claim.quoteId, claim.tenantId, 'OWNER');
    } catch {
      throw new NotFoundException();
    }
    const buf = await this.sales.generateQuotationPdf(claim.quoteId, claim.tenantId, 'OWNER');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Quotation-${String(data.quote.quoteNumber).replace(/[^A-Za-z0-9-]/g, '-')}.pdf"`);
    // A private document: not stored by shared caches, not indexed, and the address is not passed on as a referrer.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(buf);
  }
}
