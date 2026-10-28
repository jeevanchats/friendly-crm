/**
 * How a customer is shown to pay: the business's bank account and/or its UPI ID (the latter also becomes a QR code
 * on printed documents). There is no payment gateway and no third party: the customer pays the business directly and
 * staff record the payment when it arrives.
 */

export interface BankDetails {
  accountName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  branch?: string | null;
}

export interface PaymentDetails {
  upiId: string | null;
  bank: BankDetails | null;
}

/** An IFSC is 4 letters, a zero, then 6 letters or digits: HDFC0001234. */
export function normalizeIfsc(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) ? v : null;
}

/** Indian bank account numbers are 9 to 18 digits. Spaces and dashes people type are dropped. */
export function normalizeAccountNumber(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const v = String(raw).replace(/[\s-]/g, '');
  return /^\d{9,18}$/.test(v) ? v : null;
}

/** Bank details are usable only when the name, account number and IFSC are all there. */
export function completeBank(b: {
  accountName?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  branch?: string | null;
}): BankDetails | null {
  const accountName = (b.accountName ?? '').trim();
  const accountNumber = normalizeAccountNumber(b.accountNumber ?? '');
  const ifsc = normalizeIfsc(b.ifsc ?? '');
  if (!accountName || !accountNumber || !ifsc) return null;
  return { accountName, bankName: (b.bankName ?? '').trim(), accountNumber, ifsc, branch: (b.branch ?? '').trim() || null };
}

export const hasPaymentDetails = (p: PaymentDetails | null | undefined): boolean => !!p && (!!p.bank || !!p.upiId);

const COPY = {
  en: {
    heading: 'To pay',
    bank: 'Bank transfer',
    accountName: 'Account name',
    bankName: 'Bank',
    accountNumber: 'Account no',
    ifsc: 'IFSC',
    upi: 'UPI ID',
    afterPaying: 'After paying, please send us the reference number.',
  },
  ta: {
    heading: 'பணம் செலுத்த',
    bank: 'வங்கிப் பரிமாற்றம்',
    accountName: 'கணக்குப் பெயர்',
    bankName: 'வங்கி',
    accountNumber: 'கணக்கு எண்',
    ifsc: 'IFSC',
    upi: 'UPI ID',
    afterPaying: 'செலுத்திய பிறகு பரிவர்த்தனை எண்ணை அனுப்பவும்.',
  },
} as const;

/**
 * The payment details as plain text for a WhatsApp message: bank account lines and the UPI ID, nothing to tap and
 * nothing third-party. Empty string when the business has set neither.
 */
export function paymentDetailsText(lang: string, p: PaymentDetails | null | undefined, opts: { reminder?: boolean } = {}): string {
  if (!p || (!p.bank && !p.upiId)) return '';
  const c = COPY[lang === 'ta' ? 'ta' : 'en'];
  const out: string[] = [`*${c.heading}*`];
  if (p.bank) {
    const b = p.bank;
    out.push(`${c.bank}:`);
    out.push(`${c.accountName}: ${b.accountName}`);
    if (b.bankName) out.push(`${c.bankName}: ${b.bankName}${b.branch ? `, ${b.branch}` : ''}`);
    out.push(`${c.accountNumber}: ${b.accountNumber}`);
    out.push(`${c.ifsc}: ${b.ifsc}`);
  }
  if (p.upiId) out.push(`${c.upi}: ${p.upiId}`);
  if (opts.reminder !== false) out.push(c.afterPaying);
  return out.join('\n');
}
