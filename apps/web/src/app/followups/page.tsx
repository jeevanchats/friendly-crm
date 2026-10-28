'use client';
import { useLocale } from '../../components/shared/LocaleProvider';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Check, Phone, MessageCircle } from 'lucide-react';
import { hasPermission } from '@friendly-crm/shared';
import { useAuth } from '../../components/auth/AuthProvider';
import { apiFetch } from '../../lib/session';

interface Task {
  id: string;
  title: string;
  type: string;
  dueAt: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  outcomeNote: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

const TYPE_LABEL: Record<string, { en: string; ta: string }> = {
  FOLLOW_UP_CALL: { en: 'Call', ta: 'அழைப்பு' },
  WHATSAPP: { en: 'WhatsApp', ta: 'வாட்ஸ்அப்' },
  SEND_QUOTE: { en: 'Send quote', ta: 'மேற்கோள் அனுப்பு' },
  PAYMENT_REMINDER: { en: 'Payment reminder', ta: 'பணம் நினைவூட்டல்' },
  SITE_VISIT: { en: 'Site visit', ta: 'இடத்தை பார்வையிடு' },
};

export default function FollowUpsPage() {
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const canComplete = hasPermission(active!.role, 'task:complete');
  const [lang, setLang] = useLocale();
  const ta = lang === 'ta';

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [completing, setCompleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const from = new Date(month.getFullYear(), month.getMonth(), 1);
      const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      const res = await apiFetch(`/api/crm/tasks?from=${from.toISOString()}&to=${to.toISOString()}`);
      if (res.ok) {
        setTasks((await res.json()).data ?? []);
      } else {
        setTasks([]);
        setError(res.status === 403 ? 'Your role cannot view follow-ups.' : `Could not load follow-ups (${res.status}).`);
      }
    } catch {
      setTasks([]);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [tenantId, load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = dayKey(new Date(t.dueAt));
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [tasks]);

  const todayKey = dayKey(new Date());
  const leading = month.getDay(); // blank cells before the 1st (Sunday first)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(leading).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const dayTasks = byDay.get(selected) ?? [];
  const monthLabel = month.toLocaleDateString(ta ? 'ta-IN' : 'en-IN', { month: 'long', year: 'numeric' });
  const weekdays = ta ? ['ஞா', 'தி', 'செ', 'பு', 'வி', 'வெ', 'ச'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const complete = async (t: Task) => {
    setBusy(t.id);
    try {
      const res = await apiFetch(`/api/crm/tasks/${t.id}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcomeNote: note.trim() || undefined }),
      });
      if (res.ok) {
        setCompleting(null);
        setNote('');
        await load();
      } else {
        setError(ta ? 'முடிக்க முடியவில்லை.' : 'Could not mark this follow-up done.');
      }
    } catch {
      setError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-foreground">{ta ? 'பின்தொடர்தல்' : 'Follow-ups'}</h1>
        <button type="button" onClick={() => setLang(ta ? 'en' : 'ta')} className="rounded-lg border border-slate-200 bg-surface px-2.5 py-1 text-xs font-bold text-slate-600">
          {ta ? 'EN' : 'தமிழ்'}
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" aria-label={ta ? 'முந்தைய மாதம்' : 'Previous month'} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="font-bold" aria-live="polite">{monthLabel}</div>
          <button type="button" aria-label={ta ? 'அடுத்த மாதம்' : 'Next month'} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-bold text-slate-600" aria-hidden="true">
          {weekdays.map((w, i) => <div key={i} className="py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((n, i) => {
            if (n === null) return <div key={`b${i}`} />;
            const k = dayKey(new Date(month.getFullYear(), month.getMonth(), n));
            const list = byDay.get(k) ?? [];
            const pending = list.filter((t) => t.status === 'PENDING').length;
            const overdue = k < todayKey && pending > 0;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSelected(k)}
                aria-pressed={selected === k}
                aria-label={`${n} ${monthLabel}, ${pending} ${ta ? 'நிலுவை' : 'pending'}`}
                className={`relative min-h-[48px] rounded-lg border text-sm font-semibold ${selected === k ? 'border-brand-ink bg-accent-soft' : 'border-transparent hover:bg-slate-50'} ${k === todayKey ? 'ring-1 ring-[#02937B]' : ''}`}
              >
                {n}
                {list.length > 0 && (
                  <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 rounded-full px-1.5 text-[10px] font-bold ${overdue ? 'bg-rose-100 text-rose-800' : pending > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {list.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-700">{error}</div>
      )}

      <section aria-label={ta ? 'தேர்ந்த நாளின் பணிகள்' : 'Follow-ups for the selected day'} className="space-y-3">
        <h2 className="text-sm font-bold text-slate-700">
          {new Date(`${selected}T00:00:00`).toLocaleDateString(ta ? 'ta-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h2>
        {loading && tasks.length === 0 && <p className="text-sm text-slate-600">{ta ? 'ஏற்றுகிறது…' : 'Loading…'}</p>}
        {!loading && !error && dayTasks.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-surface p-6 text-center text-sm text-slate-600">
            {ta ? 'இந்த நாளில் பின்தொடர்தல் இல்லை.' : 'Nothing scheduled for this day.'}
          </p>
        )}
        <ul className="space-y-3">
          {dayTasks.map((t) => {
            const overdue = t.status === 'PENDING' && new Date(t.dueAt) < new Date();
            return (
              <li key={t.id} className="rounded-2xl border border-slate-200 bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`font-bold ${t.status === 'COMPLETED' ? 'line-through text-slate-500' : 'text-foreground'}`}>{t.title}</div>
                    {t.customerId && (
                      <Link href={`/customers/${t.customerId}`} className="text-sm text-brand-ink hover:underline">
                        {t.customerName}
                      </Link>
                    )}
                    <div className="mt-0.5 text-xs text-slate-600">
                      {timeOf(t.dueAt)} · {(TYPE_LABEL[t.type] ?? { en: t.type, ta: t.type })[ta ? 'ta' : 'en']}
                      {overdue && <span className="ml-2 font-bold text-rose-700">{ta ? 'தாமதம்' : 'Overdue'}</span>}
                    </div>
                    {t.outcomeNote && t.status === 'COMPLETED' && <div className="mt-1 text-xs text-slate-600">{t.outcomeNote}</div>}
                  </div>
                  {t.customerPhone && (
                    <div className="flex shrink-0 gap-2">
                      <a href={`tel:${t.customerPhone}`} aria-label={ta ? 'அழை' : 'Call'} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-700"><Phone className="w-4 h-4" /></a>
                      <a href={waLink(t.customerPhone)} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-700"><MessageCircle className="w-4 h-4" /></a>
                    </div>
                  )}
                </div>
                {t.status === 'PENDING' && canComplete && (
                  completing === t.id ? (
                    <div className="mt-3 space-y-2">
                      <input
                        aria-label={ta ? 'முடிவு குறிப்பு' : 'Outcome note'}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={ta ? 'என்ன நடந்தது? (விருப்பம்)' : 'What happened? (optional)'}
                        className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-surface px-3 text-sm outline-none focus:border-brand-ink focus:ring-2 focus:ring-[#02937B]/20"
                      />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy === t.id} onClick={() => complete(t)} className="min-h-[44px] flex-1 rounded-xl bg-action text-on-action text-sm font-bold disabled:opacity-60">
                          {ta ? 'முடிந்தது' : 'Mark done'}
                        </button>
                        <button type="button" onClick={() => { setCompleting(null); setNote(''); }} className="min-h-[44px] rounded-xl border border-slate-300 px-4 text-sm font-semibold">
                          {ta ? 'ரத்து' : 'Cancel'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setCompleting(t.id)} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold">
                      <Check className="w-4 h-4" /> {ta ? 'முடிந்தது' : 'Done'}
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
