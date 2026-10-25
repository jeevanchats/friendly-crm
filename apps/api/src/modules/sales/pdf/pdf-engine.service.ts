import { Injectable } from '@nestjs/common';

// pdfkit is a CommonJS module whose root export is the document constructor
const PDFDocument = require('pdfkit');

export interface QuotationDocument {
  quoteNumber: string;
  version?: number | null;
  createdAt?: string | Date | null;
  validUntil?: string | Date | null;
  termsAndConditions?: string | null;
  business: { name: string; address?: string | null; gstin?: string | null; phone?: string | null };
  customer: { name: string; companyName?: string | null; phone?: string | null; gstin?: string | null; address?: string | null };
  items: Array<{
    itemName: string;
    description?: string | null;
    hsnCode?: string | null;
    quantity: number | string;
    unit?: string | null;
    unitPrice?: number | string | null;
    taxPercent?: number | string | null;
    lineTotal?: number | string | null;
  }>;
  /** Null amounts (for roles that may not see money) print as a dash. */
  totals: { subTotal?: string | number | null; taxTotal?: string | number | null; discountTotal?: string | number | null; grandTotal?: string | number | null };
}

const MARGIN = 40;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 80;

/** Helvetica has no rupee glyph, so amounts print as "Rs." */
const inr = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
};
const dateIn = (d: unknown) =>
  d ? new Date(d as any).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';

interface Col {
  key: string;
  label: string;
  w: number;
  align: 'left' | 'right' | 'center';
}

@Injectable()
export class PdfEngineService {
  /** The quotation a customer receives: the business's own name and details, the items with GST, and the totals. */
  async generateQuotationPdf(q: QuotationDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: `Quotation ${q.quoteNumber}` } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ---- header: the business
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text(q.business.name, MARGIN, MARGIN, { width: CONTENT_W - 150 });
      doc.font('Helvetica').fontSize(8.5).fillColor('#444');
      if (q.business.address) doc.text(q.business.address, { width: CONTENT_W - 150 });
      const contact = [q.business.phone && `Phone: ${q.business.phone}`, q.business.gstin && `GSTIN: ${q.business.gstin}`].filter(Boolean).join('   ');
      if (contact) doc.text(contact, { width: CONTENT_W - 150 });
      const headerEnd = doc.y;

      doc.font('Helvetica-Bold').fontSize(18).fillColor('#167D79').text('QUOTATION', MARGIN + CONTENT_W - 150, MARGIN, { width: 150, align: 'right' });
      doc.font('Helvetica').fontSize(8.5).fillColor('#000');
      const meta: Array<[string, string]> = [['Quote No', `${q.quoteNumber}${q.version && q.version > 1 ? ` (v${q.version})` : ''}`]];
      if (q.createdAt) meta.push(['Date', dateIn(q.createdAt)]);
      if (q.validUntil) meta.push(['Valid until', dateIn(q.validUntil)]);
      let my = doc.y + 2;
      for (const [k, v] of meta) {
        doc.font('Helvetica').fillColor('#666').text(`${k}:`, MARGIN + CONTENT_W - 150, my, { width: 58, align: 'right' });
        doc.font('Helvetica-Bold').fillColor('#000').text(v, MARGIN + CONTENT_W - 88, my, { width: 88, align: 'right' });
        my = doc.y + 1;
      }

      let y = Math.max(headerEnd, my) + 10;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor('#999').lineWidth(0.6).stroke();
      y += 8;

      // ---- the customer
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#666').text('QUOTATION FOR', MARGIN, y);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000').text(q.customer.companyName || q.customer.name, MARGIN, doc.y + 2, { width: CONTENT_W });
      doc.font('Helvetica').fontSize(8.5).fillColor('#444');
      if (q.customer.companyName && q.customer.name && q.customer.companyName !== q.customer.name) doc.text(`Attn: ${q.customer.name}`);
      if (q.customer.address) doc.text(q.customer.address, { width: CONTENT_W });
      const cLine = [q.customer.phone && `Phone: ${q.customer.phone}`, q.customer.gstin && `GSTIN: ${q.customer.gstin}`].filter(Boolean).join('   ');
      if (cLine) doc.text(cLine);
      y = doc.y + 12;

      // ---- items
      const cols: Col[] = [
        { key: 'no', label: '#', w: 20, align: 'center' },
        { key: 'item', label: 'Item', w: 190, align: 'left' },
        { key: 'hsn', label: 'HSN/SAC', w: 52, align: 'center' },
        { key: 'qty', label: 'Qty', w: 55, align: 'right' },
        { key: 'rate', label: 'Rate (Rs.)', w: 60, align: 'right' },
        { key: 'gst', label: 'GST', w: 36, align: 'right' },
        { key: 'amount', label: 'Amount incl. GST', w: 0, align: 'right' },
      ];
      cols[cols.length - 1].w = CONTENT_W - cols.slice(0, -1).reduce((s, c) => s + c.w, 0);
      const header = (top: number) => {
        doc.rect(MARGIN, top, CONTENT_W, 18).fill('#EEF2F1');
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
        let x = MARGIN;
        for (const c of cols) {
          doc.text(c.label, x + 3, top + 5, { width: c.w - 6, align: c.align });
          x += c.w;
        }
        return top + 22;
      };
      y = header(y);

      q.items.forEach((it, i) => {
        const itemText = it.description ? `${it.itemName}\n${it.description}` : it.itemName;
        doc.font('Helvetica').fontSize(8.5);
        const h = Math.max(16, doc.heightOfString(itemText, { width: cols[1].w - 6 }) + 7);
        if (y + h > BOTTOM) {
          doc.addPage();
          y = header(MARGIN);
        }
        const cell: Record<string, string> = {
          no: String(i + 1),
          item: itemText,
          hsn: it.hsnCode || '',
          qty: `${Number(it.quantity)}${it.unit ? ` ${it.unit}` : ''}`,
          rate: inr(it.unitPrice),
          gst: it.taxPercent === null || it.taxPercent === undefined ? '' : `${Number(it.taxPercent)}%`,
          amount: inr(it.lineTotal),
        };
        let x = MARGIN;
        doc.fillColor('#000');
        for (const c of cols) {
          doc.text(cell[c.key], x + 3, y + 3, { width: c.w - 6, align: c.align });
          x += c.w;
        }
        y += h;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor('#DDD').lineWidth(0.4).stroke();
      });

      // ---- totals (kept together)
      if (y + 110 > BOTTOM) {
        doc.addPage();
        y = MARGIN;
      }
      y += 8;
      const tx = MARGIN + CONTENT_W - 200;
      const row = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor('#000');
        doc.text(label, tx, y, { width: 100 });
        doc.text(value, tx + 100, y, { width: 100, align: 'right' });
        y += bold ? 17 : 13;
      };
      row('Subtotal', `Rs. ${inr(q.totals.subTotal)}`);
      row('GST', `Rs. ${inr(q.totals.taxTotal)}`);
      if (Number(q.totals.discountTotal) > 0) row('Discount', `- Rs. ${inr(q.totals.discountTotal)}`);
      doc.moveTo(tx, y).lineTo(tx + 200, y).strokeColor('#000').lineWidth(0.6).stroke();
      y += 4;
      row('Total', `Rs. ${inr(q.totals.grandTotal)}`, true);

      // ---- terms and the next step
      y += 10;
      doc.font('Helvetica').fontSize(8.5).fillColor('#444');
      if (q.termsAndConditions && q.termsAndConditions.trim()) {
        if (y + 60 > BOTTOM) {
          doc.addPage();
          y = MARGIN;
        }
        doc.font('Helvetica-Bold').fillColor('#000').text('Terms & conditions', MARGIN, y, { width: CONTENT_W });
        doc.font('Helvetica').fillColor('#444').text(q.termsAndConditions.trim(), MARGIN, doc.y + 2, { width: CONTENT_W });
      }

      const fy = PAGE_H - 60;
      doc.moveTo(MARGIN, fy).lineTo(MARGIN + CONTENT_W, fy).strokeColor('#999').lineWidth(0.6).stroke();
      doc.font('Helvetica').fontSize(8).fillColor('#555');
      doc.text(
        'This is a quotation, not a tax invoice. To approve it or ask for a change, reply "quotes" on the WhatsApp chat you received it on.',
        MARGIN,
        fy + 6,
        { width: CONTENT_W }
      );
      doc.end();
    });
  }
}
