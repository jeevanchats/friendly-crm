import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { CreateQuotationDto } from '@friendly-crm/shared';

export interface QuotationPdfData {
  quoteNumber: string;
  validUntil?: string | Date;
  items?: Array<{
    description?: string;
    quantity: number;
    unitPrice?: number | string | null;
    total?: number | string | null;
    lineTotal?: number | string | null;
  }>;
  subtotal?: string | number | null;
  subTotal?: string | number | null;
  taxTotal?: string | number | null;
  discountTotal?: string | number | null;
  grandTotal?: string | number | null;
  [key: string]: any;
}

@Injectable()
export class PdfEngineService {
  async generateQuotationPdf(quote: QuotationPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text('FRIENDLY CRM - QUOTATION', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Quote #: ${quote.quoteNumber}`);
      doc.text(`Date: ${new Date().toLocaleDateString()}`);
      if (quote.validUntil) {
        doc.text(`Valid Until: ${new Date(quote.validUntil).toLocaleDateString()}`);
      }
      doc.moveDown();

      // Divider
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Line items table
      doc.fontSize(12).text('Line Items', { underline: true });
      doc.moveDown(0.5);

      (quote.items || []).forEach((item, index) => {
        doc.fontSize(10).text(
          `${index + 1}. ${item.description || 'Job Item'} - Qty: ${item.quantity} x Rs.${item.unitPrice ?? '—'} = Rs.${item.lineTotal ?? item.total ?? '—'}`
        );
      });

      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Totals
      const sub = quote.subTotal ?? quote.subtotal ?? '0.00';
      const tax = quote.taxTotal ?? '0.00';
      const disc = quote.discountTotal ?? '0.00';
      const grand = quote.grandTotal ?? '0.00';

      doc.fontSize(10).text(`Subtotal: Rs.${sub}`, { align: 'right' });
      doc.text(`Tax Total (GST): Rs.${tax}`, { align: 'right' });
      doc.text(`Discount: Rs.${disc}`, { align: 'right' });
      doc.fontSize(14).text(`Grand Total: Rs.${grand}`, { align: 'right' });

      doc.end();
    });
  }
}
