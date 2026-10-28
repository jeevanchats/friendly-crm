'use client';

import React, { useState } from 'react';
import { GST_STATES, hasPermission, isValidGstin, normalizeGstin, stateCodeFromGstin, TenantRole } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';

interface Props {
  customerId: string;
  role: TenantRole;
  initial: { gstin?: string | null; billingAddress?: string | null; stateCode?: string | null; remindersOptOut?: boolean };
  lang?: 'en' | 'ta';
}

/** The buyer details a GST invoice needs: GSTIN, billing address, and state when there is no GSTIN. */
export function BillingDetailsCard({ customerId, role, initial, lang = 'en' }: Props) {
  const ta = lang === 'ta';
  const canEdit = hasPermission(role, 'customer:update');
  const [editing, setEditing] = useState(false);
  const [gstin, setGstin] = useState(initial.gstin ?? '');
  const [address, setAddress] = useState(initial.billingAddress ?? '');
  const [state, setState] = useState(initial.stateCode ?? '');
  const [optOut, setOptOut] = useState(initial.remindersOptOut === true);
  const [shown, setShown] = useState({ gstin: initial.gstin ?? '', address: initial.billingAddress ?? '', state: initial.stateCode ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const g = normalizeGstin(gstin);
  const gProblem = g !== '' && !isValidGstin(g);
  const gState = g !== '' && !gProblem ? stateCodeFromGstin(g) : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/crm/customers/${customerId}/billing`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gstin: g || null, billingAddress: address.trim() || null, ...(g ? {} : { stateCode: state || null }), remindersOptOut: optOut }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setShown({ gstin: body.gstin ?? '', address: body.billingAddress ?? '', state: body.stateCode ?? '' });
        setState(body.stateCode ?? '');
        setEditing(false);
      } else {
        setError(Array.isArray(body.message) ? body.message.join(' ') : body.message || `Could not save (${res.status}).`);
      }
    } catch {
      setError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs';
  const label = 'block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1';

  return (
    <section className="rounded-2xl bg-surface p-4 shadow-sm border border-slate-200 space-y-2" aria-label={ta ? 'GST விவரங்கள்' : 'GST details'}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">{ta ? 'GST விவரங்கள்' : 'GST details'}</h3>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs font-bold text-brand-ink">{ta ? 'திருத்து' : 'Edit'}</button>
        )}
      </div>

      {!editing ? (
        <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
          <dt className="text-slate-500">GSTIN</dt>
          <dd className="font-semibold">{shown.gstin || (ta ? 'பதிவு இல்லை' : 'Unregistered')}</dd>
          <dt className="text-slate-500">{ta ? 'மாநிலம்' : 'State'}</dt>
          <dd className="font-semibold">{shown.state ? `${shown.state} - ${GST_STATES[shown.state] ?? ''}` : ta ? 'குறிப்பிடப்படவில்லை' : 'Not set'}</dd>
          <dt className="text-slate-500">{ta ? 'முகவரி' : 'Address'}</dt>
          <dd className="font-semibold whitespace-pre-wrap">{shown.address || (ta ? 'குறிப்பிடப்படவில்லை' : 'Not set')}</dd>
          <dt className="text-slate-500">{ta ? 'தானியங்கி நினைவூட்டல்' : 'Auto reminders'}</dt>
          <dd className="font-semibold">{optOut ? (ta ? 'விலக்கப்பட்டது' : 'Excluded') : ta ? 'அனுப்பப்படும்' : 'Allowed'}</dd>
        </dl>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <div>
            <label htmlFor="b-gstin" className={label}>GSTIN</label>
            <input id="b-gstin" className={`${field} uppercase ${gProblem ? 'border-red-400' : ''}`} value={gstin} onChange={(e) => setGstin(e.target.value)} maxLength={15} placeholder={ta ? 'பதிவு இல்லையெனில் காலியாக விடவும்' : 'Leave blank if unregistered'} autoComplete="off" aria-invalid={gProblem} />
            {gProblem && <p className="mt-1 text-[11px] font-semibold text-red-600">{ta ? 'GSTIN சரியாக இல்லை.' : 'This GSTIN is not valid.'}</p>}
          </div>
          <div>
            <label htmlFor="b-state" className={label}>{ta ? 'மாநிலம்' : 'State'}</label>
            <select id="b-state" className={field} value={gState ?? state} disabled={!!gState} onChange={(e) => setState(e.target.value)}>
              <option value="">{ta ? 'தேர்வு செய்யவும்' : 'Not set'}</option>
              {Object.entries(GST_STATES).map(([code, name]) => (
                <option key={code} value={code}>{code} - {name}</option>
              ))}
            </select>
            {gState && <p className="mt-1 text-[11px] text-slate-600">{ta ? 'GSTIN-இலிருந்து எடுக்கப்பட்டது.' : 'Taken from the GSTIN.'}</p>}
          </div>
          <div>
            <label htmlFor="b-addr" className={label}>{ta ? 'முகவரி' : 'Billing address'}</label>
            <textarea id="b-addr" className={field} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} />
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input type="checkbox" checked={optOut} onChange={(e) => setOptOut(e.target.checked)} />
            {ta ? 'தானியங்கி பணம் நினைவூட்டல்களை அனுப்ப வேண்டாம்' : 'Do not send automatic payment reminders'}
          </label>
          {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || gProblem} className="rounded-lg bg-action px-3 py-1.5 text-xs font-bold text-on-action disabled:opacity-50">{busy ? '…' : ta ? 'சேமி' : 'Save'}</button>
            <button type="button" onClick={() => { setEditing(false); setError(null); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">{ta ? 'ரத்து' : 'Cancel'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
