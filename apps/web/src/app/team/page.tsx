'use client';
import { useLocale } from '../../components/shared/LocaleProvider';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserPlus, Phone } from 'lucide-react';
import { hasPermission } from '@friendly-crm/shared';
import { useAuth } from '../../components/auth/AuthProvider';
import { apiFetch } from '../../lib/session';

type Role = 'OWNER' | 'MANAGER' | 'SALESPERSON' | 'ACCOUNTS' | 'PRODUCTION' | 'READ_ONLY';
const ASSIGNABLE: Exclude<Role, 'OWNER'>[] = ['MANAGER', 'SALESPERSON', 'ACCOUNTS', 'PRODUCTION', 'READ_ONLY'];

interface Member {
  userId: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: Role;
  isActive: boolean;
}

const ROLE_TEXT: Record<Role, { en: string; ta: string; helpEn: string; helpTa: string }> = {
  OWNER: { en: 'Owner', ta: 'உரிமையாளர்', helpEn: 'Everything, including settings and team.', helpTa: 'அமைப்புகள் மற்றும் குழு உட்பட அனைத்தும்.' },
  MANAGER: { en: 'Manager', ta: 'மேலாளர்', helpEn: 'Supervises the team; sees all leads, quotes, orders and reports.', helpTa: 'குழுவை கண்காணிப்பார்; அனைத்து விசாரணைகள், மேற்கோள்கள், ஆர்டர்கள், அறிக்கைகளை பார்ப்பார்.' },
  SALESPERSON: { en: 'Salesperson', ta: 'விற்பனையாளர்', helpEn: 'Own leads, customers, quotes and follow-ups.', helpTa: 'தனக்கு ஒதுக்கப்பட்ட விசாரணைகள், வாடிக்கையாளர்கள், மேற்கோள்கள், பின்தொடர்தல்.' },
  ACCOUNTS: { en: 'Accounts', ta: 'கணக்கு', helpEn: 'Invoices, payments and dues.', helpTa: 'விலைப்பட்டியல், பணம், நிலுவை.' },
  PRODUCTION: { en: 'Production', ta: 'உற்பத்தி', helpEn: 'Assigned orders and stage updates.', helpTa: 'ஒதுக்கப்பட்ட ஆர்டர்கள் மற்றும் நிலை புதுப்பிப்பு.' },
  READ_ONLY: { en: 'Read-only', ta: 'பார்வை மட்டும்', helpEn: 'Can look, cannot change anything.', helpTa: 'பார்க்கலாம், மாற்ற முடியாது.' },
};

export default function TeamPage() {
  const { active, user } = useAuth();
  const tenantId = active!.tenantId;
  const allowed = hasPermission(active!.role, 'settings:manage');
  const [lang, setLang] = useLocale();
  const ta = lang === 'ta';

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ fullName: '', phone: '', role: 'SALESPERSON' as Exclude<Role, 'OWNER'> });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/team');
      if (res.ok) setMembers((await res.json()).data ?? []);
      else setError(`Could not load the team (${res.status}).`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    load();
  }, [tenantId, load]);

  const patch = async (m: Member, body: { role?: Role; isActive?: boolean }) => {
    setBusy(m.userId);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/team/${m.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const next = await res.json();
        setMembers((prev) => prev.map((x) => (x.userId === m.userId ? { ...x, role: next.role, isActive: next.isActive } : x)));
      } else {
        const b = await res.json().catch(() => ({}));
        setNotice({ id: m.userId, text: b.message || (ta ? 'மாற்ற முடியவில்லை.' : 'Could not save the change.') });
      }
    } catch {
      setNotice({ id: m.userId, text: ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.' });
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy('new');
    try {
      const res = await apiFetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ fullName: '', phone: '', role: 'SALESPERSON' });
        setAdding(false);
        await load();
      } else {
        const b = await res.json().catch(() => ({}));
        setFormError(Array.isArray(b.message) ? b.message.join(', ') : b.message || (ta ? 'சேர்க்க முடியவில்லை.' : 'Could not add this person.'));
      }
    } catch {
      setFormError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) {
    return (
      <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">
        {ta ? 'குழுவை உரிமையாளர் மட்டுமே நிர்வகிக்கலாம்.' : 'Only the owner can manage the team.'}
      </div>
    );
  }

  const roleName = (r: Role) => (ta ? ROLE_TEXT[r].ta : ROLE_TEXT[r].en);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-foreground">{ta ? 'குழு' : 'Team'}</h1>
          <p className="text-xs text-slate-500">{ta ? 'யார் எதைப் பார்க்கலாம் என்பதை தேர்வு செய்யுங்கள்.' : 'Choose who can see and do what.'}</p>
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

      {!adding ? (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-action px-4 text-sm font-bold text-on-action">
          <UserPlus className="w-4 h-4" /> {ta ? 'ஊழியரை சேர்' : 'Add staff'}
        </button>
      ) : (
        <form onSubmit={add} className="space-y-3 rounded-2xl border border-slate-200 bg-surface p-4" noValidate>
          <div>
            <label htmlFor="t-name" className="mb-1 block text-xs font-bold">{ta ? 'பெயர்' : 'Name'}</label>
            <input id="t-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoComplete="off"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-surface px-3 text-sm outline-none focus:border-brand-ink focus:ring-2 focus:ring-[#02937B]/20" />
          </div>
          <div>
            <label htmlFor="t-phone" className="mb-1 block text-xs font-bold">{ta ? 'மொபைல் எண் (OTP உள்நுழைவு)' : 'Mobile number (they sign in with an OTP)'}</label>
            <input id="t-phone" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^\d+ ]/g, '') })} autoComplete="off"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-surface px-3 text-sm outline-none focus:border-brand-ink focus:ring-2 focus:ring-[#02937B]/20" />
          </div>
          <div>
            <label htmlFor="t-role" className="mb-1 block text-xs font-bold">{ta ? 'பங்கு' : 'Role'}</label>
            <select id="t-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Exclude<Role, 'OWNER'> })}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-surface px-3 text-sm font-semibold">
              {ASSIGNABLE.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-600">{ta ? ROLE_TEXT[form.role].helpTa : ROLE_TEXT[form.role].helpEn}</p>
          </div>
          {formError && <p role="alert" className="text-xs font-semibold text-red-700">{formError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy === 'new'} className="min-h-[44px] flex-1 rounded-xl bg-action text-sm font-bold text-on-action disabled:opacity-60">
              {busy === 'new' ? (ta ? 'சேர்க்கிறது…' : 'Adding…') : ta ? 'சேர்' : 'Add'}
            </button>
            <button type="button" onClick={() => { setAdding(false); setFormError(null); }} className="min-h-[44px] rounded-xl border border-slate-300 px-4 text-sm font-semibold">
              {ta ? 'ரத்து' : 'Cancel'}
            </button>
          </div>
        </form>
      )}

      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-700">{error}</div>}
      {!error && loading && members.length === 0 && <p className="text-sm text-slate-600">{ta ? 'ஏற்றுகிறது…' : 'Loading…'}</p>}

      <ul className="space-y-3">
        {members.map((m) => {
          const isOwner = m.role === 'OWNER';
          const isMe = m.userId === user?.id;
          const locked = isOwner || isMe;
          return (
            <li key={m.userId} className={`rounded-2xl border border-slate-200 bg-surface p-4 ${m.isActive ? '' : 'opacity-70'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-bold text-foreground">
                    {m.fullName} {isMe && <span className="text-xs font-semibold text-slate-500">({ta ? 'நீங்கள்' : 'you'})</span>}
                  </div>
                  <a href={`tel:${m.phone}`} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:underline"><Phone className="w-3 h-3" />{m.phone}</a>
                </div>
                {!m.isActive && <span className="shrink-0 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">{ta ? 'முடக்கம்' : 'Access off'}</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {locked ? (
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold">{roleName(m.role)}</span>
                ) : (
                  <select aria-label={ta ? 'பங்கு' : 'Role'} value={m.role} disabled={busy === m.userId} onChange={(e) => patch(m, { role: e.target.value as Role })}
                    className="min-h-[40px] rounded-lg border border-slate-300 bg-surface px-2 text-xs font-bold">
                    {ASSIGNABLE.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                  </select>
                )}
                {!locked && (
                  <button type="button" disabled={busy === m.userId} onClick={() => patch(m, { isActive: !m.isActive })}
                    className="ml-auto min-h-[40px] rounded-lg border border-slate-300 px-3 text-xs font-bold disabled:opacity-60">
                    {m.isActive ? (ta ? 'அணுகலை நிறுத்து' : 'Turn off access') : ta ? 'அணுகலை இயக்கு' : 'Turn on access'}
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-600">{ta ? ROLE_TEXT[m.role].helpTa : ROLE_TEXT[m.role].helpEn}</p>
              {notice?.id === m.userId && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{notice.text}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
