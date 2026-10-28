'use client';
import { useDialog } from '../shared/useDialog';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { GST_RATE_SLABS, IndustryKey, getIndustryExamples, normalizeUnit, validateProductRow } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';

export interface ProductRow {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  hsnCode: string | null;
  unit: string;
  unitPrice: string;
  taxPercent: string;
  isActive: boolean;
}

const UNITS = ['Nos', 'Kg', 'Gm', 'Ltr', 'Meters', 'Sq.Ft', 'Sets', 'Bales', 'Box', 'Bags', 'Ton', 'Hours'];

/** Add or edit one product. The server re-checks everything; this just saves a round trip. */
export function ProductForm({
  product,
  industry,
  lang = 'en',
  onClose,
  onSaved,
}: {
  product?: ProductRow;
  industry?: IndustryKey;
  lang?: 'en' | 'ta';
  onClose: () => void;
  onSaved: () => void;
}) {
  const ta = lang === 'ta';
  // Sample text in this business's own trade
  const example = getIndustryExamples(industry ?? '').product;
  const [f, setF] = useState({
    name: product?.name ?? '',
    code: product?.code ?? '',
    description: product?.description ?? '',
    hsnCode: product?.hsnCode ?? '',
    unit: product?.unit ?? 'Nos',
    unitPrice: product ? String(Number(product.unitPrice)) : '',
    taxPercent: product ? String(Number(product.taxPercent)) : '18',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateProductRow({ ...f, unit: normalizeUnit(f.unit) });
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const res = await apiFetch(product ? `/api/products/${product.id}` : '/api/products', {
        method: product ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...f, unit: normalizeUnit(f.unit) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        onSaved();
        return;
      }
      setErrors(body.errors ?? [Array.isArray(body.message) ? body.message.join(' ') : body.message || `Could not save the product (${res.status}).`]);
    } catch {
      setErrors([ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server. Check your connection and try again.']);
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  const label = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1';
  const title = product ? (ta ? 'பொருளைத் திருத்து' : 'Edit product') : ta ? 'புதிய பொருள்' : 'Add product';

  const dialogRef = useDialog(true, busy ? undefined : onClose);
  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-foreground">{title}</h2>
          <button type="button" onClick={onClose} aria-label={ta ? 'மூடு' : 'Close'} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="p-name" className={label}>{ta ? 'பெயர் *' : 'Name *'}</label>
            <input id="p-name" className={input} value={f.name} onChange={set('name')} maxLength={200} autoFocus placeholder={`e.g., ${example.name}`} />
          </div>
          <div>
            <label htmlFor="p-code" className={label}>{ta ? 'குறியீடு' : 'Code / SKU'}</label>
            <input id="p-code" className={input} value={f.code} onChange={set('code')} maxLength={50} />
          </div>
          <div>
            <label htmlFor="p-hsn" className={label}>HSN / SAC</label>
            <input id="p-hsn" className={input} value={f.hsnCode} onChange={(e) => setF((p) => ({ ...p, hsnCode: e.target.value.replace(/\D/g, '').slice(0, 8) }))} inputMode="numeric" placeholder={example.hsnCode || '4910'} />
          </div>
          <div>
            <label htmlFor="p-unit" className={label}>{ta ? 'அலகு' : 'Unit'}</label>
            <input id="p-unit" className={input} list="p-units" value={f.unit} onChange={set('unit')} maxLength={30} />
            <datalist id="p-units">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="p-rate" className={label}>{ta ? 'விலை (₹, வரி இல்லாமல்)' : 'Rate (₹, before GST)'}</label>
            <input id="p-rate" className={input} value={f.unitPrice} onChange={set('unitPrice')} inputMode="decimal" placeholder={example.unitPrice} />
          </div>
          <div>
            <label htmlFor="p-gst" className={label}>GST %</label>
            <select id="p-gst" className={input} value={f.taxPercent} onChange={set('taxPercent')}>
              {GST_RATE_SLABS.map((r) => (
                <option key={r} value={String(r)}>{r}%</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="p-desc" className={label}>{ta ? 'விவரம்' : 'Description'}</label>
          <textarea id="p-desc" className={input} rows={2} value={f.description} onChange={set('description')} maxLength={1000} placeholder={`e.g., ${example.description}`} />
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
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600">
            {ta ? 'ரத்து' : 'Cancel'}
          </button>
        </div>
      </form>
    </div>
  );
}
