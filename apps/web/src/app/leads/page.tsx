'use client';
import { useLocale } from '../../components/shared/LocaleProvider';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Search, Phone, MessageCircle } from 'lucide-react';
import { hasPermission } from '@friendly-crm/shared';
import { useAuth } from '../../components/auth/AuthProvider';
import { apiFetch } from '../../lib/session';

interface Stage {
  key: string;
  name: string;
  labels: { en: string; ta: string };
  color: string;
}

interface Lead {
  id: string;
  title: string;
  source: string;
  stage: string;
  priority: string;
  estimatedValue: string | null;
  notes: string | null;
  createdAt: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerCompanyName: string | null;
  whatsappNumber: string | null;
}

const rupees = (v: string) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;
const PRIORITY_STYLE: Record<string, string> = {
  HIGH: 'bg-rose-50 text-rose-800 border-rose-200',
  MEDIUM: 'bg-amber-50 text-amber-800 border-amber-200',
  LOW: 'bg-slate-50 text-slate-700 border-slate-200',
};

export default function LeadsPage() {
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const canUpdate = hasPermission(active!.role, 'lead:update');
  const [lang, setLang] = useLocale();
  const ta = lang === 'ta';

  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/workflow/pipelines');
        if (res.ok) {
          const pipes: Array<{ targetEntity: string; stages: Stage[] }> = await res.json();
          setStages(pipes.find((p) => p.targetEntity === 'LEAD')?.stages ?? []);
        }
      } catch {
        /* stage chips are optional; the list still loads */
      }
    })();
  }, [tenantId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (stage) params.set('stage', stage);
      if (query) params.set('search', query);
      const res = await apiFetch(`/api/crm/leads?${params}`);
      if (res.ok) {
        const body = await res.json();
        setLeads(body.data ?? []);
        setTotal(body.total ?? 0);
      } else {
        setLeads([]);
        setError(res.status === 403 ? 'Your role cannot view leads.' : `Could not load leads (${res.status}).`);
      }
    } catch {
      setLeads([]);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [stage, query]);

  useEffect(() => {
    load();
  }, [tenantId, load]);

  const stageLabel = (key: string) => {
    const s = stages.find((x) => x.key.toUpperCase() === key.toUpperCase());
    return s ? (ta ? s.labels.ta : s.labels.en) : key.replace(/_/g, ' ');
  };

  const moveTo = async (lead: Lead, target: string) => {
    if (target === lead.stage) return;
    setBusy(lead.id);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/crm/leads/${lead.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: target }),
      });
      if (res.ok) {
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, stage: target } : l)));
      } else {
        const body = await res.json().catch(() => ({}));
        setNotice({ id: lead.id, text: body.message || (ta ? 'நிலையை மாற்ற முடியவில்லை.' : 'Could not change the stage.') });
      }
    } catch {
      setNotice({ id: lead.id, text: ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-foreground">{ta ? 'விசாரணைகள்' : 'Leads'}</h1>
          <p className="text-xs text-slate-500">
            {ta ? `${total} விசாரணைகள்` : `${total} lead${total === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setLang(ta ? 'en' : 'ta')} className="rounded-lg border border-slate-200 bg-surface px-2.5 py-1 text-xs font-bold text-slate-600">
            {ta ? 'EN' : 'தமிழ்'}
          </button>
          <button type="button" onClick={load} aria-label={ta ? 'புதுப்பி' : 'Refresh'} className="rounded-lg border border-slate-200 bg-surface p-1.5 text-slate-600">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" aria-hidden="true" />
        <input
          type="search"
          aria-label={ta ? 'பெயர், எண் அல்லது தலைப்பு மூலம் தேடு' : 'Search leads by customer, phone or title'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={ta ? 'தேடு…' : 'Search…'}
          className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-surface pl-10 pr-3 text-sm outline-none focus:border-brand-ink focus:ring-2 focus:ring-[#02937B]/20"
        />
      </div>

      {stages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={ta ? 'நிலை வாரியாக' : 'Filter by stage'}>
          <button
            type="button"
            aria-pressed={stage === null}
            onClick={() => setStage(null)}
            className={`shrink-0 min-h-[36px] rounded-full border px-3 text-xs font-bold ${stage === null ? 'bg-action text-on-action border-transparent' : 'border-slate-200 bg-surface text-slate-700'}`}
          >
            {ta ? 'அனைத்தும்' : 'All'}
          </button>
          {stages.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={stage === s.key}
              onClick={() => setStage(stage === s.key ? null : s.key)}
              className={`shrink-0 min-h-[36px] rounded-full border px-3 text-xs font-bold ${stage === s.key ? 'bg-action text-on-action border-transparent' : 'border-slate-200 bg-surface text-slate-700'}`}
            >
              {ta ? s.labels.ta : s.labels.en}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">
          {error}
        </div>
      )}
      {!error && loading && leads.length === 0 && (
        <div className="rounded-2xl bg-surface p-10 text-center text-sm font-semibold text-slate-600">{ta ? 'ஏற்றுகிறது…' : 'Loading…'}</div>
      )}
      {!error && !loading && leads.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-surface p-8 text-center text-sm text-slate-600">
          {stage || query
            ? ta ? 'பொருந்தும் விசாரணைகள் இல்லை.' : 'No leads match this filter.'
            : ta ? 'இன்னும் விசாரணைகள் இல்லை. Quick Add மூலம் சேர்க்கலாம்.' : 'No leads yet. Add one with Quick Add.'}
        </p>
      )}

      <ul className="space-y-3">
        {leads.map((l) => (
          <li key={l.id} className="rounded-2xl border border-slate-200 bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/customers/${l.customerId}`} className="block truncate font-bold text-foreground hover:underline">
                  {l.customerName}
                </Link>
                {l.customerCompanyName && <div className="truncate text-xs text-slate-600">{l.customerCompanyName}</div>}
                <div className="mt-1 text-sm text-slate-700">{l.title}</div>
              </div>
              <div className="shrink-0 text-right">
                {l.estimatedValue && Number(l.estimatedValue) > 0 && <div className="font-extrabold">{rupees(l.estimatedValue)}</div>}
                <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${PRIORITY_STYLE[l.priority] ?? PRIORITY_STYLE.LOW}`}>
                  {l.priority}
                </span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {canUpdate && stages.length > 0 ? (
                <select
                  aria-label={ta ? 'நிலை' : 'Stage'}
                  value={l.stage}
                  disabled={busy === l.id}
                  onChange={(e) => moveTo(l, e.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-300 bg-surface px-2 text-xs font-bold"
                >
                  {!stages.some((s) => s.key.toUpperCase() === l.stage.toUpperCase()) && <option value={l.stage}>{stageLabel(l.stage)}</option>}
                  {stages.map((s) => (
                    <option key={s.key} value={s.key}>
                      {ta ? s.labels.ta : s.labels.en}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold">{stageLabel(l.stage)}</span>
              )}
              <span className="text-xs text-slate-600">{l.source.replace(/_/g, ' ')}</span>
              <div className="ml-auto flex gap-2">
                <a href={`tel:${l.customerPhone}`} aria-label={ta ? 'அழை' : 'Call'} className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-700">
                  <Phone className="w-4 h-4" />
                </a>
                <a href={waLink(l.whatsappNumber || l.customerPhone)} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-slate-700">
                  <MessageCircle className="w-4 h-4" />
                </a>
              </div>
            </div>
            {notice?.id === l.id && (
              <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
                {notice.text}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
