/**
 * Customer master import: CSV / pasted-from-Excel parsing, column matching, and row validation.
 * Pure and dependency-free so the browser (live preview) and the API (the real check) use identical rules.
 */
import { cleanDisplayName } from './duplicates';
import { GST_STATES, isValidGstin, isValidStateCode, normalizeGstin, stateCodeFromGstin } from './gst';

// ---------------------------------------------------------------- phone

/**
 * Indian mobile numbers in the shapes people actually type: 9876543210, 09876543210, +91 98765 43210,
 * 91-9876543210. Other countries are accepted only with an explicit + and 8-15 digits. Returns E.164 or null.
 */
export function normalizeContactPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length === 0) return null;
  let national = digits;
  if (!text.startsWith('+')) {
    if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
    if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
    return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
  }
  if (digits.startsWith('91') && digits.length === 12) return /^[6-9]\d{9}$/.test(digits.slice(2)) ? `+${digits}` : null;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

// ---------------------------------------------------------------- state names

const STATE_ABBREVIATIONS: Record<string, string> = {
  JK: '01', HP: '02', PB: '03', CH: '04', UK: '05', UT: '05', HR: '06', DL: '07', RJ: '08', UP: '09', BR: '10',
  SK: '11', AR: '12', NL: '13', MN: '14', MZ: '15', TR: '16', ML: '17', AS: '18', WB: '19', JH: '20', OD: '21',
  OR: '21', CG: '22', CT: '22', MP: '23', GJ: '24', DD: '26', DN: '26', DH: '26', MH: '27', KA: '29', GA: '30',
  LD: '31', KL: '32', TN: '33', PY: '34', PO: '34', AN: '35', TS: '36', TG: '36', AP: '37', LA: '38',
};

const NAME_ALIASES: Record<string, string> = {
  tamilnadu: '33',
  pondicherry: '34',
  orissa: '21',
  uttaranchal: '05',
  jammuandkashmir: '01',
  andamanandnicobar: '35',
  andamannicobarislands: '35',
  delhincr: '07',
  newdelhi: '07',
  chattisgarh: '22',
  telengana: '36',
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

const STATE_BY_NAME: Record<string, string> = {};
for (const [code, name] of Object.entries(GST_STATES)) STATE_BY_NAME[squash(name)] = code;

/** "Tamil Nadu", "TN", "tamilnadu", "33" and "33 - Tamil Nadu" all give "33". Unknown text gives null. */
export function parseStateCode(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!text) return null;
  const leading = text.match(/^(\d{1,2})\b/);
  if (leading) {
    const code = leading[1].padStart(2, '0');
    return isValidStateCode(code) ? code : null;
  }
  const abbr = STATE_ABBREVIATIONS[text.toUpperCase()];
  if (abbr) return abbr;
  const key = squash(text);
  return STATE_BY_NAME[key] ?? NAME_ALIASES[key] ?? null;
}

// ---------------------------------------------------------------- amounts

/**
 * Money from a spreadsheet cell, to whole paise. Accepts "₹1,23,456.50", "Rs. 500", "1200 Dr" (Tally: the customer
 * owes) and "1200 Cr" (the customer is in credit, which comes back as a negative number).
 */
export function parseMoneyToPaise(raw: unknown): { paise: number } | { error: string } {
  if (raw === null || raw === undefined) return { paise: 0 };
  let text = String(raw).trim();
  if (text === '') return { paise: 0 };
  let sign = 1;
  const drcr = text.match(/\b(dr|cr)\.?$/i);
  if (drcr) {
    if (drcr[1].toLowerCase() === 'cr') sign = -1;
    text = text.slice(0, drcr.index).trim();
  }
  text = text.replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/,/g, '').replace(/\s+/g, '');
  if (text.startsWith('(') && text.endsWith(')')) {
    sign = -sign;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    sign = -sign;
    text = text.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: `"${String(raw).trim()}" is not an amount` };
  const paise = Math.round(Number(text) * 100);
  if (paise > 99_999_999_999) return { error: 'Amount is too large' };
  return { paise: sign * paise };
}

// ---------------------------------------------------------------- CSV

export type CustomerField =
  | 'name'
  | 'phone'
  | 'companyName'
  | 'email'
  | 'gstin'
  | 'state'
  | 'billingAddress'
  | 'openingBalance'
  | 'creditLimit'
  | 'whatsappNumber';

export const CUSTOMER_FIELDS: ReadonlyArray<{ field: CustomerField; label: string; example: string }> = [
  { field: 'name', label: 'Name', example: 'Sri Krishna Sweets' },
  { field: 'phone', label: 'Phone', example: '9443022222' },
  { field: 'companyName', label: 'Company', example: 'Sri Krishna Sweets & Bakery' },
  { field: 'email', label: 'Email', example: 'accounts@example.com' },
  { field: 'gstin', label: 'GSTIN', example: '33AABCS1234A1Z8' },
  { field: 'state', label: 'State', example: 'Tamil Nadu' },
  { field: 'billingAddress', label: 'Address', example: '12 Bazaar Street, Coimbatore 641001' },
  { field: 'openingBalance', label: 'Opening balance', example: '25000' },
  { field: 'creditLimit', label: 'Credit limit', example: '100000' },
  { field: 'whatsappNumber', label: 'WhatsApp number', example: '9443022222' },
];

const HEADER_ALIASES: Record<CustomerField, string[]> = {
  name: ['name', 'customername', 'customer', 'partyname', 'party', 'accountname', 'ledgername', 'contactname', 'clientname'],
  phone: ['phone', 'mobile', 'mobileno', 'mobilenumber', 'phoneno', 'phonenumber', 'contact', 'contactno', 'contactnumber', 'cell'],
  companyName: ['company', 'companyname', 'firm', 'firmname', 'business', 'businessname', 'organisation', 'organization'],
  email: ['email', 'emailid', 'emailaddress', 'mail'],
  gstin: ['gstin', 'gstno', 'gstnumber', 'gst', 'gstinno', 'gstinnumber'],
  state: ['state', 'statecode', 'statename', 'placeofsupply'],
  billingAddress: ['address', 'billingaddress', 'addr', 'fulladdress', 'street'],
  openingBalance: ['openingbalance', 'opening', 'balance', 'outstanding', 'due', 'amountdue', 'receivable', 'closingbalance', 'pending', 'pendingamount'],
  creditLimit: ['creditlimit', 'limit', 'creditlimitamount'],
  whatsappNumber: ['whatsapp', 'whatsappnumber', 'whatsappno', 'wa', 'wanumber'],
};

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Parses CSV text (comma, semicolon or tab separated, quotes and embedded newlines supported) into rows of cells. */
export function parseDelimited(input: string): string[][] {
  let text = input.replace(/^﻿/, '');
  if (!text.trim()) return [];
  const firstLine = text.split(/\r?\n/, 1)[0];
  const count = (c: string) => (firstLine.match(new RegExp(c === '\t' ? '\\t' : `\\${c}`, 'g')) ?? []).length;
  const delimiter = [',', '\t', ';'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface ParsedSheet {
  /** Which spreadsheet column each customer field was read from (column index), by field. */
  mapping: Partial<Record<CustomerField, number>>;
  /** Headers that matched nothing and were ignored. */
  ignoredHeaders: string[];
  /** One object per data row, with trimmed text values keyed by field. */
  rows: Array<Partial<Record<CustomerField, string>>>;
}

/** Reads a customer sheet: matches headers to fields (case and punctuation ignored) and maps every row. */
export function parseCustomerSheet(text: string): ParsedSheet {
  const cells = parseDelimited(text);
  if (cells.length === 0) return { mapping: {}, ignoredHeaders: [], rows: [] };
  const [header, ...body] = cells;
  const mapping: Partial<Record<CustomerField, number>> = {};
  const ignored: string[] = [];
  header.forEach((h, idx) => {
    const key = headerKey(h);
    const field = (Object.keys(HEADER_ALIASES) as CustomerField[]).find((f) => HEADER_ALIASES[f].includes(key));
    if (field && mapping[field] === undefined) mapping[field] = idx;
    else if (h.trim() !== '') ignored.push(h.trim());
  });
  const rows = body.map((r) => {
    const o: Partial<Record<CustomerField, string>> = {};
    for (const [field, idx] of Object.entries(mapping) as Array<[CustomerField, number]>) {
      o[field] = (r[idx] ?? '').trim();
    }
    return o;
  });
  return { mapping, ignoredHeaders: ignored, rows };
}

/** A ready-to-fill CSV with the recognised columns and one example row. */
export function customerTemplateCsv(): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [CUSTOMER_FIELDS.map((f) => f.label).join(','), CUSTOMER_FIELDS.map((f) => q(f.example)).join(',')].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- row validation

export interface CleanCustomer {
  name: string;
  phone: string; // E.164
  whatsappNumber: string; // E.164
  companyName: string | null;
  email: string | null;
  gstin: string | null;
  stateCode: string | null;
  billingAddress: string | null;
  /** What the customer owed before Friendly CRM, in paise. */
  openingBalancePaise: number;
  creditLimitPaise: number;
}

/** alue is set exactly when ok is true. (Not a union, so it works the same with or without strict null checks.) */
export interface RowCheck {
  ok: boolean;
  value: CleanCustomer | null;
  errors: string[];
  warnings: string[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates one raw row. Collects every problem so the person can fix them all at once. */
export function validateCustomerRow(raw: Partial<Record<CustomerField, unknown>>): RowCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = (k: CustomerField) => (raw[k] === undefined || raw[k] === null ? '' : String(raw[k]).trim());

  const name = cleanDisplayName(text('name'));
  if (!name) errors.push('Name is missing');
  else if (name.length > 160) errors.push('Name is longer than 160 characters');

  const phone = normalizeContactPhone(raw.phone);
  if (!text('phone')) errors.push('Phone is missing');
  else if (!phone) errors.push(`Phone "${text('phone')}" is not a valid mobile number`);

  let whatsapp = phone;
  if (text('whatsappNumber')) {
    const w = normalizeContactPhone(raw.whatsappNumber);
    if (!w) errors.push(`WhatsApp number "${text('whatsappNumber')}" is not valid`);
    else whatsapp = w;
  }

  const company = cleanDisplayName(text('companyName'));
  if (company.length > 160) errors.push('Company is longer than 160 characters');

  const email = text('email');
  if (email && (!EMAIL.test(email) || email.length > 160)) errors.push(`Email "${email}" is not valid`);

  let gstin: string | null = null;
  if (text('gstin')) {
    const g = normalizeGstin(text('gstin'));
    if (!isValidGstin(g)) errors.push(`GSTIN "${text('gstin')}" is not valid`);
    else gstin = g;
  }

  let stateCode: string | null = null;
  if (text('state')) {
    stateCode = parseStateCode(text('state'));
    if (!stateCode) errors.push(`State "${text('state')}" is not recognised`);
  }
  if (gstin) {
    const fromGstin = stateCodeFromGstin(gstin);
    if (stateCode && fromGstin && stateCode !== fromGstin) {
      errors.push(`State does not match the GSTIN (the GSTIN is for state ${fromGstin})`);
    }
    stateCode = fromGstin ?? stateCode;
  }

  const address = text('billingAddress');
  if (address.length > 500) errors.push('Address is longer than 500 characters');

  const money = (k: CustomerField, label: string, allowNegative = false): number => {
    const r = parseMoneyToPaise(raw[k]);
    if ('error' in r) {
      errors.push(`${label}: ${r.error}`);
      return 0;
    }
    if (r.paise < 0 && !allowNegative) {
      errors.push(`${label} cannot be negative`);
      return 0;
    }
    return r.paise;
  };
  // A negative opening balance (Tally "Cr") is a customer who has paid in advance: we owe them, and it is kept as credit
  const openingBalancePaise = money('openingBalance', 'Opening balance', true);
  const creditLimitPaise = money('creditLimit', 'Credit limit');
  if (openingBalancePaise < 0) {
    warnings.push(`In credit: the customer has paid ₹${(-openingBalancePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in advance. It is kept as credit to use against their orders`);
  }
  if (openingBalancePaise > 0 && creditLimitPaise > 0 && openingBalancePaise > creditLimitPaise) {
    warnings.push('Opening balance is above the credit limit');
  }

  if (errors.length > 0 || !phone) return { ok: false, value: null, errors, warnings };
  return {
    ok: true,
    errors: [],
    warnings,
    value: {
      name,
      phone,
      whatsappNumber: whatsapp ?? phone,
      companyName: company || null,
      email: email || null,
      gstin,
      stateCode,
      billingAddress: address || null,
      openingBalancePaise,
      creditLimitPaise,
    },
  };
}
