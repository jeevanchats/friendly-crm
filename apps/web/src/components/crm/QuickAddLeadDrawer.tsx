'use client';

import React, { useState } from 'react';
import { CustomFieldRenderer } from '../dynamic/CustomFieldRenderer';
import { IndustryKey } from '@friendly-crm/shared';
import { X } from 'lucide-react';
import { apiFetch } from '../../lib/session';

export interface QuickAddProps {
  isOpen?: boolean;
  onClose?: () => void;
  industry: IndustryKey;
  defaultLang?: 'en' | 'ta';
  locale?: 'en' | 'ta';
  onSuccess?: () => void;
  onSubmit?: (leadData: any) => Promise<void> | void;
}

export function QuickAddLeadDrawer({
  isOpen = true,
  onClose,
  industry = 'printing',
  defaultLang = 'en',
  locale,
  onSuccess,
  onSubmit,
}: QuickAddProps) {
  const [lang, setLang] = useState<'en' | 'ta'>(locale || defaultLang);
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<'WHATSAPP' | 'PHONE' | 'WALK_IN'>('WHATSAPP');
  const [followUpPreset, setFollowUpPreset] = useState<'TODAY_EVE' | 'TOMORROW' | 'THREE_DAYS'>('TOMORROW');
  const [customData, setCustomData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);

  // Sync lang when locale prop changes
  React.useEffect(() => {
    if (locale) setLang(locale);
  }, [locale]);

  if (!isOpen) return null;

  const computeFollowUpDate = (preset: typeof followUpPreset) => {
    const now = new Date();
    if (preset === 'TODAY_EVE') {
      now.setHours(18, 0, 0, 0);
      return now.toISOString();
    }
    if (preset === 'TOMORROW') {
      now.setDate(now.getDate() + 1);
      now.setHours(11, 0, 0, 0);
      return now.toISOString();
    }
    now.setDate(now.getDate() + 3);
    now.setHours(11, 0, 0, 0);
    return now.toISOString();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        phone,
        name: customerName,
        customerName,
        companyName,
        title,
        source,
        followUpDueAt: computeFollowUpDate(followUpPreset),
        customData,
      };

      if (onSubmit) {
        await onSubmit(payload);
      } else {
        const res = await apiFetch('/api/crm/intake-lead', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to save enquiry');
      }

      onSuccess?.();
      onClose?.();
      // Reset form
      setPhone('');
      setCustomerName('');
      setCompanyName('');
      setTitle('');
      setCustomData({});
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#243B40]/60 backdrop-blur-xs transition-opacity">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white p-5 shadow-2xl border-t sm:border border-slate-200 animate-slide-up">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Header + Tamil/English Switcher */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-[#243B40]">
                {lang === 'ta' ? 'புதிய விசாரணை (Quick Add)' : 'New Enquiry (Quick Add)'}
              </h2>
              <span className="text-[11px] font-semibold text-[#167D79] capitalize">
                {industry} {lang === 'ta' ? 'தொழில் துறை' : 'Industry'}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}
                className="rounded-lg bg-[#F4B860]/25 px-2.5 py-1 text-xs font-semibold text-[#243B40] hover:bg-[#F4B860]/40 transition-colors"
              >
                {lang === 'en' ? 'தமிழ்' : 'English'}
              </button>

              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1 text-slate-400 hover:text-[#243B40] rounded-lg hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          {/* Lead Source Chips */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
              {lang === 'ta' ? 'வந்த விதம்' : 'Enquiry Source'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'WHATSAPP', en: 'WhatsApp', ta: 'வாட்ஸ்அப்' },
                { id: 'PHONE', en: 'Phone Call', ta: 'போன் கால்' },
                { id: 'WALK_IN', en: 'Walk-In', ta: 'நேரில்' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSource(item.id as any)}
                  className={`min-h-[44px] rounded-lg text-xs font-semibold transition-all ${
                    source === item.id
                      ? 'bg-[#167D79] text-white shadow-sm'
                      : 'bg-[#F6F8F7] text-[#243B40] border border-slate-200'
                  }`}
                >
                  {item[lang]}
                </button>
              ))}
            </div>
          </div>

          {/* Core Customer & Enquiry Inputs */}
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[#243B40]">
                {lang === 'ta' ? 'மொபைல் எண் (WhatsApp) *' : 'Mobile Number (WhatsApp) *'}
              </label>
              <input
                type="tel"
                required
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 text-base font-medium text-[#243B40] focus:border-[#167D79] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[#243B40]">
                {lang === 'ta' ? 'வாடிக்கையாளர் பெயர் *' : 'Customer / Contact Name *'}
              </label>
              <input
                type="text"
                required
                placeholder={lang === 'ta' ? 'எ.கா. ஸ்ரீ விநாயகா ஸ்டோர்ஸ்' : 'e.g., Sri Vinayaga Stores'}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 text-sm text-[#243B40] focus:border-[#167D79] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[#243B40]">
                {lang === 'ta' ? 'நிறுவனம் / கடை பெயர்' : 'Company / Store Name'}
              </label>
              <input
                type="text"
                placeholder={lang === 'ta' ? 'எ.கா. முருகன் டெக்ஸ்டைல்ஸ்' : 'e.g., Murugan Textiles'}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 text-sm text-[#243B40] focus:border-[#167D79] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[#243B40]">
                {lang === 'ta' ? 'தேவை / ஆர்டர் விவரம் *' : 'Enquiry Summary *'}
              </label>
              <input
                type="text"
                required
                placeholder={
                  lang === 'ta'
                    ? 'எ.கா. 1000 தினசரி காலண்டர் / தேக்கு கட்டில்'
                    : 'e.g., 1000 Daily Calendars / Teak Cot'
                }
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 text-sm text-[#243B40] focus:border-[#167D79] focus:outline-none"
              />
            </div>
          </div>

          {/* Dynamic Industry Fields (Reads active industry schema from industry-templates.json) */}
          <CustomFieldRenderer
            industry={industry}
            entity="LEAD"
            lang={lang}
            values={customData}
            onChange={(key, val) => setCustomData((prev) => ({ ...prev, [key]: val }))}
          />

          {/* 1-Tap Follow-Up Reminder Chips */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
              {lang === 'ta' ? 'அடுத்த பின்தொடர்தல் (Follow-up)' : 'Next Follow-Up Reminder'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'TODAY_EVE', en: 'Today 6 PM', ta: 'இன்று மாலை' },
                { id: 'TOMORROW', en: 'Tomorrow', ta: 'நாளை காலை' },
                { id: 'THREE_DAYS', en: 'In 3 Days', ta: '3 நாட்களில்' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFollowUpPreset(chip.id as any)}
                  className={`min-h-[42px] rounded-lg text-xs font-semibold ${
                    followUpPreset === chip.id
                      ? 'bg-[#F4B860] text-[#243B40]'
                      : 'bg-[#F6F8F7] text-slate-600 border border-slate-200'
                  }`}
                >
                  {chip[lang]}
                </button>
              ))}
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="pt-2 flex items-center space-x-3">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[48px] rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-[#243B40] hover:bg-slate-100 transition-colors"
              >
                {lang === 'ta' ? 'ரத்து' : 'Cancel'}
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="flex-1 min-h-[48px] rounded-xl bg-[#167D79] font-semibold text-white shadow-md hover:bg-[#126461] disabled:opacity-50 transition-colors"
            >
              {loading
                ? lang === 'ta' ? 'சேமிக்கிறது...' : 'Saving...'
                : lang === 'ta' ? 'விசாரணையை சேமி' : 'Save Enquiry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
