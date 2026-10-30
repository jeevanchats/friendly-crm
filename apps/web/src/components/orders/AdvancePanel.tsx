'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { hasPermission, TenantRole } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';

interface Availability {
  credit: string;
  balanceDue: string;
  available: string;
}

const rupees = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A customer who paid in advance before Friendly CRM (imported as "Cr" / a negative opening balance) is owed that money.
 * When they order, it is used up here: the order's balance and the advance come down together, and a receipt is written.
 * Shows nothing when there is no advance to use or the order has nothing left to pay.
 */
export function AdvancePanel({ orderId, role, lang = 'en', onApplied }: { orderId: string; role: TenantRole; lang?: 'en' | 'ta'; onApplied?: () => void }) {
  const ta = lang === 'ta';
  const canView = hasPermission(role, 'payment:view');
  const canApply = hasPermission(role, 'payment:create');
  const [info, setInfo] = useState<Availability | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt, so a double click or a retry never uses the advance twice
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/orders/${orderId}/advance`);
      if (!res.ok) return;
      const body = (await res.json()) as Availability;
      setInfo(body);
      setAmount(body.available);
    } catch {
      // a lookup that fails just shows nothing
    }
  }, [orderId]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  if (!canView || !info || Number(info.available) <= 0) return null;

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const value = Number(amount);
    if (!(value > 0) || Math.round(value * 100) / 100 !== value) return setError(ta ? 'ரூபாய் மற்றும் பைசாவில் தொகையை உள்ளிடவும்.' : 'Enter an amount in rupees and paise.');
    if (value > Number(info.available)) return setError(ta ? `அதிகபட்சம் ${rupees(info.available)} பயன்படுத்தலாம்.` : `At most ${rupees(info.available)} can be used.`);
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/orders/${orderId}/apply-advance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': attemptKey },
        body: JSON.stringify({ amount: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setAttemptKey(crypto.randomUUID());
        onApplied?.();
        return;
      }
      setError(Array.isArray(body.message) ? body.message.join(' ') : body.message || (ta ? 'முன்பணத்தைப் பயன்படுத்த முடியவில்லை.' : 'Could not use the advance.'));
    } catch {
      setError(ta ? 'சர்வரை அடைய முடியவில்லை. மீண்டும் முயற்சிக்கவும்.' : 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-2xl border border-emerald-300 bg-emerald-50 p-4" aria-label={ta ? 'வாடிக்கையாளர் முன்பணம்' : 'Customer advance'}>
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-emerald-900">
        <Wallet className="h-4 w-4" /> {ta ? 'வாடிக்கையாளர் முன்பணம் செலுத்தியுள்ளார்' : 'This customer paid in advance'}
      </h3>
      <p className="text-xs text-emerald-900">
        {ta
          ? `முன்பணம் ${rupees(info.credit)}; இந்த ஆர்டருக்கு இன்னும் ${rupees(info.balanceDue)} பாக்கி. அதிலிருந்து ${rupees(info.available)} வரை பயன்படுத்தலாம்.`
          : `Advance on record: ${rupees(info.credit)}. This order still owes ${rupees(info.balanceDue)}. Up to ${rupees(info.available)} can be used now.`}
      </p>
      {canApply && (
        <form onSubmit={apply} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="adv-amount" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {ta ? 'பயன்படுத்தும் தொகை (₹)' : 'Amount to use (₹)'}
            </label>
            <input id="adv-amount" className="w-40 rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <button type="submit" disabled={busy} className="min-h-[40px] rounded-xl bg-action px-4 text-sm font-bold text-on-action disabled:opacity-60">
            {busy ? '…' : ta ? 'முன்பணத்தைப் பயன்படுத்து' : 'Use the advance'}
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
    </section>
  );
}
