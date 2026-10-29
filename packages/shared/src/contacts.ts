import { normalizeContactPhone } from './customer-import';
import { cleanDisplayName } from './duplicates';

/** One person who deals with us for a customer (owner, accounts, purchase...). */
export interface CleanContact {
  name: string;
  designation: string | null;
  /** E.164, e.g. +919840011111 */
  phone: string;
  email: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks a contact as typed. Used by the browser (to save a round trip) and by the server (which is the one that counts).
 * With `partial`, only the fields that are present are checked (for edits).
 */
export function validateContact(
  raw: Record<string, unknown>,
  opts: { partial?: boolean } = {}
): { ok: boolean; errors: string[]; value: Partial<CleanContact> } {
  const errors: string[] = [];
  const value: Partial<CleanContact> = {};
  const has = (k: string) => raw[k] !== undefined;
  const text = (k: string) => (raw[k] === undefined || raw[k] === null ? '' : String(raw[k]).trim());

  if (!opts.partial || has('name')) {
    const name = cleanDisplayName(text('name'));
    if (!name) errors.push('Name is missing');
    else if (name.length > 160) errors.push('Name is longer than 160 characters');
    else value.name = name;
  }

  if (!opts.partial || has('phone')) {
    if (!text('phone')) errors.push('Phone is missing');
    else {
      const phone = normalizeContactPhone(raw.phone);
      if (!phone) errors.push(`Phone "${text('phone')}" is not a valid mobile number`);
      else value.phone = phone;
    }
  }

  if (has('designation')) {
    const d = cleanDisplayName(text('designation'));
    if (d.length > 80) errors.push('Role is longer than 80 characters');
    else value.designation = d || null;
  } else if (!opts.partial) value.designation = null;

  if (has('email')) {
    const e = text('email');
    if (e && (!EMAIL.test(e) || e.length > 160)) errors.push(`Email "${e}" is not valid`);
    else value.email = e || null;
  } else if (!opts.partial) value.email = null;

  return { ok: errors.length === 0, errors, value };
}
