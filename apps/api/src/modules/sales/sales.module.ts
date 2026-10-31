import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { PdfEngineService } from './pdf/pdf-engine.service';
import { CustomerQuoteService } from './customer-quote.service';
import { QuoteLinkService } from './quote-link.service';
import { PublicQuotesController } from './public-quotes.controller';
import { QuoteReaderService } from './quote-reader.service';
import { DocumentTextService } from './document-text.service';
import { PriceHistoryService } from './price-history.service';
import { CrmModule } from '../crm/crm.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [CrmModule, ProductsModule],
  controllers: [SalesController, PublicQuotesController],
  providers: [SalesService, PdfEngineService, CustomerQuoteService, QuoteLinkService, QuoteReaderService, DocumentTextService, PriceHistoryService],
  exports: [SalesService, PdfEngineService, CustomerQuoteService, QuoteLinkService, QuoteReaderService],
})
export class SalesModule {}
