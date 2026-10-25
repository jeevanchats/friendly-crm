import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import { CreditNotePdfService } from './credit-note-pdf.service';
import { EwayBillsController } from './eway-bills.controller';
import { EwayBillsService } from './eway-bills.service';

@Module({
  controllers: [InvoicesController, CreditNotesController, EwayBillsController],
  providers: [InvoicesService, InvoicePdfService, CreditNotesService, CreditNotePdfService, EwayBillsService],
  exports: [InvoicesService, CreditNotesService],
})
export class InvoicesModule {}
