'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Phone, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { hasPermission } from '@friendly-crm/shared';
import { useAuth } from '../../components/auth/AuthProvider';
import { apiFetch } from '../../lib/session';

type BucketKey = '0-30' | '31-60' | '61-90' | '90+' | 'OPENING';

interface DueOrder {
  orderId: string;
  orderNumber: string;
  balanceDue: string;
  ageDays: number;
  bucket: BucketKey;
}

interface DueCustomer {
  customerId: string;
  name: string;
  companyName: string | null;
  phone: string;
  totalDue: string;
  openingBalance: string;
  oldestAgeDays: number;
  bucket: BucketKey;
  orders: DueOrder[];
  lastReminderAt: string | null;
}

interface Receivables {
  totalDue: string;
  customerCount: number;
  buckets: Array<{ key: BucketKey; amount: string; orderCount: number }>;
  customers: DueCustomer[];
}

const rupees = (v: string) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const BUCKET_STYLE: Record<BucketKey, string> = {
  '0-30': 'bg-emerald-50 text-emerald-800 border-emerald-200',
  '31-60': 'bg-amber-50 text-amber-800 border-amber-200',
  '61-90': 'bg-orange-50 text-orange-800 border-orange-200',
  '90+': 'bg-rose-50 text-rose-800 border-rose-200',
  OPENING: 'bg-violet-50 text-violet-800 border-violet-200',
};

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function DuesPage() {
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const canRemind = hasPermission(active!.role, 'payment:create');
  const [lang, setLang] = useState<'en' | 'ta'>('en');
  const [data, setData] = useState<Receivables | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BucketKey | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const ta = lang === 'ta';
  const canRecord = hasPermission(active!.role, 'payment:create');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/receivables');
      if (res.ok) {
        setData(await res.json());
      } else {
        setData(null);
        setError(res.status === 403 ? 'Your role cannot view payments.' : `Could not load dues (${res.status}).`);
      }
    } catch {
      setData(null);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [tenantId, load]);

  const remind = async (c: DueCustomer) => {
    setBusy(c.customerId);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/receivables/customers/${c.customerId}/remind`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const sent = body.status === 'SENT';
        setNotice({
          id: c.customerId,
          ok: sent,
          text: sent
            ? ta ? 'நினைவூட்டல் அனுப்பப்பட்டது.' : 'Reminder sent on WhatsApp.'
            : ta ? 'நினைவூட்டல் வரிசையில் உள்ளது; இன்னும் அனுப்பப்படவில்லை.' : 'Reminder queued but not delivered yet. It will retry.',
        });
        await load();
      } else {
        setNotice({
          id: c.customerId,
          ok: false,
          text: res.status === 409
            ? ta ? 'கடந்த 24 மணி நேரத்தில் ஏற்கனவே நினைவூட்டல் அனுப்பப்பட்டது.' : 'A reminder already went out in the last 24 hours.'
            : body.message || (ta ? 'அனுப்ப முடியவில்லை.' : 'Could not send the reminder.'),
        });
      }
    } catch {
      setNotice({ id: c.customerId, ok: false, text: ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.' });
    } finally {
      setBusy(null);
    }
  };

  const rows = data ? data.customers.filter(
        (c) => !filter || (filter === 'OPENING' ? Number(c.openingBalance) > 0 : c.orders.some((o) => o.bucket === filter))
      ) : [];
  const bucketLabel = (k: BucketKey) =>
    k === 'OPENING' ? (ta ? 'முந்தைய நிலுவை' : 'Before Friendly CRM') : ta ? `${k} நாள்` : `${k} days`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-[#243B40]">{ta ? 'யார் எனக்கு பணம் தர வேண்டும்?' : 'Who owes me'}</h1>
          <p className="text-xs text-slate-500">
            {ta ? 'ஆர்டர் தேதியிலிருந்து கணக்கிடப்பட்ட நிலுவைகள்.' : 'Open balances, aged from the order date.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setLang(ta ? 'en' : 'ta')} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
            {ta ? 'EN' : 'தமிழ்'}
          </button>
          <button type="button" onClick={load} aria-label={ta ? 'புதுப்பி' : 'Refresh'} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">
          {error}
        </div>
      )}
      {!error && loading && !data && (
        <div className="rounded-2xl bg-white p-10 text-center text-sm font-semibold text-slate-400">{ta ? 'ஏற்றுகிறது…' : 'Loading…'}</div>
      )}

      {data && (
        <>
          <div className="rounded-2xl bg-[#243B40] p-5 text-white">
            <div className="text-xs font-semibold uppercase tracking-wider text-white/60">{ta ? 'மொத்த நிலுவை' : 'Total outstanding'}</div>
            <div className="text-3xl font-extrabold">{rupees(data.totalDue)}</div>
            <div className="text-xs text-white/60">
              {ta ? `${data.customerCount} வாடிக்கையாளர்கள்` : `across ${data.customerCount} customer${data.customerCount === 1 ? '' : 's'}`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label={ta ? 'வயது வாரியாக' : 'Filter by age'}>
            {data.buckets.map((b) => (
              <button
                key={b.key}
                type="button"
                aria-pressed={filter === b.key}
                onClick={() => setFilter(filter === b.key ? null : b.key)}
                className={`rounded-xl border p-3 text-left ${BUCKET_STYLE[b.key]} ${filter === b.key ? 'ring-2 ring-[#167D79]' : ''}`}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider">{bucketLabel(b.key)}</div>
                <div className="text-base font-extrabold">{rupees(b.amount)}</div>
                <div className="text-[10px] opacity-70">{b.orderCount} {ta ? 'ஆர்டர்' : b.orderCount === 1 ? 'order' : 'orders'}</div>
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
              {data.customerCount === 0
                ? ta ? 'நிலுவை எதுவும் இல்லை. 🎉' : 'Nobody owes you anything right now.'
                : ta ? 'இந்த வயது வரம்பில் யாரும் இல்லை.' : 'No one in this age range.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {rows.map((c) => {
                const expanded = open === c.customerId;
                const cooling = c.lastReminderAt !== null && Date.now() - new Date(c.lastReminderAt).getTime() < COOLDOWN_MS;
                return (
                  <li key={c.customerId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={`/customers/${c.customerId}`} className="block truncate text-sm font-bold text-[#243B40] hover:underline">
                          {c.name}
                        </Link>
                        {c.companyName && <div className="truncate text-xs text-slate-400">{c.companyName}</div>}
                        <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${BUCKET_STYLE[c.bucket]}`}>
                          {c.orders.length === 0 ? bucketLabel('OPENING') : ta ? `${c.oldestAgeDays} நாள்` : `oldest ${c.oldestAgeDays}d`}
                        </span>
                      </div>
                      <div className="text-right text-lg font-extrabold text-[#243B40]">{rupees(c.totalDue)}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                      {canRemind && (
                        <button
                          type="button"
                          disabled={busy === c.customerId || cooling || !c.phone}
                          onClick={() => remind(c)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#167D79] px-3 py-1.5 text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {busy === c.customerId ? (ta ? 'அனுப்புகிறது…' : 'Sending…') : ta ? 'நினைவூட்டு' : 'Send reminder'}
                        </button>
                      )}
                      {c.phone && (
                        <>
                          <a href={waLink(c.phone)} target="_blank" rel="noopener noreferrer" className="text-[#167D79] hover:underline">WhatsApp</a>
                          <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-[#167D79] hover:underline">
                            <Phone className="w-3 h-3" />
                            {ta ? 'அழை' : 'Call'}
                          </a>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : c.customerId)}
                        aria-expanded={expanded}
                        className="ml-auto inline-flex items-center gap-1 text-slate-500"
                      >
                        {c.orders.length} {ta ? 'ஆர்டர்' : c.orders.length === 1 ? 'order' : 'orders'}
                        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    {c.lastReminderAt && (
                      <div className="text-[11px] text-slate-400">
                        {ta ? 'கடைசி நினைவூட்டல்' : 'Last reminded'} {ago(c.lastReminderAt)}
                      </div>
                    )}
                    {notice?.id === c.customerId && (
                      <div role="status" className={`rounded-lg px-3 py-2 text-xs font-semibold ${notice.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                        {notice.text}
                      </div>
                    )}

                    {expanded && (
                      <ul className="divide-y divide-slate-100 rounded-xl bg-slate-50 text-xs">
                        {Number(c.openingBalance) > 0 && (
                          <li className="space-y-2 px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-bold text-violet-800">
                                {ta ? 'முந்தைய நிலுவை' : 'Previous balance (before Friendly CRM)'}
                              </span>
                              <span className="font-semibold text-slate-700">{rupees(c.openingBalance)}</span>
                            </div>
                            {canRecord && (
                              <OpeningPaymentForm
                                customerId={c.customerId}
                                owed={c.openingBalance}
                                ta={ta}
                                onDone={(msg) => {
                                  setNotice({ id: c.customerId, ok: true, text: msg });
                                  load();
                                }}
                              />
                            )}
                          </li>
                        )}
                        {c.orders.map((o) => (
                          <li key={o.orderId} className="flex items-center justify-between gap-3 px-3 py-2">
                            <Link href={`/orders/${o.orderId}`} className="font-bold text-[#167D79] hover:underline">{o.orderNumber}</Link>
                            <span className="text-slate-400">{o.ageDays}d</span>
                            <span className="font-semibold text-slate-700">{rupees(o.balanceDue)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Records money received against a customer's old (pre-Friendly CRM) balance. */
function OpeningPaymentForm({ customerId, owed, ta, onDone }: { customerId: string; owed: string; ta: boolean; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('UPI');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt, so a double click cannot record the payment twice.
  const [key, setKey] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-violet-300 bg-white px-3 py-1 text-[11px] font-bold text-violet-800">
        {ta ? 'பணம் பெற்றதைப் பதி' : 'Record payment received'}
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/receivables/customers/${customerId}/payments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ amount: Number(amount), mode, referenceNo: ref || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setKey(String(Date.now()));
        setOpen(false);
        setAmount('');
        setRef('');
        onDone(ta ? `ரசீது ${body.receiptNumber} அனுப்பப்பட்டது.` : `Recorded. Receipt ${body.receiptNumber} sent to the customer.`);
      } else {
        setError(Array.isArray(body.message) ? body.message.join(' ') : body.message || `Could not record the payment (${res.status}).`);
      }
    } catch {
      setError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs';
  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg bg-white p-2">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Amount" className={`${field} w-28`} inputMode="decimal" placeholder={ta ? 'தொகை' : 'Amount'} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="button" onClick={() => setAmount(owed)} className="text-[11px] font-bold text-violet-800 underline">{ta ? 'முழுவதும்' : 'Full'} {rupees(owed)}</button>
        <select aria-label="Mode" className={field} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="UPI">UPI</option>
          <option value="CASH">Cash</option>
          <option value="BANK_TRANSFER">Bank transfer</option>
          <option value="CHEQUE">Cheque</option>
        </select>
        <input aria-label="Reference" className={`${field} w-32`} placeholder={ta ? 'UTR / எண் (விருப்பம்)' : 'UTR / ref (optional)'} value={ref} onChange={(e) => setRef(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-[11px] font-semibold text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !amount} className="rounded-lg bg-violet-700 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50">{busy ? '…' : ta ? 'பதி' : 'Record'}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1 text-[11px] font-bold text-slate-600">{ta ? 'ரத்து' : 'Cancel'}</button>
      </div>
    </form>
  );
}
