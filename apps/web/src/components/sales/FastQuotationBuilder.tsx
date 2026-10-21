'use client';

import React, { useState } from 'react';
import { CustomFieldRenderer } from '../dynamic/CustomFieldRenderer';

interface FastQuotationProps {
  customer: { id: string; name: string; phone: string };
  leadId?: string;
  industry: 'printing' | 'furniture' | 'textiles' | 'trading';
  defaultLang?: 'en' | 'ta';
  onQuoteCreated?: (quote: any) => void;
}

export function FastQuotationBuilder({
  customer,
  leadId,
  industry,
  defaultLang = 'en',
  onQuoteCreated,
}: FastQuotationProps) {
  const [lang, setLang] = useState<'en' | 'ta'>(defaultLang);
  const [items, setItems] = useState([
    { itemName: '', description: '', quantity: 100, unit: 'Nos', unitPrice: 0, taxPercent: 18 },
  ]);
  const [discount, setDiscount] = useState(0);
  const [customData, setCustomData] = useState<Record<string, any>>({});
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

  const handleSaveQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/sales/quotations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': `t-demo-${industry}`,
        },
        body: JSON.stringify({
          customerId: customer.id,
          leadId,
          discountAmount: discount,
          customData,
          items,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSavedQuote(data);
        if (onQuoteCreated) {
          onQuoteCreated(data);
        }
      }
    } catch (err) {
      console.error('Failed to save quotation', err);
    }
  };

  // Generates a zero-cost WhatsApp deep link for immediate P0 sharing
  const buildWhatsAppShareUrl = () => {
    const cleanPhone = customer.phone.replace(/\D/g, '');
    const pdfUrl = `${window.location.origin}/q/${savedQuote?.id}/pdf`;
    const msg =
      lang === 'ta'
        ? `வணக்கம் ${customer.name},\nஉங்களுக்கான கொட்டேஷன் தயார்!\n*எண்:* ${savedQuote?.quoteNumber} (v${savedQuote?.version})\n*மொத்த தொகை:* ₹${grandTotal.toFixed(2)}\n\nமாதிரி PDF பதிவிறக்க: ${pdfUrl}`
        : `Hello ${customer.name},\nHere is your quotation from our team:\n*Quote No:* ${savedQuote?.quoteNumber} (v${savedQuote?.version})\n*Total Amount:* ₹${grandTotal.toFixed(2)}\n\nDownload PDF: ${pdfUrl}`;

    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <div className="mx-auto max-w-xl space-y-5 rounded-2xl bg-white p-5 shadow-md border border-slate-200">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h2 className="text-lg font-bold text-[#243B40]">
            {lang === 'ta' ? 'புதிய கொட்டேஷன் (Quotation)' : 'Quick Quotation Builder'}
          </h2>
          <p className="text-xs text-slate-500">
            {customer.name} ({customer.phone})
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}
          className="rounded-lg bg-[#F4B860]/25 px-3 py-1.5 text-xs font-semibold text-[#243B40]"
        >
          {lang === 'en' ? 'தமிழ்' : 'English'}
        </button>
      </div>

      <form onSubmit={handleSaveQuote} className="space-y-4">
        {/* Line Items */}
        {items.map((item, idx) => (
          <div key={idx} className="space-y-2.5 rounded-xl bg-[#F6F8F7] p-3.5 border border-slate-200">
            <input
              type="text"
              required
              placeholder={lang === 'ta' ? 'பொருள் / வேலை பெயர் *' : 'Item / Job Description *'}
              value={item.itemName}
              onChange={(e) => updateItem(idx, 'itemName', e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium"
            />
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
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
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
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500">GST %</label>
                <select
                  value={item.taxPercent}
                  onChange={(e) => updateItem(idx, 'taxPercent', Number(e.target.value))}
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2 text-sm"
                >
                  <option value={0}>0%</option>
                  <option value={5}>5%</option>
                  <option value={12}>12%</option>
                  <option value={18}>18%</option>
                </select>
              </div>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setItems([
              ...items,
              { itemName: '', description: '', quantity: 1, unit: 'Nos', unitPrice: 0, taxPercent: 18 },
            ])
          }
          className="w-full rounded-lg border border-dashed border-[#167D79] py-2.5 text-xs font-semibold text-[#167D79]"
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

        {/* Totals Box */}
        <div className="space-y-1.5 rounded-xl bg-[#243B40] p-4 text-white">
          <div className="flex justify-between text-xs text-slate-300">
            <span>{lang === 'ta' ? 'கூட்டுத்தொகை (Subtotal)' : 'Subtotal'}</span>
            <span>₹{subTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-300">
            <span>GST</span>
            <span>₹{taxTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-600 pt-2 text-base font-bold text-[#F4B860]">
            <span>{lang === 'ta' ? 'மொத்த தொகை (Grand Total)' : 'Grand Total'}</span>
            <span>₹{grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <button
          type="submit"
          className="min-h-[50px] w-full rounded-xl bg-[#167D79] font-semibold text-white shadow-md"
        >
          {lang === 'ta' ? 'கொட்டேஷன் உருவாக்கு (Generate Quote)' : 'Save & Generate PDF Quote'}
        </button>
      </form>

      {/* Post-Save Action Bar: Share on WhatsApp, View PDF, or Convert to Order */}
      {savedQuote && (
        <div className="space-y-2.5 pt-3 border-t border-slate-200">
          <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 flex items-center justify-between">
            <span>
              {lang === 'ta'
                ? `கொட்டேஷன் #${savedQuote.quoteNumber || 'QT-2026-0042'} வெற்றிகரமாக உருவாக்கப்பட்டது!`
                : `Quotation #${savedQuote.quoteNumber || 'QT-2026-0042'} created successfully!`}
            </span>
            <span className="font-bold text-[#167D79]">v{savedQuote.version || 1}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <a
              href={`/q/${savedQuote.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#167D79] px-2 text-center text-xs font-bold text-white shadow-sm hover:bg-[#126360] transition-colors"
            >
              {lang === 'ta' ? 'PDF அச்சு' : 'View PDF'}
            </a>
            <a
              href={buildWhatsAppShareUrl()}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#25D366] px-2 text-center text-xs font-bold text-white shadow-sm hover:bg-[#20ba5a] transition-colors"
            >
              {lang === 'ta' ? 'வாட்ஸ்அப்' : 'WhatsApp'}
            </a>
            <button
              type="button"
              onClick={async () => {
                const convRes = await fetch(`/api/sales/quotations/${savedQuote.id}/convert`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-tenant-id': `t-demo-${industry}`,
                  },
                  body: JSON.stringify({ industryKey: industry }),
                });
                if (convRes.ok) {
                  alert(lang === 'ta' ? 'ஆர்டராக மாற்றப்பட்டது!' : 'Converted to Active Order!');
                }
              }}
              className="min-h-[44px] rounded-xl bg-[#F4B860] px-2 text-center text-xs font-bold text-[#243B40] shadow-sm hover:bg-[#e2a74f] transition-colors"
            >
              {lang === 'ta' ? 'ஆர்டர் மாற்று' : 'Convert Order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}