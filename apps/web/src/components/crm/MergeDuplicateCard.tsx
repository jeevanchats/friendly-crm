'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Merge } from 'lucide-react';
import { hasPermission, TenantRole } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';
import { useSimilar, SimilarMatch } from '../shared/SimilarMatches';

/**
 * "Is another customer really the same business?" Lists customers that look like this one and folds a chosen duplicate
 * into this customer (its enquiries, quotes, orders, invoices, payments and numbers all move here). Owners and admins only.
 */
export function MergeDuplicateCard({
  customerId,
  name,
  companyName,
  gstin,
  role,
  lang = 'en',
}: {
  customerId: string;
  name: string;
  companyName?: string | null;
  gstin?: string | null;
  role: TenantRole;
  lang?: 'en' | 'ta';
}) {
  const ta = lang === 'ta';
  const router = useRouter();
  const allowed = hasPermission(role, 'customer:delete');
  const near = useSimilar('/api/crm/customers/similar', { name, companyName: companyName ?? '', gstin: gstin ?? '' }, allowed && !!name).filter((m) => m.id !== customerId);
  const [choice, setChoice] = useState<SimilarMatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  if (!allowed || (near.length === 0 && !done)) return null;

  const merge = async () => {
    if (!choice) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch(`/api/crm/customers/${customerId}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromId: choice.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(ta ? `${choice.name} இந்த வாடிக்கையாளருடன் இணைக்கப்பட்டது.` : `${choice.name} was merged into this customer.`);
        setChoice(null);
        router.refresh();
        return;
      }
      setError(Array.isArray(body.message) ? body.message.join(' ') : body.message || (ta ? 'இணைக்க முடியவில்லை.' : 'Could not merge.'));
    } catch {
      setError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm" aria-label={ta ? 'நகல் வாடிக்கையாளர்' : 'Possible duplicate customer'}>
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
        <Merge className="h-4 w-4" /> {ta ? 'இதே வணிகமா வேறொரு வாடிக்கையாளர்?' : 'Is another customer the same business?'}
      </h3>
      {done && <p role="status" className="text-xs font-semibold text-emerald-800">{done}</p>}
      {near.length > 0 && (
        <>
          <p className="text-[11px] text-amber-900">
            {ta
              ? 'ஒன்றைத் தேர்ந்தெடுத்து இணைத்தால், அதன் விசாரணைகள், விலைப்புள்ளிகள், ஆர்டர்கள், இன்வாய்ஸ்கள், பணம் மற்றும் எண்கள் இந்த வாடிக்கையாளருக்கு மாறும்; அது நீக்கப்படும்.'
              : 'Merging moves that customer’s enquiries, quotes, orders, invoices, payments and phone numbers to this customer, then removes it. This cannot be undone.'}
          </p>
          <ul className="space-y-1.5">
            {near.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-surface px-3 py-2 text-sm">
                <span>
                  <span className="font-semibold text-foreground">{m.name}</span>
                  {m.companyName ? <span className="text-slate-600"> · {m.companyName}</span> : null}
                  {m.phone ? <span className="text-slate-600"> · {m.phone}</span> : null}
                </span>
                <button type="button" onClick={() => { setError(''); setDone(''); setChoice(m); }} className="min-h-[36px] rounded-lg border border-amber-400 px-3 text-xs font-bold text-amber-900">
                  {ta ? 'இணை…' : 'Merge…'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {choice && (
        <div className="space-y-2 rounded-lg border border-rose-300 bg-surface p-3">
          <p className="text-sm font-semibold text-foreground">
            {ta ? `“${choice.name}” ஐ இந்த வாடிக்கையாளருடன் இணைக்கவா?` : `Merge “${choice.name}” into this customer?`}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={merge} className="min-h-[40px] rounded-xl bg-action px-4 text-sm font-bold text-on-action disabled:opacity-60">
              {busy ? '…' : ta ? 'ஆம், இணை' : 'Yes, merge'}
            </button>
            <button type="button" disabled={busy} onClick={() => setChoice(null)} className="min-h-[40px] rounded-xl border border-slate-300 px-4 text-sm font-semibold text-foreground">
              {ta ? 'வேண்டாம்' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
    </section>
  );
}
