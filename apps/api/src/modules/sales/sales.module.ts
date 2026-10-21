import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { PdfEngineService } from './pdf/pdf-engine.service';

@Module({
  controllers: [SalesController],
  providers: [SalesService, PdfEngineService],
  exports: [SalesService, PdfEngineService],
})
export class SalesModule {}
