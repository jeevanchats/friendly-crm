'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { hasPermission, TenantRole } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';

interface Options {
  credit: string;
  balanceDue: string;
  targets: Array<{ id: string; orderNumber: string; balanceDue: string }>;
  sources: Array<{ id: string; orderNumber: string; credit: string }>;
}

const rupees = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lesser = (a: string | number, b: string | number) => Math.min(Number(a), Number(b)).toFixed(2);

/**
 * One order of a customer can be in credit (they paid more than it now comes to, after a credit note) while another order of
 * theirs still owes money. Here the credit is used against the other order instead of being handed back. No money leaves
 * the business: the two orders' paid amounts change by the same figure, a receipt is written on the order that receives it, and the
 * move is recorded. Shows nothing when this order has neither credit to give nor dues that another order's credit could pay.
 */
export function CreditTransferPanel({ orderId, role, lang = 'en', onMoved }: { orderId: string; role: TenantRole; lang?: 'en' | 'ta'; onMoved?: () => void }) {
  const ta = lang === 'ta';
  const canView = hasPermission(role, 'payment:view');
  const canMove = hasPermission(role, 'payment:create');
  const [info, setInfo] = useState<Options | null>(null);
  const [pick, setPick] = useState<{ out: string; in: string }>({ out: '', in: '' });
  const [amount, setAmount] = useState<{ out: string; in: string }>({ out: '', in: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt, so a double click or a retry never moves the credit twice
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/orders/${orderId}/credit-transfer`);
      if (!res.ok) return;
      const body = (await res.json()) as Options;
      setInfo(body);
      const t = body.targets[0];
      const s = body.sources[0];
      setPick({ out: t?.id ?? '', in: s?.id ?? '' });
      setAmount({ out: t ? lesser(body.credit, t.balanceDue) : '', in: s ? lesser(s.credit, body.balanceDue) : '' });
    } catch {
      // a lookup that fails just shows nothing
    }
  }, [orderId]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  const canGive = !!info && Number(info.credit) > 0 && info.targets.length > 0;
  const canTake = !!info && Number(info.balanceDue) > 0 && info.sources.length > 0;
  if (!canView || !info || (!canGive && !canTake)) return null;

  const move = async (direction: 'out' | 'in', e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const value = Number(amount[direction]);
    const max = direction === 'out'
      ? lesser(info.credit, info.targets.find((t) => t.id === pick.out)?.balanceDue ?? 0)
      : lesser(info.sources.find((s) => s.id === pick.in)?.credit ?? 0, info.balanceDue);
    if (!pick[direction]) return setError(ta ? 'ஆர்டரைத் தேர்ந்தெடுக்கவும்.' : 'Choose an order.');
    if (!(value > 0) || Math.round(value * 100) / 100 !== value) return setError(ta ? 'ரூபாய் மற்றும் பைசாவில் தொகையை உள்ளிடவும்.' : 'Enter an amount in rupees and paise.');
    if (value > Number(max)) return setError(ta ? `அதிகபட்சம் ${rupees(max)} மாற்றலாம்.` : `At most ${rupees(max)} can be moved.`);
    setBusy(true);
    setError(null);
    try {
      // The route belongs to the order the credit leaves
      const from = direction === 'out' ? orderId : pick.in;
      const to = direction === 'out' ? pick.out : orderId;
      const res = await apiFetch(`/api/orders/${from}/credit-transfer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': attemptKey },
        body: JSON.stringify({ toOrderId: to, amount: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setAttemptKey(crypto.randomUUID());
        onMoved?.();
        await load();
        return;
      }
      setError(Array.isArray(body.message) ? body.message.join(' ') : body.message || (ta ? 'கிரெடிட்டை மாற்ற முடியவில்லை.' : 'Could not move the credit.'));
    } catch {
      setError(ta ? 'சர்வரை அடைய முடியவில்லை. மீண்டும் முயற்சிக்கவும்.' : 'Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-40 rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm';
  const label = 'mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500';
  const button = 'min-h-[40px] rounded-xl bg-action px-4 text-sm font-bold text-on-action disabled:opacity-60';

  return (
    <section className="space-y-3 rounded-2xl border border-sky-300 bg-sky-50 p-4" aria-label={ta ? 'ஆர்டர்களுக்கு இடையே கிரெடிட்' : 'Credit between orders'}>
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-sky-900">
        <ArrowRightLeft className="h-4 w-4" /> {ta ? 'இந்த வாடிக்கையாளரின் மற்றொரு ஆர்டருடன் கிரெடிட்' : 'Use credit between this customer’s orders'}
      </h3>
      <p className="text-xs text-sky-900">
        {ta
          ? 'பணம் எதுவும் வெளியே போகாது: இரு ஆர்டர்களின் செலுத்திய தொகை சம அளவில் மாறும், பெறும் ஆர்டரில் ரசீது எழுதப்படும்.'
          : 'No money leaves the business: the two orders’ paid amounts change by the same figure, a receipt is written on the order that receives it, and the move is recorded.'}
      </p>

      {canGive && (
        <form onSubmit={(e) => move('out', e)} className="space-y-1">
          <p className="text-xs font-semibold text-sky-900">
            {ta ? `இந்த ஆர்டரில் ${rupees(info.credit)} கிரெடிட் உள்ளது.` : `This order holds ${rupees(info.credit)} of credit.`}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="ct-target" className={label}>{ta ? 'இந்த ஆர்டருக்குப் பயன்படுத்து' : 'Use it on order'}</label>
              <select
                id="ct-target"
                className={input}
                value={pick.out}
                onChange={(e) => {
                  const t = info.targets.find((x) => x.id === e.target.value);
                  setPick((p) => ({ ...p, out: e.target.value }));
                  if (t) setAmount((a) => ({ ...a, out: lesser(info.credit, t.balanceDue) }));
                }}
              >
                {info.targets.map((t) => (
                  <option key={t.id} value={t.id}>{`${t.orderNumber} (${ta ? 'பாக்கி' : 'owes'} ${rupees(t.balanceDue)})`}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ct-out-amount" className={label}>{ta ? 'தொகை (₹)' : 'Amount (₹)'}</label>
              <input id="ct-out-amount" className={input} inputMode="decimal" value={amount.out} onChange={(e) => setAmount((a) => ({ ...a, out: e.target.value }))} />
            </div>
            {canMove && <button type="submit" disabled={busy} className={button}>{busy ? '…' : ta ? 'கிரெடிட்டை மாற்று' : 'Move the credit'}</button>}
          </div>
        </form>
      )}

      {canTake && (
        <form onSubmit={(e) => move('in', e)} className="space-y-1">
          <p className="text-xs font-semibold text-sky-900">
            {ta ? `இந்த ஆர்டருக்கு இன்னும் ${rupees(info.balanceDue)} பாக்கி.` : `This order still owes ${rupees(info.balanceDue)}.`}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="ct-source" className={label}>{ta ? 'கிரெடிட் எடுக்கும் ஆர்டர்' : 'Take credit from order'}</label>
              <select
                id="ct-source"
                className={input}
                value={pick.in}
                onChange={(e) => {
                  const s = info.sources.find((x) => x.id === e.target.value);
                  setPick((p) => ({ ...p, in: e.target.value }));
                  if (s) setAmount((a) => ({ ...a, in: lesser(s.credit, info.balanceDue) }));
                }}
              >
                {info.sources.map((s) => (
                  <option key={s.id} value={s.id}>{`${s.orderNumber} (${ta ? 'கிரெடிட்' : 'credit'} ${rupees(s.credit)})`}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ct-in-amount" className={label}>{ta ? 'தொகை (₹)' : 'Amount (₹)'}</label>
              <input id="ct-in-amount" className={input} inputMode="decimal" value={amount.in} onChange={(e) => setAmount((a) => ({ ...a, in: e.target.value }))} />
            </div>
            {canMove && <button type="submit" disabled={busy} className={button}>{busy ? '…' : ta ? 'கிரெடிட்டைப் பயன்படுத்து' : 'Use that credit'}</button>}
          </div>
        </form>
      )}

      {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
    </section>
  );
}
