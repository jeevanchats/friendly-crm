import { Injectable } from '@nestjs/common';
import { GST_STATES, amountInWords } from '@friendly-crm/shared';
import type { CreditNoteView } from './credit-notes.service';
import { RUPEE, preparePdfFonts } from '../../common/pdf/pdf-fonts';

// pdfkit is a CommonJS module whose root export is the document constructor
const PDFDocument = require('pdfkit');

const MARGIN = 36;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = PAGE_H - 90;

const inr = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateIn = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';

interface Col {
  key: string;
  label: string;
  w: number;
  align: 'left' | 'right' | 'center';
}

/** Renders an issued credit note as an A4 document that refers back to the invoice it reduces. */
@Injectable()
export class CreditNotePdfService {
  generate(cn: CreditNoteView): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: `Credit Note ${cn.creditNoteNumber}` } });
      preparePdfFonts(doc);
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const inter = cn.supplyType === 'INTER';
      const cols: Col[] = [
        { key: 'no', label: '#', w: 20, align: 'center' },
        { key: 'desc', label: 'Description', w: inter ? 150 : 128, align: 'left' },
        { key: 'hsn', label: 'HSN/SAC', w: 48, align: 'center' },
        { key: 'qty', label: 'Qty returned', w: 52, align: 'right' },
        { key: 'rate', label: 'Rate', w: 48, align: 'right' },
        { key: 'taxable', label: 'Taxable', w: 60, align: 'right' },
        ...(inter
          ? [{ key: 'igst', label: 'IGST', w: 66, align: 'right' as const }]
          : [
              { key: 'cgst', label: 'CGST', w: 55, align: 'right' as const },
              { key: 'sgst', label: 'SGST', w: 55, align: 'right' as const },
            ]),
        { key: 'total', label: 'Total', w: 0, align: 'right' },
      ];
      cols[cols.length - 1].w = CONTENT_W - cols.slice(0, -1).reduce((s, c) => s + c.w, 0);

      // ---- header
      doc.font('BodyBold').fontSize(16).text('CREDIT NOTE', MARGIN, MARGIN, { align: 'center', width: CONTENT_W });
      doc.font('Body').fontSize(8).fillColor('#666').text('Issued under section 34 of the CGST Act', { align: 'center', width: CONTENT_W });
      doc.fillColor('#000');

      let y = 78;
      const half = CONTENT_W / 2 - 6;
      const party = (title: string, p: CreditNoteView['supplier'], x: number, top: number) => {
        doc.font('BodyBold').fontSize(8).fillColor('#666').text(title.toUpperCase(), x, top, { width: half });
        doc.font('BodyBold').fontSize(10).fillColor('#000').text(p.name, x, top + 12, { width: half });
        doc.font('Body').fontSize(8.5);
        if (p.address) doc.text(p.address, x, doc.y, { width: half });
        doc.text(p.gstin ? `GSTIN: ${p.gstin}` : 'GSTIN: Unregistered', x, doc.y, { width: half });
        if (p.stateCode) doc.text(`State: ${p.stateCode} - ${GST_STATES[p.stateCode] ?? ''}`, x, doc.y, { width: half });
        return doc.y;
      };
      const leftEnd = party('Issued by', cn.supplier, MARGIN, y);
      const mx = MARGIN + CONTENT_W / 2 + 6;
      doc.font('BodyBold').fontSize(8).fillColor('#666').text('CREDIT NOTE DETAILS', mx, y, { width: half });
      doc.fillColor('#000').font('Body').fontSize(8.5);
      const meta: Array<[string, string]> = [
        ['Credit Note No', cn.creditNoteNumber],
        ['Date', dateIn(cn.issuedAt)],
        ['Original Invoice', cn.invoice.invoiceNumber],
        ['Invoice Date', dateIn(cn.invoice.issuedAt)],
        ['Place of Supply', `${cn.placeOfSupply.stateCode} - ${cn.placeOfSupply.stateName}`],
        ['Reason', cn.reasonLabel],
      ];
      let my = y + 12;
      for (const [k, v] of meta) {
        doc.font('Body').text(`${k}:`, mx, my, { width: 82, continued: false });
        doc.font('BodyBold').text(v, mx + 84, my, { width: half - 84 });
        my = Math.max(my + 12, doc.y);
      }
      y = Math.max(leftEnd, my) + 10;
      const buyerEnd = party('Credited to', cn.buyer, MARGIN, y);
      y = buyerEnd + 6;
      if (cn.reasonNote) {
        doc.font('Body').fontSize(8.5).fillColor('#000').text(`Note: ${cn.reasonNote}`, MARGIN, y, { width: CONTENT_W });
        y = doc.y;
      }
      y += 8;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor('#999').lineWidth(0.6).stroke();
      y += 6;

      // ---- table
      const header = (top: number) => {
        doc.rect(MARGIN, top, CONTENT_W, 18).fill('#EEF2F1');
        doc.fillColor('#000').font('BodyBold').fontSize(7.5);
        let x = MARGIN;
        for (const c of cols) {
          doc.text(c.label, x + 2, top + 5, { width: c.w - 4, align: c.align });
          x += c.w;
        }
        return top + 22;
      };
      y = header(y);

      doc.font('Body').fontSize(8.5);
      for (const l of cn.lines) {
        const desc = l.description ? `${l.itemName}\n${l.description}` : l.itemName;
        const h = Math.max(16, doc.heightOfString(desc, { width: cols[1].w - 4 }) + 6);
        if (y + h > BOTTOM) {
          doc.addPage();
          y = header(MARGIN);
          doc.font('Body').fontSize(8.5);
        }
        const cell: Record<string, string> = {
          no: String(l.lineNo),
          desc,
          hsn: l.hsnCode,
          qty: Number(l.quantity) > 0 ? `${Number(l.quantity)} ${l.unit}` : '-',
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

      // ---- totals
      if (y + 110 > BOTTOM) {
        doc.addPage();
        y = MARGIN;
      }
      y += 8;
      const totalsTop = y;
      const tx = MARGIN + CONTENT_W - 190;
      const row = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'BodyBold' : 'Body').fontSize(bold ? 10 : 8.5).fillColor('#000');
        doc.text(label, tx, y, { width: 100 });
        doc.text(value, tx + 100, y, { width: 90, align: 'right' });
        y += bold ? 16 : 13;
      };
      row('Taxable value', `${RUPEE} ${inr(cn.totals.taxableValue)}`);
      if (inter) {
        row('IGST', `${RUPEE} ${inr(cn.totals.igst)}`);
      } else {
        row('CGST', `${RUPEE} ${inr(cn.totals.cgst)}`);
        row('SGST', `${RUPEE} ${inr(cn.totals.sgst)}`);
      }
      if (Number(cn.totals.roundOff) !== 0) row('Round off', `${RUPEE} ${inr(cn.totals.roundOff)}`);
      doc.moveTo(tx, y).lineTo(tx + 190, y).strokeColor('#000').lineWidth(0.6).stroke();
      y += 4;
      row('Total credited', `${RUPEE} ${inr(cn.totals.grandTotal)}`, true);

      doc.font('Body').fontSize(8.5).fillColor('#000');
      doc.font('BodyBold').text('Amount in words: ', MARGIN, totalsTop, { continued: true, width: CONTENT_W - 200 });
      doc.font('Body').text(amountInWords(Math.round(Number(cn.totals.grandTotal) * 100)), { width: CONTENT_W - 200 });

      // ---- footer
      const fy = PAGE_H - 76;
      doc.moveTo(MARGIN, fy).lineTo(MARGIN + CONTENT_W, fy).strokeColor('#999').lineWidth(0.6).stroke();
      doc.font('Body').fontSize(7.5).fillColor('#555');
      doc.text(`This credit note reduces invoice ${cn.invoice.invoiceNumber}. It is computer generated.`, MARGIN, fy + 6, { width: CONTENT_W / 2 });
      doc.font('BodyBold').fontSize(8.5).fillColor('#000').text(`For ${cn.supplier.name}`, MARGIN + CONTENT_W / 2, fy + 6, {
        width: CONTENT_W / 2,
        align: 'right',
      });
      doc.font('Body').fontSize(8).fillColor('#555').text('Authorised Signatory', MARGIN + CONTENT_W / 2, fy + 40, {
        width: CONTENT_W / 2,
        align: 'right',
      });
      doc.end();
    });
  }
}
