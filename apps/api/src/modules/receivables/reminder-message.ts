import { PaymentDetails, paymentDetailsText } from '@friendly-crm/shared';

export interface ReminderOrder {
  orderNumber: string;
  duePaise: number;
}

export interface ReminderInput {
  lang: 'en' | 'ta';
  customerName: string;
  tenantName: string;
  tenantPhone?: string | null;
  /** How the customer can pay: the business's bank account and/or UPI ID, shown as plain text. */
  payment?: PaymentDetails | null;
  orders: ReminderOrder[];
}

const MAX_LISTED = 5;

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const COPY = {
  en: {
    hello: (n: string) => `Hello ${n},`,
    intro: (biz: string, total: string) => `This is a friendly reminder from ${biz}: ${total} is outstanding on your account.`,
    more: (n: number) => `…and ${n} more`,
    already: 'If you have already paid, please ignore this message and send us the reference. Thank you!',
    call: (p: string) => `Questions? Call us on ${p}.`,
    stop: 'Reply STOP to stop these automatic reminders.',
  },
  ta: {
    hello: (n: string) => `வணக்கம் ${n},`,
    intro: (biz: string, total: string) => `${biz} சார்பில் நினைவூட்டல்: உங்கள் கணக்கில் ${total} நிலுவையில் உள்ளது.`,
    more: (n: number) => `…மேலும் ${n}`,
    already: 'ஏற்கனவே செலுத்தியிருந்தால் இந்தச் செய்தியைப் புறக்கணிக்கவும்; பரிவர்த்தனை எண்ணை அனுப்பவும். நன்றி!',
    call: (p: string) => `கேள்விகளுக்கு அழைக்கவும்: ${p}.`,
    stop: 'இந்த தானியங்கி நினைவூட்டல்களை நிறுத்த STOP என்று அனுப்பவும்.',
  },
} as const;

/**
 * Builds the WhatsApp text for a payment reminder. Pure: all amounts are integer paise. How to pay is the business's
 * own bank account and UPI ID as plain text (nothing to tap, no third party); the customer pays directly and the
 * business records the payment when it arrives.
 */
export function buildReminderMessage(input: ReminderInput): string {
  const c = COPY[input.lang] ?? COPY.en;
  const orders = input.orders.filter((o) => o.duePaise > 0);
  const total = orders.reduce((sum, o) => sum + o.duePaise, 0);

  const blocks: string[] = [c.hello(input.customerName || (input.lang === 'ta' ? 'வாடிக்கையாளர்' : 'Customer')), c.intro(input.tenantName, inr(total))];

  const lines = orders.slice(0, MAX_LISTED).map((o) => `• *${o.orderNumber}* — ${inr(o.duePaise)}`);
  if (orders.length > MAX_LISTED) lines.push(c.more(orders.length - MAX_LISTED));
  blocks.push(lines.join('\n'));

  const pay = paymentDetailsText(input.lang, input.payment, { reminder: false });
  if (pay) blocks.push(pay);
  blocks.push(c.already);
  if (input.tenantPhone) blocks.push(c.call(input.tenantPhone));
  blocks.push(c.stop);
  return blocks.join('\n\n');
}
