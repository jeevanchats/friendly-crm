import {
  CustomFieldConfig,
  PermissionAction,
  TenantRole,
  getCustomFieldsForEntity,
  getIndustryTemplate,
  hasPermission,
} from '@friendly-crm/shared';
import { randomUUID } from 'crypto';
import { InboundMessage } from './inbound-parser';
import { SessionStore } from './session-store';
import { buildUpiLink, isValidUpiId } from '../../payments/upi';
import {
  MessageKey,
  SUPPORTED_LOCALES,
  normalizeDigits,
  normalizeLocale,
  pickLabel,
  t,
} from './bot-i18n';

// ---------------------------------------------------------------- ports
export interface StaffIdentity {
  userId: string;
  fullName: string;
  preferredLanguage: string;
  tenantId: string;
  tenantName: string;
  industryKey: string;
  role: TenantRole;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  customerName: string;
  productionStage: string;
  /** null/undefined when the caller's role may not see money. */
  balanceDue?: string | number | null;
}

export interface NewLeadInput {
  customerName: string;
  customerPhone: string;
  title: string;
  notes: string;
  customData: Record<string, unknown>;
}

/** A customer (not staff) who texts the business's WhatsApp number. */
export interface CustomerIdentity {
  customerId: string;
  customerName: string;
  tenantId: string;
  tenantName: string;
  tenantPhone?: string | null;
  industryKey: string;
  defaultLanguage: string;
  /** False when the business owner switched customer self-service off. */
  selfServiceEnabled: boolean;
  /** The business's UPI ID; when set (and valid) the dues summary includes payment links. */
  upiId?: string | null;
}

/** What a customer may see about their own order: no internal notes, items or custom data. */
export interface CustomerOrderView {
  id: string;
  orderNumber: string;
  productionStage: string;
  totalAmount?: string | number | null;
  advanceReceived?: string | number | null;
  balanceDue?: string | number | null;
  expectedDeliveryAt?: string | Date | null;
}

/** A quote waiting for the customer's decision. */
export interface CustomerQuoteView {
  id: string;
  quoteNumber: string;
  version: number;
  grandTotal: string;
  validUntil: string | null;
  items: Array<{ itemName: string; quantity: string; unit: string }>;
}

export interface QuoteDecisionContext {
  phone: string;
  messageId: string;
}

export type QuoteApproveResult =
  | { ok: true; orderNumber: string; alreadyApproved: boolean }
  | { ok: false; reason: 'NOT_AVAILABLE' | 'EXPIRED' | 'CHANGED' };

export type PaymentModeCode = 'UPI' | 'CASH' | 'BANK_TRANSFER' | 'CHEQUE';

export interface RecordPaymentInput {
  /** Decimal rupees with 2 places, e.g. "5000.00". */
  amount: string;
  mode: PaymentModeCode;
  referenceNo: string | null;
  idempotencyKey: string;
}

export interface RecordedPayment {
  receiptNumber: string;
  balanceRemaining?: string | number | null;
}

/** Everything the engine needs from the outside world. Keeps the engine pure and testable. */
export interface BotPorts {
  findCustomerByPhone(phone: string): Promise<CustomerIdentity[]>;
  /** Orders belonging to THIS customer only, newest first. */
  listCustomerOrders(who: CustomerIdentity): Promise<CustomerOrderView[]>;
  /**
   * What this customer owed before Friendly CRM (an opening balance), in rupees. Scoped to the verified customer.
   * Optional so a deployment without it simply shows order dues.
   */
  getCustomerOpeningBalance?(who: CustomerIdentity): Promise<string | null>;
  /** Quotes sent to THIS customer that are still open. */
  listCustomerQuotes(who: CustomerIdentity): Promise<CustomerQuoteView[]>;
  /** Approves the quote as shown (expectedTotal guards against a price change since display). */
  approveCustomerQuote(
    who: CustomerIdentity,
    quoteId: string,
    expectedTotal: string,
    ctx: QuoteDecisionContext
  ): Promise<QuoteApproveResult>;
  requestQuoteChange(who: CustomerIdentity, quoteId: string, text: string, ctx: QuoteDecisionContext): Promise<boolean>;
  findStaffByPhone(phone: string): Promise<StaffIdentity[]>;
  createLead(who: StaffIdentity, input: NewLeadInput): Promise<void>;
  findOrders(who: StaffIdentity, query: string): Promise<OrderSummary[]>;
  updateOrderStage(who: StaffIdentity, orderId: string, stageId: string): Promise<void>;
  /** Records money received against an order; the customer is sent the receipt by the notification outbox. */
  recordPayment(who: StaffIdentity, orderId: string, input: RecordPaymentInput): Promise<RecordedPayment>;
  setPreferredLanguage(userId: string, locale: string): Promise<void>;
  getCustomerSelfService(who: StaffIdentity): Promise<boolean>;
  setCustomerSelfService(who: StaffIdentity, enabled: boolean): Promise<void>;
}

// ---------------------------------------------------------------- state
interface LeadDraft {
  name?: string;
  phone?: string;
  need?: string;
  customData: Record<string, unknown>;
}

type BotState =
  | { step: 'IDLE' }
  | { step: 'PICK_BUSINESS' }
  | { step: 'PICK_LANGUAGE' }
  | { step: 'VERIFY' }
  | { step: 'QUOTE_PICK'; quotes: CustomerQuoteView[] }
  | { step: 'QUOTE_CONFIRM'; quote: CustomerQuoteView }
  | { step: 'QUOTE_CHANGE'; quote: CustomerQuoteView }
  | { step: 'SELF_SERVICE'; enabled: boolean }
  | { step: 'LEAD'; phase: 'NAME' | 'PHONE' | 'NEED' | 'FIELD' | 'CONFIRM'; draft: LeadDraft; fieldIndex: number }
  | { step: 'ORDER_QUERY'; purpose: 'STATUS' | 'STAGE' | 'PAYMENT' }
  | { step: 'ORDER_PICK'; candidates: OrderSummary[]; purpose: 'STAGE' | 'PAYMENT' }
  | { step: 'PAYMENT_AMOUNT'; order: OrderSummary }
  | { step: 'PAYMENT_MODE'; order: OrderSummary; paise: number }
  | { step: 'PAYMENT_REF'; order: OrderSummary; paise: number; mode: PaymentModeCode }
  | {
      step: 'PAYMENT_CONFIRM';
      order: OrderSummary;
      paise: number;
      mode: PaymentModeCode;
      reference: string | null;
      /** Same key on every retry of this confirmation, so a retried write can never record twice. */
      idempotencyKey: string;
    }
  | { step: 'STAGE_PICK'; order: OrderSummary }
  | { step: 'STAGE_CONFIRM'; order: OrderSummary; stageId: string };

export interface BotResult {
  replies: string[];
  /** Tenant the sender was resolved to (undefined for unregistered senders). */
  tenantId?: string;
}

export interface BotSession {
  /** Who this conversation belongs to; switching kinds resets the flow. */
  kind?: 'STAFF' | 'CUSTOMER';
  tenantId?: string;
  locale?: string;
  state: BotState;
  /**
   * Customer sessions only: tenants whose customer record this sender proved they own (by name or
   * order number). A number can be on a customer record by mistake, so the phone number alone is not proof.
   */
  verified?: string[];
  verifyFailures?: number;
}

const GREETINGS = new Set(['hi', 'hii', 'hello', 'hey', 'menu', 'start', 'வணக்கம்', 'மெனு']);
const CANCELS = new Set(['cancel', 'stop', 'ரத்து', 'நிறுத்து']);
const LANGS = new Set(['language', 'lang', 'மொழி']);

const MAX_ORDER_RESULTS = 5;
const MAX_VERIFY_ATTEMPTS = 3;
const MAX_DUES_LISTED = 8;
const QUOTES = new Set(['quotes', 'quote', 'approve', 'quotation', 'கொட்டேஷன்']);
const DUES = new Set(['dues', 'pay', 'balance', 'நிலுவை', 'பாக்கி']);

/** Case-, space- and punctuation-insensitive form used to compare names and order numbers. */
function canon(s: string): string {
  return normalizeDigits(s).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

const PAYMENT_MODES: Array<{ code: PaymentModeCode; label: MessageKey }> = [
  { code: 'UPI', label: 'pay_mode_upi' },
  { code: 'CASH', label: 'pay_mode_cash' },
  { code: 'BANK_TRANSFER', label: 'pay_mode_bank' },
  { code: 'CHEQUE', label: 'pay_mode_cheque' },
];

/** "5000", "₹5,000", "Rs. 2500.50" -> paise; null if it is not a positive amount with at most 2 decimals. */
function parseAmountPaise(text: string): number | null {
  const cleaned = normalizeDigits(text).replace(/₹|rs\.?|inr|,|\s/gi, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const paise = Math.round(Number(cleaned) * 100);
  return paise > 0 ? paise : null;
}

const paiseToAmount = (paise: number) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;

type MenuAction = 'LEAD' | 'STATUS' | 'STAGE' | 'LANGUAGE' | 'SELF_SERVICE' | 'PAYMENT';
const MENU: Array<{ action: MenuAction; label: MessageKey; permission?: PermissionAction }> = [
  { action: 'LEAD', label: 'menu_new_enquiry', permission: 'lead:create' },
  { action: 'STATUS', label: 'menu_order_status', permission: 'order:view' },
  { action: 'STAGE', label: 'menu_update_stage', permission: 'order:update_stage' },
  { action: 'LANGUAGE', label: 'menu_language' },
  { action: 'SELF_SERVICE', label: 'menu_self_service', permission: 'settings:manage' },
  // Last, so adding it never renumbers the options staff already know.
  { action: 'PAYMENT', label: 'menu_record_payment', permission: 'payment:create' },
];

// ---------------------------------------------------------------- helpers
function parseIndex(text: string, max: number): number | null {
  const m = normalizeDigits(text.trim()).match(/^(\d{1,3})\.?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= max ? n - 1 : null;
}

/** Indian mobile → +91XXXXXXXXXX, or null if it doesn't look valid. */
export function parseIndianMobile(text: string): string | null {
  let d = normalizeDigits(text).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

const numbered = (items: string[]) => items.map((s, i) => `${i + 1}. ${s}`).join('\n');
const fmtMoney = (v: string | number) => `₹${Number(v).toLocaleString('en-IN')}`;

type FieldParse = { ok: true; value: unknown; display: string } | { ok: false; error: MessageKey };

// ---------------------------------------------------------------- engine
export class ConversationEngine {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly hits = new Map<string, { times: number[]; warned: boolean }>();

  constructor(
    private readonly ports: BotPorts,
    private readonly sessions: SessionStore<BotSession>,
    private readonly sessionTtlMs = 30 * 60 * 1000,
    private readonly rateLimit = { max: 20, windowMs: 60 * 1000 },
    private readonly clock: () => number = Date.now
  ) {}

  /** Sliding-window limiter per sender. Returns 'ok', 'warn' (first excess) or 'drop'. */
  private checkRate(from: string): 'ok' | 'warn' | 'drop' {
    const now = this.clock();
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (v.times.every((x) => now - x > this.rateLimit.windowMs)) this.hits.delete(k);
    }
    const entry = this.hits.get(from) ?? { times: [], warned: false };
    entry.times = entry.times.filter((x) => now - x <= this.rateLimit.windowMs);
    if (entry.times.length >= this.rateLimit.max) {
      const verdict = entry.warned ? 'drop' : 'warn';
      entry.warned = true;
      this.hits.set(from, entry);
      return verdict;
    }
    entry.times.push(now);
    entry.warned = false;
    this.hits.set(from, entry);
    return 'ok';
  }

  /** Handles one inbound message and returns the replies to send back (one WhatsApp message each). */
  async handle(msg: InboundMessage): Promise<BotResult> {
    const rate = this.checkRate(msg.from);
    if (rate === 'drop') return { replies: [] };
    if (rate === 'warn') return { replies: [`${t('en', 'slow_down')}\n\n${t('ta', 'slow_down')}`] };
    // Serialise per sender: prevents interleaved/duplicate processing (e.g. double "1. Save").
    const prev = this.locks.get(msg.from) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.process(msg));
    this.locks.set(msg.from, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(msg.from) === run) this.locks.delete(msg.from);
    }
  }

  private async process(msg: InboundMessage): Promise<BotResult> {
    const staff = await this.ports.findStaffByPhone(msg.from);
    if (staff.length === 0) {
      const customers = await this.ports.findCustomerByPhone(msg.from);
      if (customers.length > 0) return this.processCustomer(msg, customers);
      return { replies: [`${t('en', 'not_registered')}\n\n${t('ta', 'not_registered')}`] };
    }

    const session: BotSession = (await this.sessions.get(msg.from)) ?? { state: { step: 'IDLE' } };
    if (session.kind !== 'STAFF') {
      // New conversation, or this number changed role: never carry flow state across identities.
      session.kind = 'STAFF';
      session.tenantId = undefined;
      session.state = { step: 'IDLE' };
    }
    const text = (msg.text ?? '').trim();

    // ---- which business?
    let who = staff.find((s) => s.tenantId === session.tenantId);
    if (!who) {
      if (staff.length === 1) {
        who = staff[0];
      } else {
        const loc = normalizeLocale(session.locale ?? staff[0].preferredLanguage);
        const idx = session.state.step === 'PICK_BUSINESS' ? parseIndex(text, staff.length) : null;
        if (idx === null) {
          session.state = { step: 'PICK_BUSINESS' };
          await this.save(msg.from, session);
          return { replies: [`${t(loc, 'pick_business')}\n${numbered(staff.map((s) => s.tenantName))}`] };
        }
        who = staff[idx];
        // The digit was the business choice, not a menu choice: show the menu and stop here.
        session.tenantId = who.tenantId;
        const menuReplies = this.showMenu(session, who, normalizeLocale(session.locale ?? who.preferredLanguage));
        await this.save(msg.from, session);
        return { replies: menuReplies, tenantId: who.tenantId };
      }
      session.tenantId = who.tenantId;
      session.state = { step: 'IDLE' };
    }

    const locale = normalizeLocale(session.locale ?? who.preferredLanguage);
    const replies = await this.route(msg, text, session, who, locale);
    await this.save(msg.from, session);
    return { replies, tenantId: who.tenantId };
  }

  private async save(key: string, session: BotSession) {
    await this.sessions.set(key, session, this.sessionTtlMs);
  }

  // ---------------------------------------------------------------- routing
  private async route(
    msg: InboundMessage,
    text: string,
    s: BotSession,
    who: StaffIdentity,
    locale: string
  ): Promise<string[]> {
    if (msg.type !== 'text') return [t(locale, 'unsupported_media')];

    const lc = text.toLowerCase();
    if (GREETINGS.has(lc)) return this.showMenu(s, who, locale);
    if (CANCELS.has(lc)) {
      const wasIdle = s.state.step === 'IDLE';
      const menu = this.showMenu(s, who, locale);
      return wasIdle ? menu : [t(locale, 'cancelled'), ...menu];
    }
    if (LANGS.has(lc)) return this.startLanguagePick(s, locale);

    switch (s.state.step) {
      case 'IDLE':
        return this.onIdle(text, s, who, locale);
      case 'PICK_BUSINESS':
        return this.showMenu(s, who, locale);
      case 'PICK_LANGUAGE':
        return this.onLanguagePick(text, s, who);
      case 'SELF_SERVICE':
        return this.onSelfService(text, s, s.state, who, locale);
      case 'LEAD':
        return this.onLead(text, s, s.state, who, locale);
      case 'ORDER_QUERY':
        return this.onOrderQuery(text, s, s.state.purpose, who, locale);
      case 'ORDER_PICK':
        return this.onOrderPick(text, s, s.state, who, locale);
      case 'STAGE_PICK':
        return this.onStagePick(text, s, s.state, who, locale);
      case 'STAGE_CONFIRM':
        return this.onStageConfirm(text, s, s.state, who, locale);
      case 'PAYMENT_AMOUNT':
        return this.onPaymentAmount(text, s, s.state, who, locale);
      case 'PAYMENT_MODE':
        return this.onPaymentMode(text, s, s.state, locale);
      case 'PAYMENT_REF':
        return this.onPaymentRef(text, s, s.state, locale);
      case 'PAYMENT_CONFIRM':
        return this.onPaymentConfirm(text, s, s.state, who, locale);
      default:
        // Customer-only steps (VERIFY, QUOTE_*) can never be a staff state; start over rather than guess.
        return this.showMenu(s, who, locale);
    }
  }

  private allowedMenu(who: StaffIdentity) {
    return MENU.filter((m) => !m.permission || hasPermission(who.role, m.permission));
  }

  private showMenu(s: BotSession, who: StaffIdentity, locale: string, prefix?: string): string[] {
    s.state = { step: 'IDLE' };
    const items = this.allowedMenu(who).map((m) => t(locale, m.label));
    const body = [
      t(locale, 'greeting', { name: who.fullName.split(' ')[0], business: who.tenantName }),
      numbered(items),
      t(locale, 'menu_footer'),
    ].join('\n\n');
    return [prefix ? `${prefix}\n\n${body}` : body];
  }

  private async onIdle(text: string, s: BotSession, who: StaffIdentity, locale: string): Promise<string[]> {
    const allowed = this.allowedMenu(who);
    const idx = parseIndex(text, allowed.length);
    if (idx === null) return this.showMenu(s, who, locale, t(locale, 'not_understood'));

    switch (allowed[idx].action) {
      case 'LEAD':
        s.state = { step: 'LEAD', phase: 'NAME', draft: { customData: {} }, fieldIndex: 0 };
        return [t(locale, 'ask_customer_name')];
      case 'STATUS':
        s.state = { step: 'ORDER_QUERY', purpose: 'STATUS' };
        return [t(locale, 'ask_order_query')];
      case 'STAGE':
        s.state = { step: 'ORDER_QUERY', purpose: 'STAGE' };
        return [t(locale, 'ask_order_query')];
      case 'PAYMENT':
        s.state = { step: 'ORDER_QUERY', purpose: 'PAYMENT' };
        return [t(locale, 'ask_order_query')];
      case 'LANGUAGE':
        return this.startLanguagePick(s, locale);
      case 'SELF_SERVICE': {
        const enabled = await this.ports.getCustomerSelfService(who);
        s.state = { step: 'SELF_SERVICE', enabled };
        return [t(locale, enabled ? 'ss_status_on' : 'ss_status_off')];
      }
    }
  }

  private async onSelfService(
    text: string,
    s: BotSession,
    st: Extract<BotState, { step: 'SELF_SERVICE' }>,
    who: StaffIdentity,
    locale: string
  ): Promise<string[]> {
    const idx = parseIndex(text, 2);
    if (idx === null) return [t(locale, 'choose_number')];
    if (idx === 1) return this.showMenu(s, who, locale); // keep as is
    s.state = { step: 'IDLE' };
    const next = !st.enabled;
    try {
      await this.ports.setCustomerSelfService(who, next);
    } catch {
      return [t(locale, 'ss_failed'), ...this.showMenu(s, who, locale)];
    }
    return this.showMenu(s, who, locale, t(locale, next ? 'ss_now_on' : 'ss_now_off'));
  }

  // ---------------------------------------------------------------- language
  private startLanguagePick(s: BotSession, locale: string): string[] {
    s.state = { step: 'PICK_LANGUAGE' };
    return [`${t(locale, 'pick_language')}\n${numbered(SUPPORTED_LOCALES.map((l) => l.name))}`];
  }

  private async onLanguagePick(text: string, s: BotSession, who: StaffIdentity): Promise<string[]> {
    const idx = parseIndex(text, SUPPORTED_LOCALES.length);
    const current = normalizeLocale(s.locale ?? who.preferredLanguage);
    if (idx === null) return [t(current, 'choose_number')];
    const chosen = SUPPORTED_LOCALES[idx].code;
    s.locale = chosen;
    try {
      await this.ports.setPreferredLanguage(who.userId, chosen);
    } catch {
      // Preference is a convenience; the session still switches language.
    }
    return this.showMenu(s, who, chosen, t(chosen, 'language_set'));
  }

  // ---------------------------------------------------------------- new enquiry
  private requiredLeadFields(who: StaffIdentity): CustomFieldConfig[] {
    return getCustomFieldsForEntity(who.industryKey, 'LEAD').filter((f) => f.required);
  }

  private async onLead(
    text: string,
    s: BotSession,
    st: Extract<BotState, { step: 'LEAD' }>,
    who: StaffIdentity,
    locale: string
  ): Promise<string[]> {
    const fields = this.requiredLeadFields(who);
    const d = st.draft;

    switch (st.phase) {
      case 'NAME': {
        if (text.length < 2 || text.length > 120) return [t(locale, 'bad_text'), t(locale, 'ask_customer_name')];
        d.name = text;
        st.phase = 'PHONE';
        return [t(locale, 'ask_customer_phone')];
      }
      case 'PHONE': {
        const phone = parseIndianMobile(text);
        if (!phone) return [t(locale, 'bad_phone')];
        d.phone = phone;
        st.phase = 'NEED';
        return [t(locale, 'ask_need')];
      }
      case 'NEED': {
        if (text.length < 2 || text.length > 300) return [t(locale, 'bad_text'), t(locale, 'ask_need')];
        d.need = text;
        return this.nextFieldOrConfirm(st, fields, who, locale);
      }
      case 'FIELD': {
        const field = fields[st.fieldIndex];
        const parsed = this.parseFieldAnswer(field, text, locale);
        if ('error' in parsed) return [t(locale, parsed.error), this.fieldPrompt(field, locale)];
        d.customData[field.key] = parsed.value;
        st.fieldIndex += 1;
        return this.nextFieldOrConfirm(st, fields, who, locale);
      }
      case 'CONFIRM': {
        const idx = parseIndex(text, 2);
        if (idx === null) return [t(locale, 'choose_number'), this.confirmText(st, fields, locale)];
        if (idx === 1) return [t(locale, 'cancelled'), ...this.showMenu(s, who, locale)];
        // Leave the flow BEFORE the write so a duplicate "1" can never create two leads.
        s.state = { step: 'IDLE' };
        try {
          await this.ports.createLead(who, {
            customerName: d.name!,
            customerPhone: d.phone!,
            title: d.need!,
            notes: d.need!,
            customData: d.customData,
          });
        } catch {
          return [t(locale, 'lead_failed'), ...this.showMenu(s, who, locale)];
        }
        return this.showMenu(s, who, locale, t(locale, 'lead_saved', { customer: d.name! }));
      }
    }
  }

  private nextFieldOrConfirm(
    st: Extract<BotState, { step: 'LEAD' }>,
    fields: CustomFieldConfig[],
    who: StaffIdentity,
    locale: string
  ): string[] {
    if (st.fieldIndex < fields.length) {
      st.phase = 'FIELD';
      return [this.fieldPrompt(fields[st.fieldIndex], locale)];
    }
    st.phase = 'CONFIRM';
    return [this.confirmText(st, fields, locale)];
  }

  private fieldPrompt(field: CustomFieldConfig, locale: string): string {
    const label = `*${pickLabel(field.label as any, locale)}*`;
    switch (field.type) {
      case 'SELECT':
        return `${label}\n${numbered((field.options ?? []).map((o) => pickLabel(o.label as any, locale)))}`;
      case 'MULTI_SELECT':
        return `${label}\n${numbered((field.options ?? []).map((o) => pickLabel(o.label as any, locale)))}\n${t(locale, 'choose_many')}`;
      case 'BOOLEAN':
        return `${label}\n${t(locale, 'yes_no')}`;
      default:
        return label;
    }
  }

  private parseFieldAnswer(field: CustomFieldConfig, raw: string, locale: string): FieldParse {
    const text = normalizeDigits(raw.trim());
    const options = field.options ?? [];
    switch (field.type) {
      case 'SELECT': {
        const idx = parseIndex(text, options.length);
        const byLabel = options.find((o) =>
          (Object.values(o.label) as string[]).some((l) => l.toLowerCase() === text.toLowerCase())
        );
        const opt = idx !== null ? options[idx] : byLabel;
        return opt
          ? { ok: true, value: opt.value, display: pickLabel(opt.label as any, locale) }
          : { ok: false, error: 'choose_number' };
      }
      case 'MULTI_SELECT': {
        const parts = text.split(/[,\s]+/).filter(Boolean);
        const picked: typeof options = [];
        for (const p of parts) {
          const i = parseIndex(p, options.length);
          if (i === null) return { ok: false, error: 'choose_many' };
          if (!picked.includes(options[i])) picked.push(options[i]);
        }
        if (picked.length === 0) return { ok: false, error: 'choose_many' };
        return {
          ok: true,
          value: picked.map((o) => o.value),
          display: picked.map((o) => pickLabel(o.label as any, locale)).join(', '),
        };
      }
      case 'BOOLEAN': {
        const l = text.toLowerCase();
        if (['1', 'yes', 'y', 'ஆம்'].includes(l)) return { ok: true, value: true, display: t(locale, 'yes') };
        if (['2', 'no', 'n', 'இல்லை'].includes(l)) return { ok: true, value: false, display: t(locale, 'no') };
        return { ok: false, error: 'choose_number' };
      }
      case 'NUMBER': {
        const n = Number(text.replace(/,/g, ''));
        return text !== '' && Number.isFinite(n)
          ? { ok: true, value: n, display: String(n) }
          : { ok: false, error: 'bad_number' };
      }
      default:
        return text.length > 0 && text.length <= 200
          ? { ok: true, value: text, display: text }
          : { ok: false, error: 'bad_text' };
    }
  }

  private confirmText(
    st: Extract<BotState, { step: 'LEAD' }>,
    fields: CustomFieldConfig[],
    locale: string
  ): string {
    const d = st.draft;
    const lines = [
      t(locale, 'confirm_enquiry'),
      `${t(locale, 'label_customer')}: ${d.name}`,
      `${t(locale, 'label_mobile')}: ${d.phone}`,
      `${t(locale, 'label_need')}: ${d.need}`,
    ];
    for (const f of fields) {
      const v = this.parseFieldAnswer(f, this.answerToText(f, d.customData[f.key]), locale);
      if (v.ok) lines.push(`${pickLabel(f.label as any, locale)}: ${v.display}`);
    }
    lines.push('', t(locale, 'confirm_save_cancel'));
    return lines.join('\n');
  }

  /** Re-expresses a stored value as the text that would produce it (used only to render the summary). */
  private answerToText(f: CustomFieldConfig, value: unknown): string {
    const options = f.options ?? [];
    if (f.type === 'SELECT') return String(options.findIndex((o) => o.value === value) + 1);
    if (f.type === 'MULTI_SELECT')
      return ((value as string[]) ?? []).map((v) => options.findIndex((o) => o.value === v) + 1).join(',');
    if (f.type === 'BOOLEAN') return value ? '1' : '2';
    return String(value ?? '');
  }

  // ---------------------------------------------------------------- customer self-service
  private async processCustomer(msg: InboundMessage, allMatches: CustomerIdentity[]): Promise<BotResult> {
    const customers = allMatches.filter((c) => c.selfServiceEnabled);
    if (customers.length === 0) {
      // Every business this number buys from has switched the feature off: say so politely, keep no session.
      const off = allMatches[0];
      const loc = /[\u0B80-\u0BFF]/.test(msg.text ?? '') ? 'ta' : normalizeLocale(off.defaultLanguage);
      const call = off.tenantPhone ? `\n${t(loc, 'c_call_us', { phone: off.tenantPhone })}` : '';
      return { replies: [t(loc, 'c_disabled', { business: off.tenantName }) + call] };
    }
    const session: BotSession = (await this.sessions.get(msg.from)) ?? { state: { step: 'IDLE' } };
    if (session.kind !== 'CUSTOMER') {
      session.kind = 'CUSTOMER';
      session.tenantId = undefined;
      session.verified = undefined;
      session.verifyFailures = undefined;
      session.state = { step: 'IDLE' };
    }
    const text = (msg.text ?? '').trim();

    // First message in Tamil script -> answer in Tamil for the rest of the session.
    if (!session.locale && /[\u0B80-\u0BFF]/.test(text)) session.locale = 'ta';

    let who = customers.find((c) => c.tenantId === session.tenantId);
    if (!who) {
      if (customers.length === 1) {
        who = customers[0];
      } else {
        const loc = normalizeLocale(session.locale ?? customers[0].defaultLanguage);
        const idx = session.state.step === 'PICK_BUSINESS' ? parseIndex(text, customers.length) : null;
        if (idx === null) {
          session.state = { step: 'PICK_BUSINESS' };
          await this.save(msg.from, session);
          return { replies: [`${t(loc, 'pick_business')}\n${numbered(customers.map((c) => c.tenantName))}`] };
        }
        who = customers[idx];
        session.tenantId = who.tenantId;
        const pickedLocale = normalizeLocale(session.locale ?? who.defaultLanguage);
        const menu = (session.verified ?? []).includes(who.tenantId)
          ? this.showCustomerMenu(session, who, pickedLocale)
          : this.promptVerify(session, who, pickedLocale);
        await this.save(msg.from, session);
        return { replies: menu, tenantId: who.tenantId };
      }
      session.tenantId = who.tenantId;
      session.state = { step: 'IDLE' };
    }

    const locale = normalizeLocale(session.locale ?? who.defaultLanguage);
    const replies = await this.routeCustomer(msg, text, session, who, locale);
    await this.save(msg.from, session);
    return { replies, tenantId: who.tenantId };
  }

  private promptVerify(s: BotSession, who: CustomerIdentity, locale: string): string[] {
    s.state = { step: 'VERIFY' };
    return [t(locale, 'c_verify_prompt', { business: who.tenantName })];
  }

  /**
   * Ownership check for a number found on a customer record. The first message only triggers the
   * question (so "hi" never counts as a wrong answer); the next must be the registered name or one of
   * this customer's order numbers. After MAX_VERIFY_ATTEMPTS misses the session stays locked.
   */
  private async verifyCustomer(text: string, s: BotSession, who: CustomerIdentity, locale: string): Promise<string[]> {
    const call = who.tenantPhone ? `\n${t(locale, 'c_call_us', { phone: who.tenantPhone })}` : '';
    const locked = () => [t(locale, 'c_verify_locked', { business: who.tenantName }) + call];
    if ((s.verifyFailures ?? 0) >= MAX_VERIFY_ATTEMPTS) return locked();
    if (s.state.step !== 'VERIFY') return this.promptVerify(s, who, locale);

    const answer = canon(text);
    let ok = answer.length > 0 && answer === canon(who.customerName);
    if (!ok && answer.length >= 3) {
      // listCustomerOrders returns only this customer's orders; nothing from it is shown unless it matches.
      const mine = await this.ports.listCustomerOrders(who);
      ok = mine.some((o) => canon(o.orderNumber) === answer);
    }
    if (ok) {
      s.verified = [...(s.verified ?? []), who.tenantId];
      s.verifyFailures = 0;
      return this.showCustomerMenu(s, who, locale);
    }
    s.verifyFailures = (s.verifyFailures ?? 0) + 1;
    if (s.verifyFailures >= MAX_VERIFY_ATTEMPTS) {
      s.state = { step: 'IDLE' };
      return locked();
    }
    return [`${t(locale, 'c_verify_failed')}\n\n${t(locale, 'c_verify_prompt', { business: who.tenantName })}`];
  }

  private showCustomerMenu(s: BotSession, who: CustomerIdentity, locale: string, prefix?: string): string[] {
    s.state = { step: 'IDLE' };
    const body = [
      t(locale, 'c_greeting', { name: who.customerName.split(' ')[0], business: who.tenantName }),
      numbered([t(locale, 'c_menu_orders'), t(locale, 'c_menu_quotes'), t(locale, 'c_menu_dues'), t(locale, 'menu_language')]),
      t(locale, 'c_footer'),
    ].join('\n\n');
    return [prefix ? `${prefix}\n\n${body}` : body];
  }

  private async routeCustomer(
    msg: InboundMessage,
    text: string,
    s: BotSession,
    who: CustomerIdentity,
    locale: string
  ): Promise<string[]> {
    if (msg.type !== 'text') return [t(locale, 'unsupported_media')];
    // Nothing about the customer (not even their name in the greeting) is shown before this check passes.
    if (!(s.verified ?? []).includes(who.tenantId)) return this.verifyCustomer(text, s, who, locale);
    const lc = text.toLowerCase();
    if (GREETINGS.has(lc) || CANCELS.has(lc)) return this.showCustomerMenu(s, who, locale);
    if (LANGS.has(lc)) return this.startLanguagePick(s, locale);

    if (s.state.step === 'PICK_LANGUAGE') {
      const idx = parseIndex(text, SUPPORTED_LOCALES.length);
      if (idx === null) return [t(locale, 'choose_number')];
      const chosen = SUPPORTED_LOCALES[idx].code;
      s.locale = chosen; // customers have no user record, so the choice lasts for the session
      return this.showCustomerMenu(s, who, chosen, t(chosen, 'language_set'));
    }

    if (s.state.step === 'QUOTE_PICK') return this.quotePick(text, s, locale);
    if (s.state.step === 'QUOTE_CONFIRM') return this.quoteConfirm(msg, text, s, who, locale);
    if (s.state.step === 'QUOTE_CHANGE') return this.quoteChange(msg, text, s, who, locale);

    if (QUOTES.has(lc)) return this.startQuotes(s, who, locale);
    if (DUES.has(lc)) return this.customerDues(who, locale);
    const pick = parseIndex(text, 4);
    if (pick === 3) return this.startLanguagePick(s, locale);
    if (pick === 2) return this.customerDues(who, locale);
    if (pick === 1) return this.startQuotes(s, who, locale);
    if (pick === 0) return this.customerOrders(who, locale);

    // Anything that looks like an order number (digits, 3+) is treated as an order lookup.
    const digits = normalizeDigits(text).replace(/\D/g, '');
    if (digits.length >= 3) return this.customerOrders(who, locale, normalizeDigits(text));
    return this.showCustomerMenu(s, who, locale, t(locale, 'not_understood'));
  }

  private async customerOrders(who: CustomerIdentity, locale: string, query?: string): Promise<string[]> {
    // The port returns only THIS customer's orders; the filter below can only narrow that set.
    const all = await this.ports.listCustomerOrders(who);
    const q = query?.trim().toLowerCase();
    const found = q ? all.filter((o) => o.orderNumber.toLowerCase().includes(q)) : all;
    if (found.length === 0) return [t(locale, q ? 'c_order_not_found' : 'c_no_orders')];
    const cards = found.slice(0, MAX_ORDER_RESULTS).map((o) => this.customerOrderCard(o, who, locale));
    const tail = who.tenantPhone ? `\n\n${t(locale, 'c_call_us', { phone: who.tenantPhone })}` : '';
    return [cards.join('\n\n') + tail];
  }

  // ---------------------------------------------------------------- customer quote approval
  private async startQuotes(s: BotSession, who: CustomerIdentity, locale: string): Promise<string[]> {
    const quotes = await this.ports.listCustomerQuotes(who);
    if (quotes.length === 0) {
      s.state = { step: 'IDLE' };
      return [t(locale, 'c_quotes_none')];
    }
    if (quotes.length === 1) return this.showQuote(s, quotes[0], locale);
    s.state = { step: 'QUOTE_PICK', quotes };
    const labels = quotes.map((q) => `${q.quoteNumber} · ${fmtMoney(q.grandTotal)}`);
    return [`${t(locale, 'c_quotes_pick')}\n${numbered(labels)}`];
  }

  private showQuote(s: BotSession, quote: CustomerQuoteView, locale: string): string[] {
    s.state = { step: 'QUOTE_CONFIRM', quote };
    const lines = [`*${quote.quoteNumber}* (v${quote.version})`];
    for (const i of quote.items.slice(0, 6)) lines.push(`• ${i.itemName} × ${Number(i.quantity)} ${i.unit}`);
    if (quote.items.length > 6) lines.push(`• … +${quote.items.length - 6}`);
    lines.push(`*${t(locale, 'label_total')}: ${fmtMoney(quote.grandTotal)}*`);
    if (quote.validUntil) {
      const d = new Date(quote.validUntil);
      if (!isNaN(d.getTime())) {
        const date = d.toLocaleDateString(locale === 'ta' ? 'ta-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        lines.push(t(locale, 'c_quote_valid_until', { date }));
      }
    }
    const options = numbered([t(locale, 'c_quote_approve'), t(locale, 'c_quote_change')]);
    return [`${lines.join('\n')}\n\n${options}`];
  }

  private async quotePick(text: string, s: BotSession, locale: string): Promise<string[]> {
    const st = s.state as Extract<BotState, { step: 'QUOTE_PICK' }>;
    const idx = parseIndex(text, st.quotes.length);
    if (idx === null) return [t(locale, 'choose_number')];
    return this.showQuote(s, st.quotes[idx], locale);
  }

  private async quoteConfirm(
    msg: InboundMessage,
    text: string,
    s: BotSession,
    who: CustomerIdentity,
    locale: string
  ): Promise<string[]> {
    const st = s.state as Extract<BotState, { step: 'QUOTE_CONFIRM' }>;
    const idx = parseIndex(text, 2);
    if (idx === null) return [t(locale, 'choose_number')];
    if (idx === 1) {
      s.state = { step: 'QUOTE_CHANGE', quote: st.quote };
      return [t(locale, 'c_quote_change_prompt')];
    }

    s.state = { step: 'IDLE' }; // leave the confirm step BEFORE the write, so a repeated "1" cannot approve twice
    const call = who.tenantPhone ? `\n${t(locale, 'c_call_us', { phone: who.tenantPhone })}` : '';
    let res: QuoteApproveResult;
    try {
      res = await this.ports.approveCustomerQuote(who, st.quote.id, st.quote.grandTotal, {
        phone: msg.from,
        messageId: msg.id,
      });
    } catch {
      return [t(locale, 'c_quote_error') + call];
    }
    if (!res.ok) {
      const reason = (res as Extract<QuoteApproveResult, { ok: false }>).reason;
      const key = reason === 'EXPIRED' ? 'c_quote_expired' : reason === 'CHANGED' ? 'c_quote_changed' : 'c_quote_unavailable';
      return [t(locale, key) + call];
    }
    const done = res as Extract<QuoteApproveResult, { ok: true }>;
    if (done.alreadyApproved) return [t(locale, 'c_quote_already', { order: done.orderNumber })];
    const approved = t(locale, 'c_quote_approved', {
      quote: st.quote.quoteNumber,
      order: done.orderNumber,
      total: fmtMoney(st.quote.grandTotal),
    });
    // The order starts with nothing paid, so offer the UPI link right away (only if the business set a valid UPI ID).
    const paise = Math.round(Number(st.quote.grandTotal) * 100);
    if (who.upiId && isValidUpiId(who.upiId) && Number.isInteger(paise) && paise > 0) {
      const link = buildUpiLink({ upiId: who.upiId, payeeName: who.tenantName, amountPaise: paise, note: done.orderNumber });
      return [
        `${approved}\n\n${t(locale, 'c_quote_pay_hint')}\n${link}\n\n${t(locale, 'c_dues_upi_id', { upi: who.upiId })}`,
      ];
    }
    return [approved];
  }

  private async quoteChange(
    msg: InboundMessage,
    text: string,
    s: BotSession,
    who: CustomerIdentity,
    locale: string
  ): Promise<string[]> {
    const st = s.state as Extract<BotState, { step: 'QUOTE_CHANGE' }>;
    if (!text.trim()) return [t(locale, 'c_quote_change_prompt')];
    s.state = { step: 'IDLE' };
    const call = who.tenantPhone ? `\n${t(locale, 'c_call_us', { phone: who.tenantPhone })}` : '';
    let ok = false;
    try {
      ok = await this.ports.requestQuoteChange(who, st.quote.id, text.trim(), { phone: msg.from, messageId: msg.id });
    } catch {
      return [t(locale, 'c_quote_error') + call];
    }
    return [(ok ? t(locale, 'c_quote_change_sent') : t(locale, 'c_quote_unavailable')) + call];
  }

  /**
   * Outstanding balances across THIS customer's orders (the port is already scoped to them), each with a
   * UPI link built from the business's own UPI ID. Amounts are summed in paise to avoid float drift.
   */
  private async customerDues(who: CustomerIdentity, locale: string): Promise<string[]> {
    const toPaise = (v: unknown) => {
      const n = Math.round(Number(v) * 100);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const due = (await this.ports.listCustomerOrders(who))
      .map((o) => ({ o, paise: toPaise(o.balanceDue) }))
      .filter((x) => x.paise > 0);
    const previous = toPaise(await this.ports.getCustomerOpeningBalance?.(who));
    if (due.length === 0 && previous === 0) return [t(locale, 'c_dues_none')];

    const upi = who.upiId && isValidUpiId(who.upiId) ? who.upiId : null;
    const link = (paise: number, note: string) =>
      buildUpiLink({ upiId: upi!, payeeName: who.tenantName, amountPaise: paise, note });
    const rupees = (paise: number) => fmtMoney(paise / 100);
    const totalPaise = due.reduce((sum, x) => sum + x.paise, 0) + previous;

    const blocks = [
      due.length > 0
        ? t(locale, 'c_dues_title', { total: rupees(totalPaise), count: due.length })
        : t(locale, 'c_dues_title_prev', { total: rupees(totalPaise) }),
    ];
    for (const { o, paise } of due.slice(0, MAX_DUES_LISTED)) {
      const lines = [`*${o.orderNumber}* · ${rupees(paise)}`];
      if (upi) lines.push(`${t(locale, 'c_dues_pay')}: ${link(paise, o.orderNumber)}`);
      blocks.push(lines.join('\n'));
    }
    if (due.length > MAX_DUES_LISTED) blocks.push(t(locale, 'c_dues_more', { n: due.length - MAX_DUES_LISTED }));
    if (previous > 0) {
      const lines = [`*${t(locale, 'c_dues_previous')}* · ${rupees(previous)}`];
      if (upi) lines.push(`${t(locale, 'c_dues_pay')}: ${link(previous, t(locale, 'c_dues_previous'))}`);
      blocks.push(lines.join('\n'));
    }
    if (upi) {
      if (due.length + (previous > 0 ? 1 : 0) > 1) {
        blocks.push(`${t(locale, 'c_dues_pay_all', { total: rupees(totalPaise) })}: ${link(totalPaise, 'Dues')}`);
      }
      blocks.push(t(locale, 'c_dues_upi_id', { upi }));
    } else {
      blocks.push(t(locale, 'c_dues_no_upi'));
    }
    if (who.tenantPhone) blocks.push(t(locale, 'c_call_us', { phone: who.tenantPhone }));
    return [blocks.join('\n\n')];
  }

  private customerOrderCard(o: CustomerOrderView, who: CustomerIdentity, locale: string): string {
    const stage = getIndustryTemplate(who.industryKey).orderStages.find((x) => x.id === o.productionStage);
    const lines = [
      `*${o.orderNumber}*`,
      `${t(locale, 'label_stage')}: ${stage ? pickLabel(stage.label as any, locale) : o.productionStage}`,
    ];
    const has = (v: unknown) => v !== null && v !== undefined && v !== '';
    if (has(o.totalAmount)) lines.push(`${t(locale, 'label_total')}: ${fmtMoney(o.totalAmount!)}`);
    if (has(o.advanceReceived) && Number(o.advanceReceived) > 0) {
      lines.push(`${t(locale, 'label_paid')}: ${fmtMoney(o.advanceReceived!)}`);
    }
    if (has(o.balanceDue) && Number(o.balanceDue) > 0) {
      lines.push(`${t(locale, 'label_balance')}: ${fmtMoney(o.balanceDue!)}`);
    }
    if (o.expectedDeliveryAt) {
      const d = new Date(o.expectedDeliveryAt);
      if (!isNaN(d.getTime())) {
        lines.push(
          `${t(locale, 'label_delivery')}: ${d.toLocaleDateString(locale === 'ta' ? 'ta-IN' : 'en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}`
        );
      }
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- orders
  private stageLabel(who: StaffIdentity, stageId: string, locale: string): string {
    const stage = getIndustryTemplate(who.industryKey).orderStages.find((s) => s.id === stageId);
    return stage ? pickLabel(stage.label as any, locale) : stageId;
  }

  private orderLine(o: OrderSummary, who: StaffIdentity, locale: string): string {
    const lines = [
      `*${o.orderNumber}* · ${o.customerName}`,
      `${t(locale, 'label_stage')}: ${this.stageLabel(who, o.productionStage, locale)}`,
    ];
    if (o.balanceDue !== null && o.balanceDue !== undefined && Number(o.balanceDue) > 0) {
      lines.push(`${t(locale, 'label_balance')}: ${fmtMoney(o.balanceDue)}`);
    }
    return lines.join('\n');
  }

  private async onOrderQuery(
    text: string,
    s: BotSession,
    purpose: 'STATUS' | 'STAGE' | 'PAYMENT',
    who: StaffIdentity,
    locale: string
  ): Promise<string[]> {
    if (text.length < 2) return [t(locale, 'ask_order_query')];
    const found = (await this.ports.findOrders(who, text)).slice(0, MAX_ORDER_RESULTS);
    if (found.length === 0) return [t(locale, 'order_none'), t(locale, 'ask_order_query')];

    if (purpose === 'STATUS') {
      return [found.map((o) => this.orderLine(o, who, locale)).join('\n\n'), t(locale, 'ask_order_query')];
    }
    if (found.length === 1) {
      return purpose === 'PAYMENT'
        ? this.startPaymentAmount(s, found[0], locale)
        : this.startStagePick(s, found[0], who, locale);
    }
    s.state = { step: 'ORDER_PICK', candidates: found, purpose };
    return [
      `${t(locale, 'pick_order')}\n${numbered(found.map((o) => `${o.orderNumber} · ${o.customerName}`))}`,
    ];
  }

  private async onOrderPick(
    text: string,
    s: BotSession,
    st: Extract<BotState, { step: 'ORDER_PICK' }>,
    who: StaffIdentity,
    locale: string
  ): Promise<string[]> {
    const idx = parseIndex(text, st.candidates.length);
    // Not a valid pick → treat the text as a fresh search, which is what a user on the shop floor would mean.
    if (idx === null) return this.onOrderQuery(text, s, st.purpose, who, locale);
    return st.purpose === 'PAYMENT'
      ? this.startPaymentAmount(s, st.candidates[idx], locale)
      : this.startStagePick(s, st.candidates[idx], who, locale);
  }

  // ---------------------------------------------------------------- record a payment (staff)
  private startPaymentAmount(s: BotSession, order: OrderSummary, locale: string): string[] {
    s.state = { step: 'PAYMENT_AMOUNT', order };
    const has = order.balanceDue !== null && order.balanceDue !== undefined && Number(order.balanceDue) > 0;
    const balance = has ? t(locale, 'pay_balance_line', { balance: fmtMoney(order.balanceDue!) }) : '';
    return [t(locale, 'ask_pay_amount', { order: order.orderNumber, customer: order.customerName, balance })];
  }

  private async onPaymentAmount(
    text: string,
    s: BotSession,
    st: Extract<BotState, { step: 'PAYMENT_AMOUNT' }>,
    _who: StaffIdentity,
    locale: string
  ): Promise<string[]> {
    const paise = parseAmountPaise(text);
    if (paise === null) return [t(locale, 'pay_amount_invalid')];
    const bal = st.order.balanceDue;
    if (bal !== null && bal !== undefined && Number.isFinite(Number(bal)) && paise > Math.round(Number(bal) * 100)) {
      return [t(locale, 'pay_amount_too_high', { balance: fmtMoney(bal) })];
    }
    s.state = { step: 'PAYMENT_MODE', order: st.order, paise };
    return [`${t(locale, 'ask_pay_mode')}\n${numbered(PAYMENT_MODES.map((m) => t(locale, m.label)))}`];
  }

  private async onPaymentMode(
    text: string,
    s: BotSession,
    st: Extract<BotState, { step: 'PAYMENT_MODE' }>,
    locale: string
  ): Promise<string[]> {
    const idx = parseIndex(text, PAYMENT_MODES.length);
    if (idx === null) return [t(locale, 'choose_number')];
    const mode = PAYMENT_MODES[idx].code;
    if (mode === 'UPI' || mode === 'BANK_TRANSFER') {
      s.state = { step: 'PAYMENT_REF', order: st.order, paise: st.paise, mode };
      return [t(locale, 'ask_pay_ref')];
    }
    return this.askPaymentConfirm(s, st.order, st.paise, mode, null, locale);
  }

  private async onPaymentRef(
    text: string,
    s: BotSession,
    st: Extract<BotState, { step: 'PAYMENT_REF' }>,
    locale: string
  ): Promise<string[]> {
    const raw = text.trim();
    if (!raw) return [t(locale, 'ask_pay_ref')];
    const reference = raw === '0' ? null : raw.slice(0, 60);
    return this.askPaymentConfirm(s, st.order, st.paise, st.mode, reference, locale);
  }

  private askPaymentConfirm(
    s: BotSession,
    order: OrderSummary,
    paise: number,
    mode: PaymentModeCode,
    reference: string | null,
    locale: string
  ): string[] {
    s.state = { step: 'PAYMENT_CONFIRM', order, paise, mode, reference, idempotencyKey: `wa-pay:${randomUUID()}` };
    const modeLabel = t(locale, PAYMENT_MODES.find((m) => m.code === mode)!.label);
    const ref = reference ? `\nRef: ${reference}` : '';
    return [
      `${t(locale, 'confirm_payment', { amount: fmtMoney(paise / 100), mode: modeLabel, order: order.orderNumber, ref })}\n${t(locale, 'confirm_record_cancel')}`,
    ];
  }

  private async onPaymentConfirm(
    text: string,
    s: BotSession,
    st: Extract<BotState, { step: 'PAYMENT_CONFIRM' }>,
    who: StaffIdentity,
    locale: string
  ): Promise<string[]> {
    const idx = parseIndex(text, 2);
    if (idx === null) return [t(locale, 'choose_number')];
    if (idx === 1) {
      s.state = { step: 'IDLE' };
      return [t(locale, 'cancelled'), ...this.showMenu(s, who, locale)];
    }
    // Leave the confirm step before the write; on a failure we come back with the SAME idempotency key,
    // so retrying "1" can never record the payment twice even if the first attempt actually went through.
    s.state = { step: 'IDLE' };
    let done: RecordedPayment;
    try {
      done = await this.ports.recordPayment(who, st.order.id, {
        amount: paiseToAmount(st.paise),
        mode: st.mode,
        referenceNo: st.reference,
        idempotencyKey: st.idempotencyKey,
      });
    } catch {
      s.state = st;
      return [t(locale, 'payment_failed')];
    }
    const after =
      done.balanceRemaining !== null && done.balanceRemaining !== undefined
        ? t(locale, 'payment_balance_after', { balance: fmtMoney(done.balanceRemaining) })
        : '';
    return [
      t(locale, 'payment_recorded', {
        amount: fmtMoney(st.paise / 100),
        order: st.order.orderNumber,
        receipt: done.receiptNumber,
        balance: after,
      }),
      ...this.showMenu(s, who, locale),
    ];
  }

  private startStagePick(s: BotSession, order: OrderSummary, who: StaffIdentity, locale: string): string[] {
    s.state = { step: 'STAGE_PICK', order };
    const stages = getIndustryTemplate(who.industryKey).orderStages;
    const list = stages.map((st) => {
      const mark = st.id === order.productionStage ? ' ✓' : '';
      return `${pickLabel(st.label as any, locale)}${mark}`;
    });
    return [`${t(locale, 'pick_new_stage', { order: order.orderNumber })}\n${numbered(list)}`];
  }

  private async onStagePick(
    text: string,
    s: BotSession,
    st: Extract<BotState, { step: 'STAGE_PICK' }>,
    who: StaffIdentity,
    locale: string
  ): Promise<string[]> {
    const stages = getIndustryTemplate(who.industryKey).orderStages;
    const idx = parseIndex(text, stages.length);
    if (idx === null) return [t(locale, 'choose_number')];
    const stageId = stages[idx].id;
    if (stageId === st.order.productionStage) return [t(locale, 'same_stage')];
    s.state = { step: 'STAGE_CONFIRM', order: st.order, stageId };
    return [
      `${t(locale, 'confirm_stage', {
        order: st.order.orderNumber,
        stage: this.stageLabel(who, stageId, locale),
      })}\n${t(locale, 'confirm_update_cancel')}`,
    ];
  }

  private async onStageConfirm(
    text: string,
    s: BotSession,
    st: Extract<BotState, { step: 'STAGE_CONFIRM' }>,
    who: StaffIdentity,
    locale: string
  ): Promise<string[]> {
    const idx = parseIndex(text, 2);
    if (idx === null) return [t(locale, 'choose_number')];
    s.state = { step: 'ORDER_QUERY', purpose: 'STAGE' }; // leave confirm BEFORE the write (no double-apply)
    if (idx === 1) return [t(locale, 'cancelled'), t(locale, 'ask_order_query')];
    try {
      await this.ports.updateOrderStage(who, st.order.id, st.stageId);
    } catch {
      return [t(locale, 'stage_failed'), t(locale, 'ask_order_query')];
    }
    return [
      t(locale, 'stage_updated', {
        order: st.order.orderNumber,
        stage: this.stageLabel(who, st.stageId, locale),
      }),
      t(locale, 'ask_order_query'),
    ];
  }
}
