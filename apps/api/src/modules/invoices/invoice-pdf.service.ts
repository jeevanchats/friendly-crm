import { Injectable } from '@nestjs/common';
import { GST_STATES, amountInWords } from '@friendly-crm/shared';
import type { InvoiceView } from './invoices.service';
import { PaymentDetails } from '@friendly-crm/shared';
import { drawPaymentBlock, preparePdfPayment } from '../payments/payment-info';

// pdfkit is a CommonJS module whose root export is the document constructor
const PDFDocument = require('pdfkit');

const MARGIN = 36;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 90; // leave room for the footer on every page

/** Helvetica has no rupee glyph, so amounts print as "Rs." */
const inr = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateIn = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

interface Col {
  key: string;
  label: string;
  w: number;
  align: 'left' | 'right' | 'center';
}

/** Renders an issued invoice as an A4 GST tax invoice. */
@Injectable()
export class InvoicePdfService {
  /**
   * `payment` (from the business's settings) adds the "how to pay" block with a UPI QR for the balance still due.
   * It is left out once the invoice is paid or cancelled.
   */
  async generate(inv: InvoiceView, details?: PaymentDetails | null): Promise<Buffer> {
    const owing = inv.payment.status === 'PAID' || inv.payment.status === 'CREDITED' ? 0 : Math.round(Number(inv.payment.balanceDue) * 100);
    const payment = owing > 0 ? await preparePdfPayment(details, inv.supplier.name, { amountPaise: owing, note: inv.invoiceNumber }) : null;
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: `Tax Invoice ${inv.invoiceNumber}` } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const inter = inv.supplyType === 'INTER';
      const cols: Col[] = [
        { key: 'no', label: '#', w: 20, align: 'center' },
        { key: 'desc', label: 'Description', w: inter ? 150 : 128, align: 'left' },
        { key: 'hsn', label: 'HSN/SAC', w: 48, align: 'center' },
        { key: 'qty', label: 'Qty', w: 40, align: 'right' },
        { key: 'rate', label: 'Rate', w: 52, align: 'right' },
        { key: 'taxable', label: 'Taxable', w: 62, align: 'right' },
        ...(inter
          ? [{ key: 'igst', label: 'IGST', w: 70, align: 'right' as const }]
          : [
              { key: 'cgst', label: 'CGST', w: 57, align: 'right' as const },
              { key: 'sgst', label: 'SGST', w: 57, align: 'right' as const },
            ]),
        { key: 'total', label: 'Total', w: 0, align: 'right' },
      ];
      cols[cols.length - 1].w = CONTENT_W - cols.slice(0, -1).reduce((s, c) => s + c.w, 0);

      // ---- header
      doc.font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', MARGIN, MARGIN, { align: 'center', width: CONTENT_W });
      doc.font('Helvetica').fontSize(8).fillColor('#666').text('Original for Recipient', { align: 'center', width: CONTENT_W });
      doc.fillColor('#000');

      let y = 78;
      const half = CONTENT_W / 2 - 6;
      const party = (title: string, p: InvoiceView['supplier'], x: number, top: number) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#666').text(title.toUpperCase(), x, top, { width: half });
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(p.name, x, top + 12, { width: half });
        doc.font('Helvetica').fontSize(8.5);
        if (p.address) doc.text(p.address, x, doc.y, { width: half });
        doc.text(p.gstin ? `GSTIN: ${p.gstin}` : 'GSTIN: Unregistered', x, doc.y, { width: half });
        if (p.stateCode) doc.text(`State: ${p.stateCode} - ${GST_STATES[p.stateCode] ?? ''}`, x, doc.y, { width: half });
        if (p.phone) doc.text(`Phone: ${p.phone}`, x, doc.y, { width: half });
        return doc.y;
      };
      const leftEnd = party('Sold by', inv.supplier, MARGIN, y);
      // invoice meta on the right
      const mx = MARGIN + CONTENT_W / 2 + 6;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#666').text('INVOICE DETAILS', mx, y, { width: half });
      doc.fillColor('#000').font('Helvetica').fontSize(8.5);
      const meta: Array<[string, string]> = [
        ['Invoice No', inv.invoiceNumber],
        ['Invoice Date', dateIn(inv.issuedAt)],
        ['Order Ref', inv.orderNumber],
        ['Place of Supply', `${inv.placeOfSupply.stateCode} - ${inv.placeOfSupply.stateName}`],
        ['Reverse Charge', 'No'],
      ];
      let my = y + 12;
      for (const [k, v] of meta) {
        doc.font('Helvetica').text(`${k}:`, mx, my, { width: 80, continued: false });
        doc.font('Helvetica-Bold').text(v, mx + 82, my, { width: half - 82 });
        my = Math.max(my + 12, doc.y);
      }
      y = Math.max(leftEnd, my) + 10;
      const buyerEnd = party('Billed to', inv.buyer, MARGIN, y);
      y = buyerEnd + 12;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor('#999').lineWidth(0.6).stroke();
      y += 6;

      // ---- table
      const header = (top: number) => {
        doc.rect(MARGIN, top, CONTENT_W, 18).fill('#EEF2F1');
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
        let x = MARGIN;
        for (const c of cols) {
          doc.text(c.label, x + 2, top + 5, { width: c.w - 4, align: c.align });
          x += c.w;
        }
        return top + 22;
      };
      y = header(y);

      doc.font('Helvetica').fontSize(8.5);
      for (const l of inv.lines) {
        const desc = l.description ? `${l.itemName}\n${l.description}` : l.itemName;
        const descCol = cols[1];
        const h = Math.max(16, doc.heightOfString(desc, { width: descCol.w - 4 }) + 6);
        if (y + h > BOTTOM) {
          doc.addPage();
          y = header(MARGIN);
          doc.font('Helvetica').fontSize(8.5);
        }
        const cell: Record<string, string> = {
          no: String(l.lineNo),
          desc,
          hsn: l.hsnCode,
          qty: `${Number(l.quantity)} ${l.unit}`,
          rate: inr(l.unitPrice),
          taxable: inr(l.taxableValue),
          igst: `${inr(l.igst)}\n@${Number(l.taxPercent)}%`,
          cgst: `${inr(l.cgst)}\n@${Number(l.taxPercent) / 2}%`,
          sgst: `${inr(l.sgst)}\n@${Number(l.taxPercent) / 2}%`,
          total: inr(l.lineTotal),
        };
        let x = MARGIN;
        doc.fillColor('#000');
        for (const c of cols) {
          doc.text(cell[c.key], x + 2, y + 3, { width: c.w - 4, align: c.align });
          x += c.w;
        }
        y += h;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor('#DDD').lineWidth(0.4).stroke();
      }

      // ---- totals (keep together on one page)
      const totalsH = 110;
      if (y + totalsH > BOTTOM) {
        doc.addPage();
        y = MARGIN;
      }
      y += 8;
      const totalsTop = y;
      const tx = MARGIN + CONTENT_W - 190;
      const row = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5).fillColor('#000');
        doc.text(label, tx, y, { width: 100 });
        doc.text(value, tx + 100, y, { width: 90, align: 'right' });
        y += bold ? 16 : 13;
      };
      row('Taxable value', `Rs. ${inr(inv.totals.taxableValue)}`);
      if (inter) {
        row('IGST', `Rs. ${inr(inv.totals.igst)}`);
      } else {
        row('CGST', `Rs. ${inr(inv.totals.cgst)}`);
        row('SGST', `Rs. ${inr(inv.totals.sgst)}`);
      }
      if (Number(inv.totals.roundOff) !== 0) row('Round off', `Rs. ${inr(inv.totals.roundOff)}`);
      doc.moveTo(tx, y).lineTo(tx + 190, y).strokeColor('#000').lineWidth(0.6).stroke();
      y += 4;
      row('Grand total', `Rs. ${inr(inv.totals.grandTotal)}`, true);

      doc.font('Helvetica').fontSize(8.5).fillColor('#000');
      const words = amountInWords(Math.round(Number(inv.totals.grandTotal) * 100));
      doc.font('Helvetica-Bold').text('Amount in words: ', MARGIN, totalsTop, { continued: true, width: CONTENT_W - 200 });
      doc.font('Helvetica').text(words, { width: CONTENT_W - 200 });
      if (inv.payment.status !== 'UNPAID') {
        doc.moveDown(0.5).font('Helvetica').text(
          `Received: Rs. ${inr(inv.payment.paid)}   |   Balance due: Rs. ${inr(inv.payment.balanceDue)}`,
          MARGIN,
          doc.y,
          { width: CONTENT_W - 200 }
        );
      }

      // ---- how to pay
      if (payment) drawPaymentBlock(doc, payment, y, { margin: MARGIN, width: CONTENT_W, bottom: BOTTOM, pageTop: MARGIN });

      // ---- footer (last page)
      const fy = PAGE_H - 76;
      doc.moveTo(MARGIN, fy).lineTo(MARGIN + CONTENT_W, fy).strokeColor('#999').lineWidth(0.6).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor('#555');
      doc.text('This is a computer-generated invoice.', MARGIN, fy + 6, { width: CONTENT_W / 2 });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000').text(`For ${inv.supplier.name}`, MARGIN + CONTENT_W / 2, fy + 6, {
        width: CONTENT_W / 2,
        align: 'right',
      });
      doc.font('Helvetica').fontSize(8).fillColor('#555').text('Authorised Signatory', MARGIN + CONTENT_W / 2, fy + 40, {
        width: CONTENT_W / 2,
        align: 'right',
      });
      doc.end();
    });
  }
}
