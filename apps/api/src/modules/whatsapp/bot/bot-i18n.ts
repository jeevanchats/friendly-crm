/**
 * Bot strings. To add a language (e.g. Hindi): add it to SUPPORTED_LOCALES and add a
 * `hi` entry per key below. Any missing key falls back to English, so a language can be
 * rolled out incrementally.
 */
export interface LocaleInfo {
  code: string;
  name: string; // shown in the language picker, in that language
}

export const SUPPORTED_LOCALES: LocaleInfo[] = [
  { code: 'en', name: 'English' },
  { code: 'ta', name: 'தமிழ்' },
];

export const DEFAULT_LOCALE = 'en';

type Entry = { en: string } & Record<string, string>;

export const MESSAGES = {
  greeting: {
    en: 'Hello {name}! 👋 What would you like to do for *{business}*?',
    ta: 'வணக்கம் {name}! 👋 *{business}* இல் என்ன செய்ய வேண்டும்?',
  },
  menu_new_enquiry: { en: 'New enquiry', ta: 'புதிய விசாரணை' },
  menu_order_status: { en: 'Order status', ta: 'ஆர்டர் நிலை' },
  menu_update_stage: { en: 'Update order stage', ta: 'ஆர்டர் நிலை மாற்று' },
  menu_language: { en: 'Change language', ta: 'மொழி மாற்று' },
  menu_footer: {
    en: 'Reply with a number. Type *menu* anytime, or *cancel* to stop.',
    ta: 'எண்ணை அனுப்பவும். எப்போதும் *menu* என டைப் செய்யலாம்; நிறுத்த *cancel*.',
  },
  not_understood: {
    en: "Sorry, I didn't get that.",
    ta: 'மன்னிக்கவும், புரியவில்லை.',
  },
  not_registered: {
    en: "This number isn't registered with Friendly CRM. Please ask your business owner to add you.",
    ta: 'இந்த எண் Friendly CRM-இல் பதிவு செய்யப்படவில்லை. உங்கள் உரிமையாளரிடம் சேர்க்கச் சொல்லுங்கள்.',
  },
  no_permission: {
    en: "Your role doesn't allow this action.",
    ta: 'உங்கள் பொறுப்புக்கு இந்தச் செயல் அனுமதிக்கப்படவில்லை.',
  },
  unsupported_media: {
    en: 'I can read text messages for now. Please type your message.',
    ta: 'தற்போது உரைச் செய்திகளை மட்டுமே படிக்க முடியும். தயவுசெய்து டைப் செய்யவும்.',
  },
  cancelled: { en: 'Cancelled.', ta: 'ரத்து செய்யப்பட்டது.' },
  pick_business: { en: 'Which business?', ta: 'எந்த நிறுவனம்?' },
  pick_language: { en: 'Choose a language:', ta: 'மொழியைத் தேர்ந்தெடுக்கவும்:' },
  language_set: { en: 'Language set to English.', ta: 'மொழி தமிழாக மாற்றப்பட்டது.' },
  choose_number: { en: 'Please reply with one of the numbers above.', ta: 'மேலே உள்ள எண்களில் ஒன்றை அனுப்பவும்.' },

  // New enquiry
  ask_customer_name: { en: "Customer's name?", ta: 'வாடிக்கையாளர் பெயர் என்ன?' },
  ask_customer_phone: {
    en: "Customer's mobile number (10 digits)?",
    ta: 'வாடிக்கையாளர் மொபைல் எண் (10 இலக்கம்)?',
  },
  bad_phone: {
    en: "That doesn't look like a valid 10-digit mobile number. Please try again.",
    ta: 'சரியான 10 இலக்க மொபைல் எண் இல்லை. மீண்டும் அனுப்பவும்.',
  },
  ask_need: {
    en: 'What do they need? (e.g. 5,000 wall calendars)',
    ta: 'அவர்களுக்கு என்ன தேவை? (எ.கா. 5,000 சுவர் காலண்டர்கள்)',
  },
  bad_text: { en: 'Please send a short text.', ta: 'தயவுசெய்து சிறிய உரை அனுப்பவும்.' },
  bad_number: { en: 'Please send a number.', ta: 'எண்ணை மட்டும் அனுப்பவும்.' },
  choose_many: {
    en: 'Reply with one or more numbers separated by commas (e.g. 1,3).',
    ta: 'ஒன்று அல்லது பல எண்களை காற்புள்ளியால் பிரித்து அனுப்பவும் (எ.கா. 1,3).',
  },
  yes_no: { en: '1. Yes\n2. No', ta: '1. ஆம்\n2. இல்லை' },
  yes: { en: 'Yes', ta: 'ஆம்' },
  no: { en: 'No', ta: 'இல்லை' },
  confirm_enquiry: { en: 'Please confirm this enquiry:', ta: 'இந்த விசாரணையை உறுதிசெய்யவும்:' },
  label_customer: { en: 'Customer', ta: 'வாடிக்கையாளர்' },
  label_mobile: { en: 'Mobile', ta: 'மொபைல்' },
  label_need: { en: 'Requirement', ta: 'தேவை' },
  confirm_save_cancel: { en: '1. Save\n2. Cancel', ta: '1. சேமி\n2. ரத்து செய்' },
  lead_saved: {
    en: '✅ Enquiry saved for *{customer}*.',
    ta: '✅ *{customer}* க்கான விசாரணை சேமிக்கப்பட்டது.',
  },
  lead_failed: {
    en: "Sorry, I couldn't save that enquiry. Please try again in a moment, or use the app.",
    ta: 'மன்னிக்கவும், விசாரணையை சேமிக்க முடியவில்லை. சிறிது நேரம் கழித்து முயற்சிக்கவும் அல்லது ஆப்பைப் பயன்படுத்தவும்.',
  },

  // Orders
  ask_order_query: {
    en: 'Send an order number or customer name. (Type *menu* to go back)',
    ta: 'ஆர்டர் எண் அல்லது வாடிக்கையாளர் பெயரை அனுப்பவும். (திரும்ப *menu*)',
  },
  order_none: { en: 'No matching orders found.', ta: 'பொருந்தும் ஆர்டர்கள் இல்லை.' },
  label_stage: { en: 'Stage', ta: 'நிலை' },
  label_balance: { en: 'Balance', ta: 'நிலுவை' },
  pick_order: { en: 'Which order?', ta: 'எந்த ஆர்டர்?' },
  pick_new_stage: { en: 'New stage for *{order}*:', ta: '*{order}* க்கான புதிய நிலை:' },
  same_stage: { en: 'That order is already at this stage.', ta: 'இந்த ஆர்டர் ஏற்கனவே இந்த நிலையில் உள்ளது.' },
  confirm_stage: {
    en: 'Move *{order}* to *{stage}*?',
    ta: '*{order}* ஐ *{stage}* நிலைக்கு மாற்றவா?',
  },
  menu_record_payment: { en: 'Record a payment', ta: 'பணம் பதிவு செய்' },
  ask_pay_amount: {
    en: '*{order}* · {customer}\n{balance}How much was received? (e.g. 5000)',
    ta: '*{order}* · {customer}\n{balance}எவ்வளவு பெறப்பட்டது? (எ.கா. 5000)',
  },
  pay_balance_line: { en: 'Balance: {balance}\n', ta: 'பாக்கி: {balance}\n' },
  pay_amount_invalid: {
    en: 'Please send the amount as a number, e.g. *5000* or *2500.50*.',
    ta: 'தொகையை எண்ணாக அனுப்பவும், எ.கா. *5000* அல்லது *2500.50*.',
  },
  pay_amount_too_high: {
    en: "That is more than the balance ({balance}). Send a smaller amount, or type *cancel*.",
    ta: 'இது பாக்கியை ({balance}) விட அதிகம். குறைந்த தொகையை அனுப்பவும் அல்லது *cancel* என டைப் செய்யவும்.',
  },
  ask_pay_mode: { en: 'How was it paid?', ta: 'எப்படி செலுத்தப்பட்டது?' },
  pay_mode_upi: { en: 'UPI', ta: 'UPI' },
  pay_mode_cash: { en: 'Cash', ta: 'ரொக்கம்' },
  pay_mode_bank: { en: 'Bank transfer', ta: 'வங்கி பரிமாற்றம்' },
  pay_mode_cheque: { en: 'Cheque', ta: 'காசோலை' },
  ask_pay_ref: {
    en: 'Send the UPI / bank reference number (UTR), or *0* to skip.',
    ta: 'UPI / வங்கி குறிப்பு எண்ணை (UTR) அனுப்பவும், அல்லது தவிர்க்க *0*.',
  },
  confirm_payment: {
    en: 'Record *{amount}* ({mode}) against *{order}*?{ref}',
    ta: '*{order}* க்கு *{amount}* ({mode}) பதிவு செய்யவா?{ref}',
  },
  confirm_record_cancel: { en: '1. Record\n2. Cancel', ta: '1. பதிவு செய்\n2. ரத்து செய்' },
  payment_recorded: {
    en: '✅ Recorded {amount} against *{order}*. Receipt *{receipt}*.{balance} The customer is sent a receipt on WhatsApp.',
    ta: '✅ *{order}* க்கு {amount} பதிவு செய்யப்பட்டது. ரசீது *{receipt}*.{balance} வாடிக்கையாளருக்கு WhatsApp இல் ரசீது அனுப்பப்படும்.',
  },
  payment_balance_after: { en: ' Balance now {balance}.', ta: ' இப்போதைய பாக்கி {balance}.' },
  payment_failed: {
    en: "Couldn't record that payment. Nothing was saved. Reply *1* to try again or *2* to cancel.",
    ta: 'அந்த பணத்தை பதிவு செய்ய முடியவில்லை. எதுவும் சேமிக்கப்படவில்லை. மீண்டும் முயல *1*, ரத்து செய்ய *2*.',
  },
  confirm_update_cancel: { en: '1. Update\n2. Cancel', ta: '1. மாற்று\n2. ரத்து செய்' },
  stage_updated: { en: '✅ *{order}* is now at *{stage}*.', ta: '✅ *{order}* இப்போது *{stage}* நிலையில் உள்ளது.' },
  stage_failed: {
    en: "Sorry, I couldn't update that order. Please try again or use the app.",
    ta: 'மன்னிக்கவும், ஆர்டரை மாற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது ஆப்பைப் பயன்படுத்தவும்.',
  },

  // Customer self-service
  c_greeting: {
    en: 'Hello {name}! 👋 Welcome to *{business}*. How can we help?',
    ta: 'வணக்கம் {name}! 👋 *{business}* க்கு வரவேற்கிறோம். எப்படி உதவலாம்?',
  },
  c_verify_prompt: {
    en: 'Welcome to *{business}*. To protect your account, please reply with your name exactly as registered with us, or one of your order numbers.',
    ta: '*{business}* க்கு வரவேற்கிறோம். உங்கள் கணக்கின் பாதுகாப்புக்காக, எங்களிடம் பதிவு செய்த உங்கள் பெயரை அல்லது உங்கள் ஆர்டர் எண்களில் ஒன்றை அனுப்பவும்.',
  },
  c_verify_failed: {
    en: "Sorry, that doesn't match our records.",
    ta: 'மன்னிக்கவும், இது எங்கள் பதிவுகளுடன் பொருந்தவில்லை.',
  },
  c_verify_locked: {
    en: "We couldn't verify this number for *{business}*, so order details can't be shown here.",
    ta: '*{business}* க்கு இந்த எண்ணை சரிபார்க்க முடியவில்லை, எனவே ஆர்டர் விவரங்களை இங்கே காட்ட இயலாது.',
  },
  c_menu_orders: { en: 'My orders', ta: 'என் ஆர்டர்கள்' },
  c_menu_quotes: { en: 'Quotes to approve', ta: 'ஒப்புதலுக்கான கொட்டேஷன்கள்' },
  c_quotes_none: {
    en: 'You have no quotes waiting for approval.',
    ta: 'ஒப்புதலுக்காக காத்திருக்கும் கொட்டேஷன்கள் எதுவும் இல்லை.',
  },
  c_quotes_pick: { en: 'Which quote?', ta: 'எந்த கொட்டேஷன்?' },
  c_quote_valid_until: { en: 'Valid until {date}', ta: 'செல்லுபடியாகும் நாள்: {date}' },
  c_quote_approve: { en: 'Approve and place the order ✅', ta: 'ஒப்புக்கொண்டு ஆர்டர் செய்ய ✅' },
  c_quote_change: { en: 'Ask for a change ✏️', ta: 'மாற்றம் கேட்க ✏️' },
  c_quote_approved: {
    en: 'Thank you! ✅ Quote *{quote}* approved. Your order *{order}* is confirmed (total {total}). We will keep you updated here.',
    ta: 'நன்றி! ✅ கொட்டேஷன் *{quote}* ஒப்புக்கொள்ளப்பட்டது. உங்கள் ஆர்டர் *{order}* உறுதி செய்யப்பட்டது (மொத்தம் {total}). இங்கேயே தகவல் தருவோம்.',
  },
  c_quote_pay_hint: {
    en: 'To get started, you can pay the advance (or the full amount) by UPI. You can change the amount in your UPI app:',
    ta: 'தொடங்க, முன்பணத்தை (அல்லது முழுத் தொகையை) UPI மூலம் செலுத்தலாம். தொகையை உங்கள் UPI செயலியில் மாற்றிக்கொள்ளலாம்:',
  },
  c_quote_already: {
    en: 'This quote is already approved. Your order is *{order}*.',
    ta: 'இந்த கொட்டேஷன் ஏற்கனவே ஒப்புக்கொள்ளப்பட்டது. உங்கள் ஆர்டர் *{order}*.',
  },
  c_quote_expired: {
    en: 'This quote has expired. Please contact us for a fresh quote.',
    ta: 'இந்த கொட்டேஷன் காலாவதியாகிவிட்டது. புதிய கொட்டேஷனுக்கு எங்களை தொடர்பு கொள்ளவும்.',
  },
  c_quote_unavailable: {
    en: 'This quote can no longer be approved (it may have been revised). Reply *quotes* to see the latest.',
    ta: 'இந்த கொட்டேஷனை இனி ஒப்புக்கொள்ள இயலாது (திருத்தப்பட்டிருக்கலாம்). சமீபத்தியதைக் காண *quotes* என பதிலளிக்கவும்.',
  },
  c_quote_changed: {
    en: 'The price on this quote changed after you opened it, so nothing was approved. Reply *quotes* to review the latest.',
    ta: 'நீங்கள் திறந்த பிறகு இந்த கொட்டேஷனின் விலை மாறியது, எனவே எதுவும் ஒப்புக்கொள்ளப்படவில்லை. சமீபத்தியதைப் பார்க்க *quotes* என பதிலளிக்கவும்.',
  },
  c_quote_error: {
    en: "Sorry, we couldn't process that and nothing was approved. Please try again or call us.",
    ta: 'மன்னிக்கவும், செயல்படுத்த முடியவில்லை, எதுவும் ஒப்புக்கொள்ளப்படவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது எங்களை அழைக்கவும்.',
  },
  c_quote_change_prompt: {
    en: 'Please type what you would like changed on this quote.',
    ta: 'இந்த கொட்டேஷனில் என்ன மாற்ற வேண்டும் என்பதை டைப் செய்யவும்.',
  },
  c_quote_change_sent: {
    en: "Thanks, we've noted your request and will get back to you shortly.",
    ta: 'நன்றி, உங்கள் கோரிக்கையை பதிவு செய்தோம். விரைவில் தொடர்பு கொள்வோம்.',
  },
  c_menu_dues: { en: 'Pending dues & pay', ta: 'நிலுவைத் தொகை & செலுத்த' },
  c_dues_none: { en: 'You have no pending dues. Thank you! 🙏', ta: 'உங்களுக்கு நிலுவைத் தொகை எதுவும் இல்லை. நன்றி! 🙏' },
  c_dues_title: {
    en: '*Pending dues: {total}* ({count} orders)',
    ta: '*நிலுவைத் தொகை: {total}* ({count} ஆர்டர்கள்)',
  },
  c_dues_title_prev: {
    en: '*Pending dues: {total}*',
    ta: '*நிலுவைத் தொகை: {total}*',
  },
  c_dues_previous: { en: 'Previous balance', ta: 'முந்தைய நிலுவை' },
  c_dues_pay: { en: 'Pay', ta: 'செலுத்த' },
  c_dues_pay_all: { en: 'Pay all {total}', ta: 'முழுவதும் செலுத்த {total}' },
  c_dues_more: { en: '…and {n} more. Call us for the full list.', ta: '…மேலும் {n}. முழு பட்டியலுக்கு எங்களை அழைக்கவும்.' },
  c_dues_upi_id: {
    en: "If a link doesn't open, pay to UPI ID *{upi}* and quote the order number.",
    ta: 'இணைப்பு திறக்கவில்லை என்றால், UPI ID *{upi}* க்கு செலுத்தி ஆர்டர் எண்ணைக் குறிப்பிடவும்.',
  },
  c_dues_no_upi: {
    en: 'Please call us to pay or to ask about your balance.',
    ta: 'பணம் செலுத்த அல்லது நிலுவை பற்றி அறிய எங்களை அழைக்கவும்.',
  },
  c_footer: {
    en: 'Reply with a number, or send your order number. Type *menu* anytime.',
    ta: 'எண்ணை அனுப்பவும் அல்லது உங்கள் ஆர்டர் எண்ணை அனுப்பவும். எப்போதும் *menu* என டைப் செய்யலாம்.',
  },
  c_no_orders: {
    en: "We couldn't find any orders for this number yet.",
    ta: 'இந்த எண்ணுக்கு இதுவரை ஆர்டர்கள் எதுவும் இல்லை.',
  },
  c_order_not_found: {
    en: "We couldn't find that order on this number. Please check the order number.",
    ta: 'இந்த எண்ணில் அந்த ஆர்டர் இல்லை. ஆர்டர் எண்ணை சரிபார்க்கவும்.',
  },
  c_call_us: {
    en: 'Questions? Call us on {phone}.',
    ta: 'கேள்விகள் இருந்தால் அழைக்கவும்: {phone}.',
  },
  label_total: { en: 'Total', ta: 'மொத்தம்' },
  label_paid: { en: 'Paid', ta: 'செலுத்தியது' },
  label_delivery: { en: 'Expected delivery', ta: 'எதிர்பார்க்கப்படும் டெலிவரி' },
  slow_down: {
    en: "You're sending messages too fast. Please wait a minute and try again.",
    ta: 'மிக வேகமாக செய்திகள் அனுப்புகிறீர்கள். ஒரு நிமிடம் காத்திருந்து மீண்டும் முயற்சிக்கவும்.',
  },

  // Owner setting: customer self-service on/off
  menu_self_service: { en: 'Customer order updates on/off', ta: 'வாடிக்கையாளர் ஆர்டர் தகவல் ஆன்/ஆஃப்' },
  ss_status_on: {
    en: 'Customers can check their own orders on WhatsApp: *ON*.\n\n1. Turn OFF\n2. Keep ON',
    ta: 'வாடிக்கையாளர்கள் WhatsApp-இல் தங்கள் ஆர்டரைப் பார்க்கும் வசதி: *ஆன்*.\n\n1. ஆஃப் செய்\n2. ஆன் ஆகவே இருக்கட்டும்',
  },
  ss_status_off: {
    en: 'Customers can check their own orders on WhatsApp: *OFF*.\n\n1. Turn ON\n2. Keep OFF',
    ta: 'வாடிக்கையாளர்கள் WhatsApp-இல் தங்கள் ஆர்டரைப் பார்க்கும் வசதி: *ஆஃப்*.\n\n1. ஆன் செய்\n2. ஆஃப் ஆகவே இருக்கட்டும்',
  },
  ss_now_on: { en: '✅ Customer order updates are now *ON*.', ta: '✅ வாடிக்கையாளர் ஆர்டர் தகவல் இப்போது *ஆன்*.' },
  ss_now_off: { en: '✅ Customer order updates are now *OFF*.', ta: '✅ வாடிக்கையாளர் ஆர்டர் தகவல் இப்போது *ஆஃப்*.' },
  ss_failed: {
    en: "Sorry, I couldn't change that setting. Please try again or use the app.",
    ta: 'மன்னிக்கவும், அமைப்பை மாற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது ஆப்பைப் பயன்படுத்தவும்.',
  },
  c_disabled: {
    en: "Order updates on WhatsApp aren't available for *{business}*.",
    ta: '*{business}* க்கு WhatsApp மூலம் ஆர்டர் தகவல் தற்போது கிடைக்காது.',
  },
} satisfies Record<string, Entry>;

export type MessageKey = keyof typeof MESSAGES;

export function normalizeLocale(code: string | null | undefined): string {
  const c = (code || '').toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.some((l) => l.code === c) ? c : DEFAULT_LOCALE;
}

export function t(locale: string, key: MessageKey, params: Record<string, string | number> = {}): string {
  const entry = MESSAGES[key] as Record<string, string>;
  const template = entry[locale] ?? entry[DEFAULT_LOCALE] ?? String(key);
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

/** Picks a locale from a { en, ta, ... } label object, falling back to English. */
export function pickLabel(label: Record<string, string> | undefined, locale: string): string {
  if (!label) return '';
  return label[locale] ?? label[DEFAULT_LOCALE] ?? Object.values(label)[0] ?? '';
}

const TAMIL_DIGITS = '௦௧௨௩௪௫௬௭௮௯';
/** Converts Tamil numerals to ASCII so "௨" works as "2". */
export function normalizeDigits(input: string): string {
  return input.replace(/[௦-௯]/g, (ch) => String(TAMIL_DIGITS.indexOf(ch)));
}
