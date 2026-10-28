'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Download, Paperclip, Plus, Trash2, Truck } from 'lucide-react';
import {
  EWAY_BILL_FILE_TYPES,
  EWAY_BILL_PORTAL_URL,
  MAX_FILE_BYTES,
  hasPermission,
  likelyNeedsEwayBill,
  normalizeEwayBillNumber,
  normalizeVehicleNumber,
  TenantRole,
} from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';
import { downloadAuthedFile } from '../../lib/invoice-pdf';

interface Bill {
  id: string;
  ewbNumber: string;
  generatedOn: string | null;
  validUntil: string | null;
  vehicleNumber: string | null;
  hasFile: boolean;
  fileName: string | null;
}

const spaced = (n: string) => n.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
const dateIn = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const today = () => new Date().toISOString().slice(0, 10);
const errorText = (body: any, status: number, fallback: string) =>
  (Array.isArray(body?.message) ? body.message.join(' ') : body?.message) || `${fallback} (${status}).`;

/**
 * E-way bills for one invoice. They are generated on the government portal by staff; here the number, dates,
 * vehicle and the PDF they downloaded are recorded next to the invoice. Nothing is sent to the government.
 */
export function EwayBillPanel({
  invoiceId,
  role,
  amount,
  hsnCodes,
  lang = 'en',
}: {
  invoiceId: string;
  role: TenantRole;
  /** What the invoice is worth in rupees, to advise whether an e-way bill is normally needed. */
  amount: number;
  hsnCodes: string[];
  lang?: 'en' | 'ta';
}) {
  const ta = lang === 'ta';
  const canAdd = hasPermission(role, 'invoice:create');
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [generatedOn, setGeneratedOn] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/eway-bills?invoiceId=${invoiceId}`);
      if (res.ok) {
        setBills(await res.json());
        setLoadError(null);
      } else {
        setLoadError(errorText(await res.json().catch(() => ({})), res.status, 'Could not load e-way bills'));
      }
    } catch {
      setLoadError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
    }
  }, [invoiceId, ta]);

  useEffect(() => {
    void load();
  }, [load]);

  const numberOk = !!normalizeEwayBillNumber(number);
  const vehicleOk = vehicle.trim() === '' || !!normalizeVehicleNumber(vehicle);
  const datesOk = !generatedOn || !validUntil || validUntil >= generatedOn;

  const pickFile = (f: File | null) => {
    if (!f) return setFile(null);
    if (!EWAY_BILL_FILE_TYPES.includes(f.type)) return setError(ta ? 'PDF அல்லது புகைப்படம் (JPG, PNG) மட்டும்.' : 'Upload the e-way bill as a PDF or a photo (JPG, PNG).');
    if (f.size > MAX_FILE_BYTES) return setError(ta ? 'கோப்பு மிகப் பெரியது (10 MB வரை).' : 'The file is too large (10 MB at most).');
    setError(null);
    setFile(f);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('invoiceId', invoiceId);
      form.append('ewbNumber', number);
      if (generatedOn) form.append('generatedOn', generatedOn);
      if (validUntil) form.append('validUntil', validUntil);
      if (vehicle.trim()) form.append('vehicleNumber', vehicle);
      if (file) form.append('file', file, file.name);
      const res = await apiFetch('/api/eway-bills', { method: 'POST', body: form });
      if (res.ok) {
        setOpen(false);
        setNumber('');
        setGeneratedOn('');
        setValidUntil('');
        setVehicle('');
        setFile(null);
        await load();
      } else {
        setError(errorText(await res.json().catch(() => ({})), res.status, 'Could not save the e-way bill'));
      }
    } catch {
      setError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: Bill) => {
    if (!window.confirm(`${ta ? 'நீக்கவா' : 'Remove e-way bill'} ${spaced(b.ewbNumber)}?`)) return;
    const res = await apiFetch(`/api/eway-bills/${b.id}`, { method: 'DELETE' });
    if (res.ok) await load();
    else setError(errorText(await res.json().catch(() => ({})), res.status, 'Could not remove it'));
  };

  if (loadError) return <p role="alert" className="text-xs font-semibold text-red-700">{loadError}</p>;
  if (!bills) return null;
  const needed = likelyNeedsEwayBill(amount, hsnCodes);
  // Nothing recorded, nothing advised, and no one who can add: nothing to show
  if (bills.length === 0 && !needed && !canAdd) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-surface p-4 shadow-xs" aria-label={ta ? 'இ-வே பில்' : 'E-way bill'}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-foreground">
          <Truck className="h-4 w-4 text-brand-ink" /> {ta ? 'இ-வே பில்' : 'E-way bill'}
        </h3>
        {canAdd && !open && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg bg-surface border border-slate-200 px-3 py-1.5 text-xs font-bold text-brand-ink">
            <Plus className="h-3.5 w-3.5" /> {ta ? 'பதிவேற்று' : 'Upload'}
          </button>
        )}
      </div>

      {needed && bills.length === 0 && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {ta
            ? 'இந்த பொருட்களின் மதிப்பு ₹50,000 ஐ விட அதிகம், பொதுவாக இ-வே பில் தேவை. அரசு இணையதளத்தில் உருவாக்கி இங்கே பதிவேற்றவும்.'
            : 'This invoice is for goods worth more than ₹50,000, which normally need an e-way bill. Generate it on the government portal, then upload it here.'}{' '}
          <a href={EWAY_BILL_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="text-brand-ink underline">
            ewaybillgst.gov.in
          </a>
        </p>
      )}

      {bills.length > 0 && (
        <ul className="space-y-1.5">
          {bills.map((b) => {
            const expired = !!b.validUntil && b.validUntil < today();
            return (
              <li key={b.id} className="rounded-lg bg-surface px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-foreground">{spaced(b.ewbNumber)}</span>
                  <span className="flex items-center gap-2">
                    {b.hasFile && (
                      <button
                        type="button"
                        aria-label={`Download e-way bill ${b.ewbNumber}`}
                        onClick={async () => {
                          const msg = await downloadAuthedFile(`/api/eway-bills/${b.id}/file`, b.fileName ?? `eway-bill-${b.ewbNumber}.pdf`);
                          if (msg) setError(msg);
                        }}
                        className="text-brand-ink"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canAdd && (
                      <button type="button" aria-label={`Remove e-way bill ${b.ewbNumber}`} onClick={() => remove(b)} className="text-slate-600 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
                <div className="text-slate-500">
                  {b.generatedOn && `${ta ? 'உருவாக்கியது' : 'Generated'} ${dateIn(b.generatedOn)}`}
                  {b.validUntil && ` · ${ta ? 'செல்லுபடி' : 'valid until'} ${dateIn(b.validUntil)}`}
                  {expired && <span className="ml-1 font-bold text-red-700">{ta ? 'காலாவதி' : 'Expired'}</span>}
                  {b.vehicleNumber && ` · ${b.vehicleNumber}`}
                  {!b.hasFile && <span className="ml-1 text-amber-700">· {ta ? 'கோப்பு இல்லை' : 'no file uploaded'}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {bills.length === 0 && !needed && <p className="text-xs text-slate-600">{ta ? 'இன்னும் இல்லை.' : 'None recorded for this invoice.'}</p>}

      {open && (
        <div className="space-y-2.5 border-t border-slate-100 pt-3">
          <p className="text-[11px] text-slate-500">
            {ta ? 'அரசு இணையதளத்தில் இ-வே பில் உருவாக்கி, அதன் எண்ணையும் PDF ஐயும் இங்கே சேர்க்கவும்.' : 'Generate the e-way bill on the government portal, then add its number and the PDF you downloaded.'}{' '}
            <a href={EWAY_BILL_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-ink underline">
              ewaybillgst.gov.in
            </a>
          </p>
          <label className="block text-[11px] font-semibold text-slate-500">
            {ta ? 'இ-வே பில் எண் (12 இலக்கம்) *' : 'E-way bill number (12 digits) *'}
            <input
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/[^\d\s-]/g, '').slice(0, 16))}
              placeholder="3510 0123 4567"
              className="mt-0.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-2 text-sm font-normal text-foreground"
            />
            {number && !numberOk && <span className="font-normal text-amber-700">{ta ? '12 இலக்கங்கள் தேவை.' : 'It has exactly 12 digits.'}</span>}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-semibold text-slate-500">
              {ta ? 'உருவாக்கிய தேதி' : 'Generated on'}
              <input type="date" value={generatedOn} onChange={(e) => setGeneratedOn(e.target.value)} className="mt-0.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-2 text-sm font-normal text-foreground" />
            </label>
            <label className="text-[11px] font-semibold text-slate-500">
              {ta ? 'செல்லுபடி தேதி' : 'Valid until'}
              <input type="date" value={validUntil} min={generatedOn || undefined} onChange={(e) => setValidUntil(e.target.value)} className="mt-0.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-2 text-sm font-normal text-foreground" />
            </label>
          </div>
          {!datesOk && <p className="text-[11px] font-semibold text-amber-700">{ta ? 'செல்லுபடி தேதி முன்பு இருக்க முடியாது.' : 'Valid-until cannot be before the generated date.'}</p>}
          <label className="block text-[11px] font-semibold text-slate-500">
            {ta ? 'வாகன எண் (விருப்பம்)' : 'Vehicle number (optional)'}
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase().slice(0, 16))} placeholder="TN38AB1234" className="mt-0.5 min-h-[44px] w-full rounded-lg border border-slate-300 px-2 text-sm font-normal text-foreground" />
            {!vehicleOk && <span className="font-normal text-amber-700">{ta ? 'எண் சரியாக இல்லை.' : 'This does not look like a vehicle number.'}</span>}
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-surface px-3 text-sm font-semibold text-foreground">
            <Paperclip className="h-4 w-4 text-brand-ink" />
            <span className="min-w-0 truncate">{file ? file.name : ta ? 'PDF / புகைப்படம் இணை' : 'Attach the PDF or photo'}</span>
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy || !numberOk || !vehicleOk || !datesOk} className="min-h-[44px] flex-1 rounded-xl bg-action text-sm font-bold text-on-action disabled:opacity-50">
              {busy ? (ta ? 'சேமிக்கிறது…' : 'Saving…') : ta ? 'சேமி' : 'Save e-way bill'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={busy} className="min-h-[44px] rounded-xl border border-slate-200 bg-surface px-4 text-sm font-semibold text-foreground">
              {ta ? 'மூடு' : 'Close'}
            </button>
          </div>
        </div>
      )}
      {!open && error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
    </section>
  );
}
