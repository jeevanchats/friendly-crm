'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { hasPermission, TenantRole } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';

interface Refund {
  id: string;
  refundNumber: string;
  amount: string;
  mode: string;
  referenceNo: string | null;
  refundedAt: string;
  notes: string | null;
}

const MODES: Array<{ value: string; en: string; ta: string }> = [
  { value: 'BANK_TRANSFER', en: 'Bank transfer', ta: 'வங்கிப் பரிமாற்றம்' },
  { value: 'UPI', en: 'UPI', ta: 'UPI' },
  { value: 'CASH', en: 'Cash', ta: 'பணம்' },
  { value: 'CHEQUE', en: 'Cheque', ta: 'காசோலை' },
];

const rupees = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Money handed back to a customer: out of an order's credit (a credit note lowered the order below what they had paid), or
 * out of the customer's advance (paid before Friendly CRM, imported as "Cr"). `endpoint` is the refunds route of either.
 * This only RECORDS a refund that has been paid out of the app (bank, UPI, cash or cheque): it does not send any money.
 * Shows nothing when the order has no refunds and no credit.
 */
export function RefundPanel({
  endpoint,
  kind = 'order',
  role,
  lang = 'en',
  onChanged,
}: {
  /** The refunds route: `/api/orders/:id/refunds` or `/api/crm/customers/:id/advance-refunds` */
  endpoint: string;
  kind?: 'order' | 'advance';
  role: TenantRole;
  lang?: 'en' | 'ta';
  onChanged?: () => void;
}) {
  const ta = lang === 'ta';
  const canView = hasPermission(role, 'payment:view');
  const canRecord = hasPermission(role, 'payment:create');

  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [credit, setCredit] = useState('0.00');
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt, so a double click or a retry after a bad connection never pays out twice
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(endpoint);
      if (!res.ok) return;
      const body = (await res.json()) as { data: Refund[]; creditRemaining: string };
      setRefunds(body.data);
      setCredit(body.creditRemaining);
    } catch {
      // a lookup that fails just shows nothing
    }
  }, [endpoint]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  const inCredit = Number(credit) > 0;
  if (!canView || (!inCredit && refunds.length === 0)) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const value = Number(amount);
    if (!(value > 0)) return setError(ta ? 'தொகையை உள்ளிடவும்.' : 'Enter the amount.');
    if (Math.round(value * 100) / 100 !== value) return setError(ta ? 'ரூபாய் மற்றும் பைசாவில் உள்ளிடவும்.' : 'Use rupees and paise only.');
    if (value > Number(credit)) return setError(ta ? `கிரெடிட் ${rupees(credit)} மட்டுமே உள்ளது.` : `Only ${rupees(credit)} is in credit.`);
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': attemptKey },
        body: JSON.stringify({ amount: value, mode, referenceNo: reference.trim() || undefined, notes: notes.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setOpen(false);
        setAmount('');
        setReference('');
        setNotes('');
        setAttemptKey(crypto.randomUUID());
        await load();
        onChanged?.();
        return;
      }
      setError(Array.isArray(body.message) ? body.message.join(' ') : body.message || (ta ? 'பதிவு செய்ய முடியவில்லை.' : 'Could not record the refund.'));
    } catch {
      setError(ta ? 'சர்வரை அடைய முடியவில்லை. மீண்டும் முயற்சிக்கவும்.' : 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm';
  const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';

  return (
    <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4" aria-label={ta ? 'பணத் திரும்பல்' : 'Refunds'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
          <Undo2 className="h-4 w-4" />{' '}
          {kind === 'advance'
            ? ta ? 'முன்பணத் திருப்பல்' : 'Refund of the customer’s advance'
            : ta ? 'வாடிக்கையாளருக்குத் திருப்பிக் கொடுத்த பணம்' : 'Money paid back to the customer'}
        </h3>
        {inCredit && canRecord && !open && (
          <button type="button" onClick={() => { setAmount(credit); setError(null); setOpen(true); }} className="min-h-[36px] rounded-lg border border-amber-400 bg-surface px-3 text-xs font-bold text-amber-900">
            {ta ? 'திருப்பிக் கொடுத்ததைப் பதிவு செய்' : 'Record a refund'}
          </button>
        )}
      </div>
      {inCredit && (
        <p className="text-xs font-semibold text-amber-900">
          {kind === 'advance'
            ? ta ? 'வாடிக்கையாளர் முன்பணம் (திருப்பித் தர வேண்டியது):' : 'Advance paid by the customer, owed back:'
            : ta ? 'வாடிக்கையாளருக்குத் தர வேண்டிய கிரெடிட்:' : 'Credit owed back to the customer:'}{' '}
          {rupees(credit)}
        </p>
      )}

      {open && (
        <form onSubmit={submit} className="space-y-3 rounded-xl bg-surface p-3">
          <p className="text-[11px] text-slate-600">
            {ta
              ? 'இது நீங்கள் ஏற்கனவே வங்கி, UPI, பணம் அல்லது காசோலை மூலம் கொடுத்த பணத்தை மட்டும் பதிவு செய்கிறது. இந்த செயலி பணம் அனுப்பாது.'
              : 'This only records money you have already paid back (bank, UPI, cash or cheque). The app does not send any money.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rf-amount" className={label}>{ta ? 'தொகை (₹) *' : 'Amount (₹) *'}</label>
              <input id="rf-amount" className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div>
              <label htmlFor="rf-mode" className={label}>{ta ? 'எப்படி கொடுத்தீர்கள்' : 'Paid back by'}</label>
              <select id="rf-mode" className={input} value={mode} onChange={(e) => setMode(e.target.value)}>
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>{ta ? m.ta : m.en}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rf-ref" className={label}>{ta ? 'குறிப்பு எண் (UTR / காசோலை)' : 'Reference (UTR / cheque no.)'}</label>
              <input id="rf-ref" className={input} value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rf-notes" className={label}>{ta ? 'குறிப்புகள்' : 'Notes'}</label>
              <input id="rf-notes" className={input} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="min-h-[40px] rounded-xl bg-action px-4 text-sm font-bold text-on-action disabled:opacity-60">
              {busy ? '…' : ta ? 'பதிவு செய்' : 'Record refund'}
            </button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-[40px] rounded-xl border border-slate-300 px-4 text-sm font-semibold text-foreground">
              {ta ? 'ரத்து' : 'Cancel'}
            </button>
          </div>
        </form>
      )}

      {refunds.length > 0 && (
        <ul className="divide-y divide-amber-200 text-xs text-amber-950">
          {refunds.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5">
              <span className="font-semibold">{r.refundNumber}</span>
              <span>
                {new Date(r.refundedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · {MODES.find((m) => m.value === r.mode)?.[ta ? 'ta' : 'en'] ?? r.mode}
                {r.referenceNo ? ` · ${r.referenceNo}` : ''}
              </span>
              <span className="font-bold">{rupees(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {error && !open && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
    </section>
  );
}
