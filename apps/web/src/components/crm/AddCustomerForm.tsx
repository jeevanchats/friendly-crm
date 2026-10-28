'use client';
import { useDialog } from '../shared/useDialog';

import React, { useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { GST_STATES, hasPermission, normalizeGstin, stateCodeFromGstin, validateCustomerRow, TenantRole } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';

interface Props {
  role: TenantRole;
  lang?: 'en' | 'ta';
  onClose: () => void;
  onCreated: () => void;
}

/** Adds one customer (no enquiry or task). The server re-checks everything; this just saves a round trip. */
export function AddCustomerForm({ role, lang = 'en', onClose, onCreated }: Props) {
  const ta = lang === 'ta';
  const canBalance = hasPermission(role, 'payment:create');
  const [f, setF] = useState({
    name: '',
    phone: '',
    companyName: '',
    email: '',
    gstin: '',
    state: '',
    billingAddress: '',
    openingBalance: '',
    creditLimit: '',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const gstState = f.gstin.trim() ? stateCodeFromGstin(normalizeGstin(f.gstin)) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setExistingId(null);
    const check = validateCustomerRow(f);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const res = await apiFetch('/api/crm/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(f),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        onCreated();
        return;
      }
      if (res.status === 409) setExistingId(body.customerId ?? null);
      setErrors(body.errors ?? [Array.isArray(body.message) ? body.message.join(' ') : body.message || `Could not add the customer (${res.status}).`]);
    } catch {
      setErrors([ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server. Check your connection and try again.']);
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';

  const dialogRef = useDialog(true, busy ? undefined : onClose);
  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={ta ? 'புதிய வாடிக்கையாளர்' : 'Add customer'}>
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-foreground">{ta ? 'புதிய வாடிக்கையாளர்' : 'Add customer'}</h2>
          <button type="button" onClick={onClose} aria-label={ta ? 'மூடு' : 'Close'} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="c-name" className={label}>{ta ? 'பெயர் *' : 'Name *'}</label>
            <input id="c-name" className={input} value={f.name} onChange={set('name')} maxLength={160} autoFocus />
          </div>
          <div>
            <label htmlFor="c-phone" className={label}>{ta ? 'மொபைல் *' : 'Mobile *'}</label>
            <input id="c-phone" className={input} value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="98400 11111" />
          </div>
          <div>
            <label htmlFor="c-company" className={label}>{ta ? 'நிறுவனம்' : 'Company'}</label>
            <input id="c-company" className={input} value={f.companyName} onChange={set('companyName')} maxLength={160} />
          </div>
          <div>
            <label htmlFor="c-email" className={label}>Email</label>
            <input id="c-email" className={input} value={f.email} onChange={set('email')} type="email" />
          </div>
          <div>
            <label htmlFor="c-gstin" className={label}>GSTIN</label>
            <input id="c-gstin" className={`${input} uppercase`} value={f.gstin} onChange={set('gstin')} maxLength={15} placeholder={ta ? 'பதிவு இல்லையெனில் காலி' : 'Blank if unregistered'} autoComplete="off" />
          </div>
          <div>
            <label htmlFor="c-state" className={label}>{ta ? 'மாநிலம்' : 'State'}</label>
            <select id="c-state" className={input} value={gstState ?? f.state} disabled={!!gstState} onChange={set('state')}>
              <option value="">{ta ? 'தேர்வு செய்யவும்' : 'Not set'}</option>
              {Object.entries(GST_STATES).map(([code, name]) => (
                <option key={code} value={code}>{code} - {name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="c-addr" className={label}>{ta ? 'முகவரி' : 'Billing address'}</label>
          <textarea id="c-addr" className={input} rows={2} value={f.billingAddress} onChange={set('billingAddress')} maxLength={500} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {canBalance && (
            <div>
              <label htmlFor="c-open" className={label}>{ta ? 'தொடக்க நிலுவை (₹)' : 'Opening balance owed (₹)'}</label>
              <input id="c-open" className={input} value={f.openingBalance} onChange={set('openingBalance')} inputMode="decimal" placeholder="0" />
              <p className="mt-1 text-[11px] text-slate-600">{ta ? 'இந்த செயலிக்கு முன் அவர் தர வேண்டிய தொகை.' : 'What they owed you before Friendly CRM.'}</p>
            </div>
          )}
          <div>
            <label htmlFor="c-limit" className={label}>{ta ? 'கடன் வரம்பு (₹)' : 'Credit limit (₹)'}</label>
            <input id="c-limit" className={input} value={f.creditLimit} onChange={set('creditLimit')} inputMode="decimal" placeholder="0" />
          </div>
        </div>

        {errors.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">
            {errors.map((m) => (
              <li key={m}>• {m}</li>
            ))}
            {existingId && (
              <li>
                <Link href={`/customers/${existingId}`} className="text-brand-ink underline">{ta ? 'இருக்கும் வாடிக்கையாளரைத் திற' : 'Open the existing customer'}</Link>
              </li>
            )}
          </ul>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded-lg bg-action px-4 py-2 text-sm font-bold text-on-action disabled:opacity-50">
            {busy ? (ta ? 'சேர்க்கிறது…' : 'Adding…') : ta ? 'சேர்' : 'Add customer'}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">
            {ta ? 'ரத்து' : 'Cancel'}
          </button>
        </div>
      </form>
    </div>
  );
}
