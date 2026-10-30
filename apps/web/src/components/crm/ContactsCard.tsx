'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Phone, Plus, Trash2, Pencil, MessageCircle } from 'lucide-react';
import { hasPermission, validateContact, TenantRole } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';

interface Contact {
  id: string;
  name: string;
  designation: string | null;
  phone: string;
  email: string | null;
}

const EMPTY = { name: '', phone: '', designation: '', email: '' };

/**
 * The people who deal with us for this customer (owner, accounts, purchase...). The customer's own number stays its main
 * contact; one mobile number belongs to exactly one customer, which the server enforces.
 */
export function ContactsCard({ customerId, role, lang = 'en' }: { customerId: string; role: TenantRole; lang?: 'en' | 'ta' }) {
  const ta = lang === 'ta';
  const canAdd = hasPermission(role, 'customer:create');
  const canEdit = hasPermission(role, 'customer:update');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [form, setForm] = useState<{ id: string | null; values: typeof EMPTY } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [waNumber, setWaNumber] = useState<string | null>(null);
  const [mainPhone, setMainPhone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/crm/customers/${customerId}/contacts`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { data: Contact[]; whatsappNumber?: string; phone?: string };
      setContacts(body.data);
      setWaNumber(body.whatsappNumber ?? null);
      setMainPhone(body.phone ?? null);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const check = validateContact(form.values);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const res = await apiFetch(`/api/crm/customers/${customerId}/contacts${form.id ? `/${form.id}` : ''}`, {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form.values),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setForm(null);
        await load();
        return;
      }
      setErrors(body.errors ?? [Array.isArray(body.message) ? body.message.join(' ') : body.message || `Could not save the contact (${res.status}).`]);
    } catch {
      setErrors([ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server. Check your connection and try again.']);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Contact) => {
    if (!window.confirm(ta ? `${c.name} நீக்கவா?` : `Remove ${c.name}?`)) return;
    const res = await apiFetch(`/api/crm/customers/${customerId}/contacts/${c.id}`, { method: 'DELETE' });
    if (res.ok) await load();
    else setErrors([ta ? 'நீக்க முடியவில்லை.' : 'Could not remove the contact.']);
  };

  const useForWhatsApp = async (c: Contact) => {
    const ok = window.confirm(
      ta
        ? `இனி WhatsApp செய்திகள் ${c.phone} (${c.name}) எண்ணுக்குச் செல்லும். தொடரவா?`
        : `WhatsApp messages will go to ${c.phone} (${c.name}). Continue?`
    );
    if (!ok) return;
    const res = await apiFetch(`/api/crm/customers/${customerId}/contacts/${c.id}/use-for-whatsapp`, { method: 'POST' });
    if (res.ok) {
      setErrors([]);
      await load();
    } else {
      const body = await res.json().catch(() => ({}));
      setErrors([Array.isArray(body.message) ? body.message.join(' ') : body.message || (ta ? 'மாற்ற முடியவில்லை.' : 'Could not change the WhatsApp number.')]);
    }
  };

  const useMainForWhatsApp = async () => {
    if (!mainPhone) return;
    const ok = window.confirm(
      ta
        ? `இனி WhatsApp செய்திகள் முக்கிய எண் ${mainPhone}-க்குச் செல்லும். தற்போதைய WhatsApp எண் நபர் பட்டியலில் இருக்கும். தொடரவா?`
        : `WhatsApp messages will go to the main number ${mainPhone} again. The current WhatsApp number stays in the people list. Continue?`
    );
    if (!ok) return;
    const res = await apiFetch(`/api/crm/customers/${customerId}/whatsapp/use-main`, { method: 'POST' });
    if (res.ok) {
      setErrors([]);
      await load();
    } else {
      const body = await res.json().catch(() => ({}));
      setErrors([Array.isArray(body.message) ? body.message.join(' ') : body.message || (ta ? 'மாற்ற முடியவில்லை.' : 'Could not change the WhatsApp number.')]);
    }
  };

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';
  const title = ta ? 'இந்த வணிகத்தின் நபர்கள்' : 'People at this business';

  return (
    <section className="space-y-2 rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm" aria-label={title}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {canAdd && !form && (
          <button type="button" onClick={() => { setErrors([]); setForm({ id: null, values: EMPTY }); }} className="inline-flex items-center gap-1 text-xs font-bold text-brand-ink">
            <Plus className="h-3.5 w-3.5" /> {ta ? 'நபரைச் சேர்' : 'Add person'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-600">
        {ta
          ? 'வாடிக்கையாளரின் முக்கிய எண்ணுக்கே நினைவூட்டல்கள் மற்றும் விலைப்புள்ளிகள் செல்லும். ஒரு மொபைல் எண் ஒரு வாடிக்கையாளருக்கு மட்டுமே.'
          : 'Reminders and quotes go to the customer’s main number. One mobile number belongs to one customer only.'}
      </p>

      {waNumber && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
          <MessageCircle className="h-3.5 w-3.5" /> {ta ? 'WhatsApp செய்திகள் செல்லும் எண்:' : 'WhatsApp messages go to:'} {waNumber}
          {canEdit && mainPhone && waNumber !== mainPhone && (
            <button type="button" onClick={useMainForWhatsApp} className="ml-2 rounded-lg border border-emerald-300 px-2 py-1 text-[11px] font-bold text-emerald-800">
              {ta ? `முக்கிய எண்ணுக்கு (${mainPhone}) மாற்று` : `Use main number (${mainPhone})`}
            </button>
          )}
        </p>
      )}
      {loadError && <p role="alert" className="text-xs font-semibold text-red-700">{ta ? 'நபர்களை ஏற்ற முடியவில்லை.' : 'Could not load the contacts.'}</p>}
      {contacts === null && !loadError && <p className="text-xs text-slate-600">{ta ? 'ஏற்றப்படுகிறது…' : 'Loading…'}</p>}
      {contacts && contacts.length === 0 && !form && (
        <p className="text-xs text-slate-600">{ta ? 'இன்னும் யாரும் சேர்க்கப்படவில்லை.' : 'No one added yet.'}</p>
      )}

      {contacts && contacts.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 text-xs">
                <span className="font-semibold text-foreground">{c.name}</span>
                {c.designation && <span className="ml-1.5 text-slate-600">· {c.designation}</span>}
                {waNumber === c.phone && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                    <MessageCircle className="h-2.5 w-2.5" /> WhatsApp
                  </span>
                )}
                <span className="block text-slate-600">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <a href={`tel:${c.phone}`} aria-label={ta ? `${c.name} அழை` : `Call ${c.name}`} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                  <Phone className="h-4 w-4" />
                </a>
                {canEdit && (
                  <>
                    {waNumber !== c.phone && (
                      <button type="button" aria-label={ta ? `${c.name} எண்ணை WhatsApp-க்குப் பயன்படுத்து` : `Use ${c.name}'s number for WhatsApp`} title={ta ? 'WhatsApp-க்குப் பயன்படுத்து' : 'Use for WhatsApp'} onClick={() => useForWhatsApp(c)} className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-50">
                        <MessageCircle className="h-4 w-4" />
                      </button>
                    )}
                    <button type="button" aria-label={ta ? `${c.name} திருத்து` : `Edit ${c.name}`} onClick={() => { setErrors([]); setForm({ id: c.id, values: { name: c.name, phone: c.phone, designation: c.designation ?? '', email: c.email ?? '' } }); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={ta ? `${c.name} நீக்கு` : `Remove ${c.name}`} onClick={() => remove(c)} className="rounded-lg p-2 text-slate-600 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <form onSubmit={save} className="space-y-3 rounded-xl bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ct-name" className={label}>{ta ? 'பெயர் *' : 'Name *'}</label>
              <input id="ct-name" className={input} value={form.values.name} maxLength={160} autoFocus onChange={(e) => setForm({ ...form, values: { ...form.values, name: e.target.value } })} />
            </div>
            <div>
              <label htmlFor="ct-phone" className={label}>{ta ? 'மொபைல் *' : 'Mobile *'}</label>
              <input id="ct-phone" className={input} value={form.values.phone} inputMode="tel" placeholder="98400 11111" onChange={(e) => setForm({ ...form, values: { ...form.values, phone: e.target.value } })} />
            </div>
            <div>
              <label htmlFor="ct-role" className={label}>{ta ? 'பொறுப்பு' : 'Role'}</label>
              <input id="ct-role" className={input} value={form.values.designation} maxLength={80} placeholder={ta ? 'எ.கா. கணக்காளர், உரிமையாளர்' : 'e.g. Accounts, Owner, Purchase'} onChange={(e) => setForm({ ...form, values: { ...form.values, designation: e.target.value } })} />
            </div>
            <div>
              <label htmlFor="ct-email" className={label}>Email</label>
              <input id="ct-email" className={input} type="email" value={form.values.email} onChange={(e) => setForm({ ...form, values: { ...form.values, email: e.target.value } })} />
            </div>
          </div>
          {errors.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">
              {errors.map((m) => (
                <li key={m}>• {m}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-action px-4 py-2 text-sm font-bold text-on-action disabled:opacity-50">
              {busy ? (ta ? 'சேமிக்கிறது…' : 'Saving…') : ta ? 'சேமி' : 'Save'}
            </button>
            <button type="button" onClick={() => setForm(null)} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">
              {ta ? 'ரத்து' : 'Cancel'}
            </button>
          </div>
        </form>
      )}
      {!form && errors.length > 0 && <p role="alert" className="text-xs font-semibold text-red-700">{errors[0]}</p>}
    </section>
  );
}
