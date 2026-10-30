import { PaymentDetails, completeBank } from '@friendly-crm/shared';
import { isValidUpiId } from './upi';
import { RUPEE } from '../../common/pdf/pdf-fonts';

// qrcode is a CommonJS module
const QRCode = require('qrcode');

/**
 * Customers pay the business directly: by bank transfer to the account shown, or by scanning a UPI QR code.
 * There is no payment gateway; staff record each payment when it arrives.
 */

/** What the business has set to be paid into, from a tenant row (database or memory). */
export function paymentFromTenantRow(r: any): PaymentDetails {
  return {
    upiId: r?.upiId && isValidUpiId(r.upiId) ? r.upiId : null,
    bank: completeBank({
      accountName: r?.bankAccountName,
      bankName: r?.bankName,
      accountNumber: r?.bankAccountNumber,
      ifsc: r?.bankIfsc,
      branch: r?.bankBranch,
    }),
  };
}

/**
 * The text a UPI app reads from a QR code: upi://pay?pa=..&pn=..[&am=..]&cu=INR[&tn=..].
 * Without an amount the customer types it in their app (used where the amount is not fixed yet, such as a quotation).
 */
export function buildUpiQrPayload(input: { upiId: string; payeeName: string; amountPaise?: number | null; note?: string }): string {
  if (!isValidUpiId(input.upiId)) throw new Error('Invalid UPI ID');
  const enc = encodeURIComponent;
  let out = `upi://pay?pa=${enc(input.upiId)}&pn=${enc(input.payeeName.slice(0, 60))}`;
  if (input.amountPaise !== undefined && input.amountPaise !== null) {
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error('Invalid UPI amount');
    out += `&am=${Math.floor(input.amountPaise / 100)}.${String(input.amountPaise % 100).padStart(2, '0')}`;
  }
  out += '&cu=INR';
  if (input.note) out += `&tn=${enc(input.note.slice(0, 40))}`;
  return out;
}

export async function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { type: 'png', margin: 1, width: 260, errorCorrectionLevel: 'M' });
}

/** Everything a printed document needs to show how to pay. */
export interface PdfPayment {
  upiId: string | null;
  bank: PaymentDetails['bank'];
  qrPng: Buffer | null;
  /** The amount the QR code asks for, when it is fixed (an invoice's balance). */
  amountPaise: number | null;
}

/** Null when the business has set neither bank details nor a UPI ID. */
export async function preparePdfPayment(
  details: PaymentDetails | null | undefined,
  payeeName: string,
  opts: { amountPaise?: number | null; note?: string } = {}
): Promise<PdfPayment | null> {
  if (!details || (!details.bank && !details.upiId)) return null;
  let png: Buffer | null = null;
  if (details.upiId) {
    try {
      png = await qrPng(buildUpiQrPayload({ upiId: details.upiId, payeeName, amountPaise: opts.amountPaise ?? null, note: opts.note }));
    } catch {
      png = null; // a QR that cannot be made must not stop the document: the text details still print
    }
  }
  return { upiId: details.upiId, bank: details.bank, qrPng: png, amountPaise: opts.amountPaise ?? null };
}

const rs = (paise: number) => `${RUPEE} ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Draws the "how to pay" block (bank account lines, UPI ID and the QR code) at `y` and returns where it ends.
 * Moves to a new page first when it would not fit above `bottom`.
 */
export function drawPaymentBlock(
  doc: any,
  pay: PdfPayment,
  y: number,
  layout: { margin: number; width: number; bottom: number; pageTop: number }
): number {
  const QR = 84;
  const lines: Array<[string, string]> = [];
  if (pay.bank) {
    lines.push(['Account name', pay.bank.accountName]);
    if (pay.bank.bankName) lines.push(['Bank', pay.bank.branch ? `${pay.bank.bankName}, ${pay.bank.branch}` : pay.bank.bankName]);
    lines.push(['Account no', pay.bank.accountNumber]);
    lines.push(['IFSC', pay.bank.ifsc]);
  }
  if (pay.upiId) lines.push(['UPI ID', pay.upiId]);
  const height = Math.max(22 + lines.length * 12 + 6, pay.qrPng ? 24 + QR + 14 : 0) + 6;

  let top = y + 10;
  if (top + height > layout.bottom) {
    doc.addPage();
    top = layout.pageTop;
  }
  doc.rect(layout.margin, top, layout.width, height).strokeColor('#BBB').lineWidth(0.6).stroke();
  doc.font('BodyBold').fontSize(8).fillColor('#666').text('HOW TO PAY', layout.margin + 8, top + 7, { width: layout.width - 16 });
  let ly = top + 20;
  for (const [label, value] of lines) {
    doc.font('Body').fontSize(8.5).fillColor('#555').text(`${label}:`, layout.margin + 8, ly, { width: 70 });
    doc.font('BodyBold').fillColor('#000').text(value, layout.margin + 80, ly, { width: layout.width - 80 - (pay.qrPng ? QR + 24 : 16) });
    ly += 12;
  }
  if (pay.qrPng) {
    const qx = layout.margin + layout.width - QR - 12;
    doc.image(pay.qrPng, qx, top + 8, { width: QR, height: QR });
    doc.font('Body').fontSize(7.5).fillColor('#555').text(
      pay.amountPaise ? `Scan to pay ${rs(pay.amountPaise)}` : 'Scan to pay (UPI)',
      qx - 6,
      top + 8 + QR + 2,
      { width: QR + 12, align: 'center' }
    );
  }
  doc.fillColor('#000');
  return top + height;
}
