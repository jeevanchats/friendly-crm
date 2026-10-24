import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { PdfEngineService } from './pdf/pdf-engine.service';
import { CustomerQuoteService } from './customer-quote.service';

@Module({
  controllers: [SalesController],
  providers: [SalesService, PdfEngineService, CustomerQuoteService],
  exports: [SalesService, PdfEngineService, CustomerQuoteService],
})
export class SalesModule {}
