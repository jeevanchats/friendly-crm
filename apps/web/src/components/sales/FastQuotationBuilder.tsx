'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CustomFieldRenderer } from '../dynamic/CustomFieldRenderer';
import { apiFetch } from '../../lib/session';
import { ProductPicker } from '../products/ProductPicker';
import { GST_RATE_SLABS, SuggestedLine } from '@friendly-crm/shared';

type LineItem = {
  itemName: string;
  description: string;
  hsnCode: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxPercent: number;
  /** Set on lines filled in from the customer's enquiry: where it came from and what staff still have to add. */
  hint?: { source: string; matched: string | null; missing: Array<'quantity' | 'rate'> };
};

/** The quote being revised: its lines, discount and details become the starting point of the new version. */
export interface ReviseSeed {
  quoteId: string;
  quoteNumber: string;
  version: number;
  items: LineItem[];
  discount: number;
  customData: Record<string, any>;
}

interface FastQuotationProps {
  customer: { id: string; name: string; phone: string };
  leadId?: string;
  industry: 'printing' | 'furniture' | 'textiles' | 'trading';
  defaultLang?: 'en' | 'ta';
  onQuoteCreated?: (quote: any) => void;
  /** Present when this is a new version of an existing quote rather than a brand new one. */
  revise?: ReviseSeed;
  /** Lines read from the enquiry's notes, files and voice note. Each new `id` adds its lines to the form. */
  suggestion?: { id: number; lines: SuggestedLine[] } | null;
}

export function FastQuotationBuilder({
  customer,
  leadId,
  industry,
  defaultLang = 'en',
  onQuoteCreated,
  revise,
  suggestion,
}: FastQuotationProps) {
  const [lang, setLang] = useState<'en' | 'ta'>(defaultLang);
  const [items, setItems] = useState<LineItem[]>(
    revise?.items?.length
      ? revise.items
      : [{ itemName: '', description: '', hsnCode: '', quantity: 100, unit: 'Nos', unitPrice: 0, taxPercent: 18 }]
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discount, setDiscount] = useState(revise?.discount ?? 0);
  const [customData, setCustomData] = useState<Record<string, any>>(revise?.customData ?? {});
  const [savedQuote, setSavedQuote] = useState<any>(null);

  const subTotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const taxTotal = items.reduce(
    (sum, i) => sum + i.quantity * i.unitPrice * (i.taxPercent / 100),
    0
  );
  const grandTotal = Math.max(0, subTotal + taxTotal - discount);

  const updateItem = (idx: number, key: string, val: any) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [key]: val } : item)));
  };
  const patchItem = (idx: number, patch: Record<string, unknown>) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };
  const [filledFrom, setFilledFrom] = useState<Record<number, string>>({});

  // Lines read from the enquiry join the form once per reading. A form still holding only the blank starter line
  // is replaced; anything staff already typed is kept and the new lines go below it.
  const appliedSuggestion = useRef<number | null>(null);
  useEffect(() => {
    if (!suggestion || suggestion.lines.length === 0 || appliedSuggestion.current === suggestion.id) return;
    appliedSuggestion.current = suggestion.id;
    const fresh: LineItem[] = suggestion.lines.map((l) => ({
      itemName: l.itemName,
      description: l.description,
      hsnCode: l.hsnCode,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      taxPercent: l.taxPercent,
      hint: { source: l.sourceNote, matched: l.matchedProduct, missing: l.missing },
    }));
    setFilledFrom({});
    setItems((prev) => (prev.every((i) => !i.itemName.trim() && !i.unitPrice) ? fresh : [...prev, ...fresh]));
  }, [suggestion]);
  const removeItem = (idx: number) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleSaveQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || savedQuote) return; // a second click must never create a second quote
    setSaveError(null);
    setSaving(true);
    try {
      const res = await apiFetch(revise ? `/api/sales/quotations/${revise.quoteId}/revise` : '/api/sales/quotations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: customer.id,
          leadId: revise ? undefined : leadId,
          discountAmount: discount,
          customData,
          items: items.map(({ hint: _hint, ...i }) => ({ ...i, hsnCode: i.hsnCode.trim() || undefined })),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSavedQuote(data);
        if (onQuoteCreated) {
          onQuoteCreated(data);
        }
      } else {
        const body = await res.json().catch(() => ({}));
        setSaveError(
          Array.isArray(body.message)
            ? body.message.join(' ')
            : body.message || `Could not save the quotation (${res.status}).`
        );
      }
    } catch (err) {
      console.error('Failed to save quotation', err);
      setSaveError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  // Generates a zero-cost WhatsApp deep link for immediate P0 sharing
  const buildWhatsAppShareUrl = () => {
    const cleanPhone = customer.phone.replace(/\D/g, '');
    // The customer's own signed link, not the staff page (which needs a login they do not have)
    const pdfUrl = savedQuote?.pdfUrl as string;
    const msg =
      lang === 'ta'
        ? `வணக்கம் ${customer.name},\nஉங்களுக்கான கொட்டேஷன் தயார்!\n*எண்:* ${savedQuote?.quoteNumber} (v${savedQuote?.version})\n*மொத்த தொகை:* ₹${grandTotal.toFixed(2)}\n\nமாதிரி PDF பதிவிறக்க: ${pdfUrl}`
        : `Hello ${customer.name},\nHere is your quotation from our team:\n*Quote No:* ${savedQuote?.quoteNumber} (v${savedQuote?.version})\n*Total Amount:* ₹${grandTotal.toFixed(2)}\n\nDownload PDF: ${pdfUrl}`;

    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <div className="mx-auto max-w-xl space-y-5 rounded-2xl bg-surface p-5 shadow-md border border-slate-200">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {revise
              ? lang === 'ta'
                ? `${revise.quoteNumber} திருத்தம் (v${revise.version + 1})`
                : `Revise ${revise.quoteNumber} (new version v${revise.version + 1})`
              : lang === 'ta'
              ? 'புதிய கொட்டேஷன் (Quotation)'
              : 'Quick Quotation Builder'}
          </h2>
          <p className="text-xs text-slate-500">
            {customer.name} ({customer.phone})
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}
          className="rounded-lg bg-action/25 px-3 py-1.5 text-xs font-semibold text-foreground"
        >
          {lang === 'en' ? 'தமிழ்' : 'English'}
        </button>
      </div>

      <form onSubmit={handleSaveQuote} className="space-y-4">
        {/* Line Items */}
        {items.map((item, idx) => (
          <div key={idx} className="space-y-2.5 rounded-xl bg-surface p-3.5 border border-slate-200">
            <ProductPicker
              id={`item-name-${idx}`}
              placeholder={lang === 'ta' ? 'பொருள் / வேலை பெயர் * (தேடலாம்)' : 'Item / Job Description * (type to search your products)'}
              value={item.itemName}
              onText={(t) => {
                updateItem(idx, 'itemName', t);
                setFilledFrom((m) => (m[idx] ? { ...m, [idx]: '' } : m));
              }}
              onPick={(p) => {
                patchItem(idx, {
                  itemName: p.name,
                  description: item.description || p.description || '',
                  hsnCode: p.hsnCode ?? '',
                  unit: p.unit,
                  unitPrice: Number(p.unitPrice),
                  taxPercent: Number(p.taxPercent),
                });
                setFilledFrom((m) => ({ ...m, [idx]: p.name }));
              }}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-surface px-3 text-sm font-medium"
            />
            {filledFrom[idx] && (
              <p className="text-[11px] text-emerald-700">
                {lang === 'ta' ? 'விலை, GST, HSN உங்கள் பொருள் பட்டியலிலிருந்து நிரப்பப்பட்டது. மாற்றலாம்.' : 'Rate, GST and HSN filled from your product list. You can still change them.'}
              </p>
            )}
            {item.hint && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                <p className="font-semibold">
                  {lang === 'ta' ? 'விசாரணையிலிருந்து நிரப்பப்பட்டது — சரிபார்க்கவும்' : 'Filled from the enquiry — please check'}
                  {item.hint.matched ? ` · ${lang === 'ta' ? 'பொருள் பட்டியல்' : 'product list'}: ${item.hint.matched}` : ''}
                </p>
                {item.hint.source && <p className="italic">“{item.hint.source}”</p>}
                {item.hint.missing.length > 0 && (
                  <p className="font-bold text-red-700">
                    {lang === 'ta' ? 'நீங்கள் நிரப்ப வேண்டியது: ' : 'You need to fill in: '}
                    {item.hint.missing.map((m) => (m === 'quantity' ? (lang === 'ta' ? 'அளவு' : 'quantity') : lang === 'ta' ? 'விலை' : 'rate')).join(', ')}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] font-semibold text-slate-500">
                  {lang === 'ta' ? 'அளவு (Qty)' : 'Quantity'}
                </label>
                <input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500">
                  {lang === 'ta' ? 'விலை (₹ Rate)' : 'Rate (₹)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500">GST %</label>
                <select
                  value={item.taxPercent}
                  onChange={(e) => updateItem(idx, 'taxPercent', Number(e.target.value))}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-surface px-2 text-sm"
                >
                  {(GST_RATE_SLABS.includes(item.taxPercent as any) ? GST_RATE_SLABS : [...GST_RATE_SLABS, item.taxPercent]).map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500">
                {lang === 'ta' ? 'HSN / SAC குறியீடு (விருப்பம்)' : 'HSN / SAC code (optional, needed for GST invoice)'}
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                placeholder="e.g. 4910"
                value={item.hsnCode}
                onChange={(e) => updateItem(idx, 'hsnCode', e.target.value.replace(/\D/g, ''))}
                className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm"
              />
            </div>
            {items.length > 1 && (
              <button type="button" onClick={() => removeItem(idx)} className="text-[11px] font-semibold text-red-600">
                {lang === 'ta' ? 'இந்த வரியை நீக்கு' : 'Remove this line'}
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setItems([
              ...items,
              { itemName: '', description: '', hsnCode: '', quantity: 1, unit: 'Nos', unitPrice: 0, taxPercent: 18 },
            ])
          }
          className="w-full rounded-lg border border-dashed border-brand-ink py-2.5 text-xs font-semibold text-brand-ink"
        >
          + {lang === 'ta' ? 'மற்றொரு பொருள் சேர்க்க' : 'Add Another Line Item'}
        </button>

        {/* Industry-Specific Quotation Fields (GSM, Dimensions, Credit Days) */}
        <CustomFieldRenderer
          industry={industry}
          entity="QUOTATION"
          lang={lang}
          values={customData}
          onChange={(k, v) => setCustomData((prev) => ({ ...prev, [k]: v }))}
        />

        {/* Discount (taken off the total including GST) */}
        <div>
          <label htmlFor="q-discount" className="text-[11px] font-semibold text-slate-500">
            {lang === 'ta' ? 'தள்ளுபடி (₹)' : 'Discount (₹)'}
          </label>
          <input
            id="q-discount"
            type="number"
            min={0}
            step="0.01"
            value={discount || ''}
            placeholder="0"
            onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
            className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-surface px-2.5 text-sm"
          />
        </div>

        {/* Totals Box */}
        <div className="space-y-1.5 rounded-xl bg-surface border border-slate-200 p-4 text-brand-ink">
          <div className="flex justify-between text-xs text-slate-600">
            <span>{lang === 'ta' ? 'கூட்டுத்தொகை (Subtotal)' : 'Subtotal'}</span>
            <span>₹{subTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-600">
            <span>GST</span>
            <span>₹{taxTotal.toFixed(2)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-xs text-slate-600">
              <span>{lang === 'ta' ? 'தள்ளுபடி' : 'Discount'}</span>
              <span>- ₹{discount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-600 pt-2 text-base font-bold text-brand-ink">
            <span>{lang === 'ta' ? 'மொத்த தொகை (Grand Total)' : 'Grand Total'}</span>
            <span>₹{grandTotal.toFixed(2)}</span>
          </div>
        </div>

        {saveError && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
            {saveError}
          </p>
        )}
        <button
          type="submit"
          disabled={saving || !!savedQuote}
          className="min-h-[50px] w-full rounded-xl bg-action font-semibold text-on-action shadow-md disabled:cursor-not-allowed disabled:opacity-60"
        >
          {savedQuote
            ? lang === 'ta' ? 'சேமிக்கப்பட்டது' : 'Saved'
            : saving
            ? lang === 'ta' ? 'சேமிக்கிறது…' : 'Saving…'
            : revise
            ? lang === 'ta' ? 'புதிய பதிப்பை வாடிக்கையாளருக்கு அனுப்பு' : `Save v${revise.version + 1} and send to customer`
            : lang === 'ta' ? 'கொட்டேஷன் உருவாக்கு (Generate Quote)' : 'Save & Generate PDF Quote'}
        </button>
      </form>

      {/* Post-Save Action Bar: Share on WhatsApp, View PDF, or Convert to Order */}
      {savedQuote && (
        <div className="space-y-2.5 pt-3 border-t border-slate-200">
          <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 flex items-center justify-between">
            <span>
              {lang === 'ta'
                ? `கொட்டேஷன் #${savedQuote.quoteNumber} v${savedQuote.version || 1} சேமிக்கப்பட்டது.${savedQuote.customerNotified ? ' வாடிக்கையாளருக்கு WhatsApp-இல் அனுப்பப்பட்டது.' : ''}`
                : `Quotation #${savedQuote.quoteNumber} v${savedQuote.version || 1} saved.${
                    savedQuote.customerNotified
                      ? ` ${customer.name} was sent ${revise ? 'the updated quote' : 'it'} on WhatsApp.`
                      : ' The customer has no phone number on file, so nothing was sent.'
                  }`}
            </span>
            <span className="font-bold text-brand-ink">v{savedQuote.version || 1}</span>
          </div>

          <div className={`grid gap-2 ${savedQuote.pdfUrl ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <a
              href={`/q/${savedQuote.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[44px] items-center justify-center rounded-xl bg-action px-2 text-center text-xs font-bold text-on-action shadow-sm hover:bg-action/85 transition-colors"
            >
              {lang === 'ta' ? 'PDF அச்சு' : 'View PDF'}
            </a>
            {savedQuote.pdfUrl && (
              <a
                href={buildWhatsAppShareUrl()}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#25D366] px-2 text-center text-xs font-bold text-white shadow-sm hover:bg-[#20ba5a] transition-colors"
              >
                {lang === 'ta' ? 'வாட்ஸ்அப்' : 'WhatsApp'}
              </a>
            )}
            <button
              type="button"
              onClick={async () => {
                const convRes = await apiFetch(`/api/sales/quotations/${savedQuote.id}/convert`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ industryKey: industry }),
                });
                if (convRes.ok) {
                  alert(lang === 'ta' ? 'ஆர்டராக மாற்றப்பட்டது!' : 'Converted to Active Order!');
                }
              }}
              className="min-h-[44px] rounded-xl bg-action px-2 text-center text-xs font-bold text-on-action shadow-sm hover:bg-action/85 transition-colors"
            >
              {lang === 'ta' ? 'ஆர்டர் மாற்று' : 'Convert Order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}