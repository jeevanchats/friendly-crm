import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { CreateQuotationDto } from '@friendly-crm/shared';

@Injectable()
export class PdfEngineService {
  async generateQuotationPdf(quote: CreateQuotationDto & { quoteNumber: string }): Promise<Buffer> {
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
      doc.text(`Valid Until: ${new Date(quote.validUntil).toLocaleDateString()}`);
      doc.moveDown();

      // Divider
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Line items table
      doc.fontSize(12).text('Line Items', { underline: true });
      doc.moveDown(0.5);

      quote.items.forEach((item, index) => {
        doc.fontSize(10).text(
          `${index + 1}. ${item.description} - Qty: ${item.quantity} x Rs.${item.unitPrice} = Rs.${item.total}`
        );
      });

      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Totals
      doc.fontSize(10).text(`Subtotal: Rs.${quote.subtotal}`, { align: 'right' });
      doc.text(`Tax Total (GST): Rs.${quote.taxTotal}`, { align: 'right' });
      doc.text(`Discount: Rs.${quote.discountTotal}`, { align: 'right' });
      doc.fontSize(14).text(`Grand Total: Rs.${quote.grandTotal}`, { align: 'right' });

      doc.end();
    });
  }
}
