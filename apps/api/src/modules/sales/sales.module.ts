import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { PdfEngineService } from './pdf/pdf-engine.service';
import { CustomerQuoteService } from './customer-quote.service';
import { QuoteLinkService } from './quote-link.service';
import { PublicQuotesController } from './public-quotes.controller';

@Module({
  controllers: [SalesController, PublicQuotesController],
  providers: [SalesService, PdfEngineService, CustomerQuoteService, QuoteLinkService],
  exports: [SalesService, PdfEngineService, CustomerQuoteService, QuoteLinkService],
})
export class SalesModule {}
