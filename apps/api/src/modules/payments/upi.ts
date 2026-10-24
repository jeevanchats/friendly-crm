/** A UPI ID (VPA) such as `name@okbank`: handle, '@', PSP handle. */
const UPI_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9.\-_]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export function isValidUpiId(value: string): boolean {
  return UPI_ID_RE.test(value);
}

export interface UpiLinkInput {
  /** Payee UPI ID, already validated with isValidUpiId. */
  upiId: string;
  /** Payee display name (the business). */
  payeeName: string;
  /** Amount in paise, so no floating point is involved in what the customer is asked to pay. */
  amountPaise: number;
  /** Shown to the payer and in the bank statement (kept short: banks truncate it). */
  note: string;
}

/**
 * Builds a UPI deep link (https://www.npci.org.in/ UPI linking spec): upi://pay?pa=..&pn=..&am=..&cu=INR&tn=..
 * Values are percent-encoded with %20 for spaces, which UPI apps require (not '+').
 */
export function buildUpiLink({ upiId, payeeName, amountPaise, note }: UpiLinkInput): string {
  if (!isValidUpiId(upiId)) throw new Error('Invalid UPI ID');
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error('Invalid UPI amount');
  const enc = encodeURIComponent;
  const amount = `${Math.floor(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, '0')}`;
  return (
    `upi://pay?pa=${enc(upiId)}&pn=${enc(payeeName.slice(0, 60))}` +
    `&am=${amount}&cu=INR&tn=${enc(note.slice(0, 40))}`
  );
}
