import { buildUpiLink, isValidUpiId } from '../payments/upi';

export interface ReminderOrder {
  orderNumber: string;
  duePaise: number;
}

export interface ReminderInput {
  lang: 'en' | 'ta';
  customerName: string;
  tenantName: string;
  tenantPhone?: string | null;
  upiId?: string | null;
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
    payAll: 'Pay online',
    payOne: 'Pay',
    upiId: (id: string) => `Or pay to UPI ID: ${id}`,
    already: 'If you have already paid, please ignore this message and send us the reference. Thank you!',
    call: (p: string) => `Questions? Call us on ${p}.`,
  },
  ta: {
    hello: (n: string) => `வணக்கம் ${n},`,
    intro: (biz: string, total: string) => `${biz} சார்பில் நினைவூட்டல்: உங்கள் கணக்கில் ${total} நிலுவையில் உள்ளது.`,
    more: (n: number) => `…மேலும் ${n}`,
    payAll: 'ஆன்லைனில் செலுத்த',
    payOne: 'செலுத்த',
    upiId: (id: string) => `அல்லது UPI ID-க்கு செலுத்தவும்: ${id}`,
    already: 'ஏற்கனவே செலுத்தியிருந்தால் இந்தச் செய்தியைப் புறக்கணிக்கவும்; பரிவர்த்தனை எண்ணை அனுப்பவும். நன்றி!',
    call: (p: string) => `கேள்விகளுக்கு அழைக்கவும்: ${p}.`,
  },
} as const;

/**
 * Builds the WhatsApp text for a payment reminder. Pure: all amounts are integer paise and the UPI link is
 * built only from the business's own validated UPI ID. This is sent as raw text (not through the HTML-escaping
 * template engine) because a UPI link contains `&`.
 */
export function buildReminderMessage(input: ReminderInput): string {
  const c = COPY[input.lang] ?? COPY.en;
  const orders = input.orders.filter((o) => o.duePaise > 0);
  const total = orders.reduce((sum, o) => sum + o.duePaise, 0);
  const upi = input.upiId && isValidUpiId(input.upiId) ? input.upiId : null;
  const link = (paise: number, note: string) =>
    buildUpiLink({ upiId: upi!, payeeName: input.tenantName, amountPaise: paise, note });

  const blocks: string[] = [c.hello(input.customerName || (input.lang === 'ta' ? 'வாடிக்கையாளர்' : 'Customer')), c.intro(input.tenantName, inr(total))];

  const lines = orders.slice(0, MAX_LISTED).map((o) => {
    const row = `• *${o.orderNumber}* — ${inr(o.duePaise)}`;
    return upi && orders.length > 1 ? `${row}\n  ${c.payOne}: ${link(o.duePaise, o.orderNumber)}` : row;
  });
  if (orders.length > MAX_LISTED) lines.push(c.more(orders.length - MAX_LISTED));
  blocks.push(lines.join('\n'));

  if (upi) {
    blocks.push(`${c.payAll} (${inr(total)}): ${link(total, orders.length === 1 ? orders[0].orderNumber : 'Dues')}`);
    blocks.push(c.upiId(upi));
  }
  blocks.push(c.already);
  if (input.tenantPhone) blocks.push(c.call(input.tenantPhone));
  return blocks.join('\n\n');
}
