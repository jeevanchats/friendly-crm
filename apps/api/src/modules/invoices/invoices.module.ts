import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import { CreditNotePdfService } from './credit-note-pdf.service';

@Module({
  controllers: [InvoicesController, CreditNotesController],
  providers: [InvoicesService, InvoicePdfService, CreditNotesService, CreditNotePdfService],
  exports: [InvoicesService, CreditNotesService],
})
export class InvoicesModule {}
