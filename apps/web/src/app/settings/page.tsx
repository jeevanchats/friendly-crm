'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { GST_STATES, hasPermission, isValidGstin, normalizeGstin, stateCodeFromGstin } from '@friendly-crm/shared';
import { useAuth } from '../../components/auth/AuthProvider';
import { apiFetch } from '../../lib/session';

interface Settings {
  customerSelfServiceEnabled: boolean;
  upiId: string | null;
  gstNumber: string | null;
  legalName: string | null;
  address: string | null;
  stateCode: string | null;
  autoRemindersEnabled: boolean;
  reminderAfterDays: number;
  reminderRepeatDays: number;
  reminderMaxCount: number;
}

export default function SettingsPage() {
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const allowed = hasPermission(active!.role, 'settings:manage');
  const [lang, setLang] = useState<'en' | 'ta'>('en');
  const ta = lang === 'ta';

  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [legalName, setLegalName] = useState('');
  const [gst, setGst] = useState('');
  const [address, setAddress] = useState('');
  const [upi, setUpi] = useState('');
  const [autoOn, setAutoOn] = useState(false);
  const [afterDays, setAfterDays] = useState('7');
  const [repeatDays, setRepeatDays] = useState('7');
  const [maxCount, setMaxCount] = useState('3');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (s: Settings) => {
    setLoaded(s);
    setLegalName(s.legalName ?? '');
    setGst(s.gstNumber ?? '');
    setAddress(s.address ?? '');
    setUpi(s.upiId ?? '');
    setAutoOn(s.autoRemindersEnabled);
    setAfterDays(String(s.reminderAfterDays));
    setRepeatDays(String(s.reminderRepeatDays));
    setMaxCount(String(s.reminderMaxCount));
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch('/api/tenant/settings');
      if (res.ok) apply(await res.json());
      else setError(`Could not load settings (${res.status}).`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    setLoaded(null);
    load();
  }, [tenantId, load]);

  const gstTrim = normalizeGstin(gst);
  const gstProblem = gstTrim !== '' && !isValidGstin(gstTrim);
  const derivedState = gstTrim !== '' && !gstProblem ? stateCodeFromGstin(gstTrim) : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const res = await apiFetch('/api/tenant/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          legalName: legalName.trim() || null,
          gstNumber: gstTrim || null,
          address: address.trim() || null,
          upiId: upi.trim() || null,
          autoRemindersEnabled: autoOn,
          reminderAfterDays: Number(afterDays),
          reminderRepeatDays: Number(repeatDays),
          reminderMaxCount: Number(maxCount),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        apply(body);
        setSaved(true);
      } else {
        setError(Array.isArray(body.message) ? body.message.join(' ') : body.message || `Could not save (${res.status}).`);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return (
      <div role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
        {ta ? 'அமைப்புகளை உரிமையாளர் மட்டுமே மாற்ற முடியும்.' : 'Only the business owner can change settings.'}
      </div>
    );
  }

  const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';

  return (
    <div className="space-y-5 max-w-xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-[#243B40]">{ta ? 'வணிக அமைப்புகள்' : 'Business settings'}</h1>
          <p className="text-xs text-slate-500">
            {ta ? 'இவை GST விலைப்பட்டியல்களிலும் பணம் செலுத்தும் இணைப்புகளிலும் அச்சாகும்.' : 'These print on GST invoices and payment links.'}
          </p>
        </div>
        <button type="button" onClick={() => setLang(ta ? 'en' : 'ta')} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
          {ta ? 'EN' : 'தமிழ்'}
        </button>
      </div>

      {!loaded && !error && <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-400">{ta ? 'ஏற்றுகிறது…' : 'Loading…'}</div>}

      {loaded && (
        <form onSubmit={save} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div>
            <label htmlFor="legalName" className={label}>{ta ? 'சட்டப்பூர்வ பெயர்' : 'Legal name'}</label>
            <input id="legalName" className={field} value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder={active!.tenantName} maxLength={200} />
            <p className="mt-1 text-[11px] text-slate-400">{ta ? 'காலியாக இருந்தால் வணிகப் பெயர் பயன்படுத்தப்படும்.' : 'Leave blank to use the business name.'}</p>
          </div>
          <div>
            <label htmlFor="gstin" className={label}>GSTIN</label>
            <input
              id="gstin"
              className={`${field} uppercase ${gstProblem ? 'border-red-400' : ''}`}
              value={gst}
              onChange={(e) => setGst(e.target.value)}
              placeholder="33AABCS1234A1Z8"
              maxLength={15}
              aria-invalid={gstProblem}
              autoComplete="off"
            />
            {gstProblem && <p className="mt-1 text-[11px] font-semibold text-red-600">{ta ? 'GSTIN சரியாக இல்லை. 15 எழுத்துகளைச் சரிபார்க்கவும்.' : 'This GSTIN is not valid. Check all 15 characters.'}</p>}
            {derivedState && <p className="mt-1 text-[11px] text-emerald-700">{ta ? 'மாநிலம்' : 'State'}: {derivedState} - {GST_STATES[derivedState]}</p>}
            {!gstTrim && <p className="mt-1 text-[11px] text-slate-400">{ta ? 'GSTIN இல்லாமல் GST விலைப்பட்டியல் வெளியிட முடியாது.' : 'GST invoices cannot be issued without a GSTIN.'}</p>}
          </div>
          <div>
            <label htmlFor="address" className={label}>{ta ? 'முகவரி' : 'Address'}</label>
            <textarea id="address" className={field} rows={3} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} />
          </div>
          <div>
            <label htmlFor="upi" className={label}>UPI ID</label>
            <input id="upi" className={field} value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourshop@okhdfc" maxLength={100} autoComplete="off" />
            <p className="mt-1 text-[11px] text-slate-400">{ta ? 'வாடிக்கையாளர்களுக்கான பணம் செலுத்தும் இணைப்புகளில் பயன்படும்.' : 'Used in the pay links sent to customers.'}</p>
          </div>

          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {ta ? 'தானியங்கி பணம் நினைவூட்டல்' : 'Automatic payment reminders'}
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} />
              <span>
                <span className="font-semibold text-[#243B40]">
                  {ta ? 'நிலுவை உள்ள வாடிக்கையாளர்களுக்கு WhatsApp நினைவூட்டல் தானாக அனுப்பு' : 'Send WhatsApp reminders to customers who owe money'}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {ta ? 'காலை 9 முதல் மாலை 7 மணி வரை மட்டும். வாடிக்கையாளர் பக்கத்தில் ஒருவரை விலக்கலாம்.' : 'Only between 9am and 7pm. You can exclude a customer on their page.'}
                </span>
              </span>
            </label>
            {autoOn && (
              <div className="grid grid-cols-3 gap-3">
                {([
                  ['first', ta ? 'முதல் நினைவூட்டல் (நாள்)' : 'First after (days)', afterDays, setAfterDays, 90],
                  ['repeat', ta ? 'மீண்டும் (நாள்)' : 'Repeat every (days)', repeatDays, setRepeatDays, 60],
                  ['max', ta ? 'அதிகபட்சம்' : 'At most', maxCount, setMaxCount, 10],
                ] as const).map(([id, text, value, set, max]) => (
                  <div key={id}>
                    <label htmlFor={`rem-${id}`} className={label}>{text}</label>
                    <input id={`rem-${id}`} type="number" min={1} max={max} className={field} value={value} onChange={(e) => set(e.target.value)} />
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">{error}</p>}
          {saved && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">{ta ? 'சேமிக்கப்பட்டது.' : 'Saved.'}</p>}
          <button type="submit" disabled={busy || gstProblem} className="rounded-lg bg-[#167D79] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy ? (ta ? 'சேமிக்கிறது…' : 'Saving…') : ta ? 'சேமி' : 'Save'}
          </button>
        </form>
      )}
      {!loaded && error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}
