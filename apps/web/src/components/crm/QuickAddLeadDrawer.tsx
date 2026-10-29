'use client';
import { useDialog } from '../shared/useDialog';

import React, { useEffect, useRef, useState } from 'react';
import { CustomFieldRenderer } from '../dynamic/CustomFieldRenderer';
import { IndustryKey, getIndustryExamples, normalizeContactPhone } from '@friendly-crm/shared';
import { X } from 'lucide-react';
import { apiFetch } from '../../lib/session';
import { AttachmentPicker, PickerValue, voiceFileName } from './AttachmentPicker';
import { uploadAttachment } from '../../lib/attachments';

export interface QuickAddProps {
  isOpen?: boolean;
  onClose?: () => void;
  industry: IndustryKey;
  defaultLang?: 'en' | 'ta';
  locale?: 'en' | 'ta';
  onSuccess?: () => void;
  /** Saves the enquiry. May return the saved record ({ lead: { id } }) so attachments can be added to it. */
  onSubmit?: (leadData: any) => Promise<any> | any;
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
  const [followUpPreset, setFollowUpPreset] = useState<'TODAY_EVE' | 'TOMORROW' | 'THREE_DAYS'>('TODAY_EVE');
  const [customData, setCustomData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attach, setAttach] = useState<PickerValue>({ voice: null, files: [] });
  // Once the enquiry is saved, pressing the button again only retries the attachments (never saves a second enquiry)
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);

  // The phone number is the customer's identity: once a full number is typed, look it up in the customer master.
  const [lookup, setLookup] = useState<
    | { state: 'idle' | 'checking' | 'invalid' | 'error' }
    | { state: 'new'; phone: string }
    | { state: 'found'; phone: string; matchedOn: string; contactName?: string; customer: { id: string; name: string; companyName: string | null; phone: string; openEnquiries: number } }
  >({ state: 'idle' });
  const filledFromMaster = useRef(false); // name/company currently come from the master record
  const lookupSeq = useRef(0);

  useEffect(() => {
    const mine = ++lookupSeq.current;
    const clearMasterFill = () => {
      if (filledFromMaster.current) {
        filledFromMaster.current = false;
        setCustomerName('');
        setCompanyName('');
      }
    };
    const normalized = normalizeContactPhone(phone);
    if (!normalized) {
      clearMasterFill();
      // Still typing (fewer than 10 digits) is not an error; a full-length number that is not a mobile number is
      setLookup({ state: phone.replace(/\D/g, '').length >= 10 ? 'invalid' : 'idle' });
      return;
    }
    setLookup({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/crm/customers/lookup?phone=${encodeURIComponent(normalized)}`);
        if (mine !== lookupSeq.current) return;
        if (!res.ok) {
          clearMasterFill();
          setLookup({ state: 'error' });
          return;
        }
        const r = await res.json();
        if (mine !== lookupSeq.current) return;
        if (r.status === 'FOUND') {
          filledFromMaster.current = true;
          setCustomerName(r.customer.name);
          setCompanyName(r.customer.companyName ?? '');
          setLookup({ state: 'found', phone: r.phone, matchedOn: r.matchedOn, contactName: r.contactName, customer: r.customer });
        } else {
          clearMasterFill();
          setLookup(r.status === 'NOT_FOUND' ? { state: 'new', phone: r.phone } : { state: 'invalid' });
        }
      } catch {
        if (mine === lookupSeq.current) setLookup({ state: 'error' });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [phone]);

  // Sync lang when locale prop changes
  React.useEffect(() => {
    if (locale) setLang(locale);
  }, [locale]);

  const dialogRef = useDialog(isOpen, loading ? undefined : onClose);
  if (!isOpen) return null;

  // Sample text in this business's own trade, so a furniture shop is not shown calendars and a printer is not shown cots.
  const examples = getIndustryExamples(industry);

  const computeFollowUpDate = (preset: typeof followUpPreset) => {
    const now = new Date();
    if (preset === 'TODAY_EVE') {
      // Late in the day, 6 PM is nearly over: give two hours instead so the reminder is never already overdue
      if (now.getHours() >= 16) now.setTime(Date.now() + 2 * 60 * 60 * 1000);
      else now.setHours(18, 0, 0, 0);
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
    setError(null);
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

      let leadId = savedLeadId;
      if (!leadId) {
        let saved: any;
        if (onSubmit) {
          saved = await onSubmit(payload);
        } else {
          const res = await apiFetch('/api/crm/intake-lead', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(Array.isArray(body.message) ? body.message.join(' ') : body.message || `Could not save the enquiry (${res.status}).`);
          }
          saved = await res.json().catch(() => ({}));
        }
        leadId = saved?.lead?.id ?? null;
        if (leadId) setSavedLeadId(leadId);
      }

      // Voice note and files go up after the enquiry exists. Whatever fails stays in the list for a retry.
      if (leadId && (attach.voice || attach.files.length)) {
        const failures: string[] = [];
        let voice = attach.voice;
        if (voice) {
          const r = await uploadAttachment(leadId, voice.blob, voiceFileName(voice.blob.type), voice.seconds, voice.transcript);
          if (r.ok) voice = null;
          else failures.push(`${lang === 'ta' ? 'குரல் பதிவு' : 'Voice note'}: ${r.error}`);
        }
        const left: File[] = [];
        for (const f of attach.files) {
          const r = await uploadAttachment(leadId, f, f.name);
          if (!r.ok) {
            left.push(f);
            failures.push(`${f.name}: ${r.error}`);
          }
        }
        setAttach({ voice, files: left });
        if (failures.length) {
          setError(
            (lang === 'ta' ? 'விசாரணை சேமிக்கப்பட்டது, ஆனால் இணைக்க முடியவில்லை: ' : 'The enquiry is saved, but these could not be attached: ') +
              failures.join(' ')
          );
          return;
        }
      }

      onSuccess?.();
      onClose?.();
      // Reset form
      setPhone('');
      setCustomerName('');
      setCompanyName('');
      setTitle('');
      setCustomData({});
      setAttach({ voice: null, files: [] });
      setSavedLeadId(null);
      filledFromMaster.current = false;
      setLookup({ state: 'idle' });
    } catch (err: any) {
      setError(err?.message || (lang === 'ta' ? 'சேமிக்க முடியவில்லை.' : 'Could not save the enquiry.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0F1417]/60 backdrop-blur-xs transition-opacity" role="dialog" aria-modal="true" aria-label="New enquiry">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-surface p-5 shadow-2xl border-t sm:border border-slate-200 animate-slide-up">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Header + Tamil/English Switcher */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-foreground">
                {lang === 'ta' ? 'புதிய விசாரணை (Quick Add)' : 'New Enquiry (Quick Add)'}
              </h2>
              <span className="text-[11px] font-semibold text-brand-ink capitalize">
                {industry} {lang === 'ta' ? 'தொழில் துறை' : 'Industry'}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}
                className="rounded-lg bg-action/25 px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-action/40 transition-colors"
              >
                {lang === 'en' ? 'தமிழ்' : 'English'}
              </button>

              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  aria-label="Close enquiry"
                  className="p-1 text-slate-600 hover:text-foreground rounded-lg hover:bg-slate-100"
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
                      ? 'bg-action text-on-action shadow-sm'
                      : 'bg-surface text-foreground border border-slate-200'
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
              <label htmlFor="enquiry-field-1" className="mb-1 block text-sm font-medium text-foreground">
                {lang === 'ta' ? 'மொபைல் எண் (WhatsApp) *' : 'Mobile Number (WhatsApp) *'}
              </label>
              <input id="enquiry-field-1"
                type="tel"
                required
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 text-base font-medium text-foreground focus:border-brand-ink focus:outline-none"
              />
              {lookup.state === 'checking' && (
                <p className="mt-1 text-[11px] text-slate-600">{lang === 'ta' ? 'வாடிக்கையாளர் பட்டியலில் தேடுகிறது…' : 'Checking your customer list…'}</p>
              )}
              {lookup.state === 'invalid' && (
                <p role="alert" className="mt-1 text-[11px] font-semibold text-red-700">
                  {lang === 'ta' ? 'சரியான 10 இலக்க மொபைல் எண்ணை உள்ளிடவும்.' : 'Enter a valid 10-digit mobile number.'}
                </p>
              )}
              {lookup.state === 'error' && (
                <p className="mt-1 text-[11px] text-amber-700">
                  {lang === 'ta'
                    ? 'பட்டியலைச் சரிபார்க்க முடியவில்லை. சேமிக்கும்போது எண் தானாகப் பொருத்தப்படும்.'
                    : 'Could not check the list just now. The number is matched again when you save, so no duplicate is made.'}
                </p>
              )}
              {lookup.state === 'found' && (
                <div className="mt-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                  <p className="font-bold">
                    {lang === 'ta' ? 'ஏற்கனவே உள்ள வாடிக்கையாளர்' : 'Existing customer'}: {lookup.customer.name}
                    {lookup.matchedOn === 'CONTACT' && (
                      <span className="font-normal"> · {lang === 'ta' ? `இது ${lookup.contactName ?? 'தொடர்பு நபர்'} அவர்களின் எண்` : `this number is ${lookup.contactName ?? 'a contact'}’s, a contact of this customer`}</span>
                    )}
                    {lookup.matchedOn === 'WHATSAPP' && (
                      <span className="font-normal"> · {lang === 'ta' ? 'இது அவர்களின் WhatsApp எண்' : 'this is their WhatsApp number'} ({lookup.customer.phone})</span>
                    )}
                  </p>
                  <p>
                    {lang === 'ta'
                      ? 'பெயர் வாடிக்கையாளர் பட்டியலிலிருந்து எடுக்கப்பட்டது; புதிய பதிவு உருவாகாது.'
                      : 'Name filled from your customer list. No new customer will be added.'}
                    {lookup.customer.openEnquiries > 0 &&
                      ` ${lang === 'ta' ? `இவருக்கு ஏற்கனவே ${lookup.customer.openEnquiries} கொட்டேஷன் நிலுவை விசாரணை உள்ளது.` : `They already have ${lookup.customer.openEnquiries} enquiry waiting for a quote.`}`}
                  </p>
                </div>
              )}
              {lookup.state === 'new' && (
                <p className="mt-1.5 rounded-lg bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-900">
                  {lang === 'ta' ? 'புதிய வாடிக்கையாளர் - சேமிக்கும்போது பட்டியலில் சேர்க்கப்படுவார். பெயரை உள்ளிடவும்.' : 'New customer - they will be added to your customer list when you save. Enter their name.'}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="enquiry-field-2" className="mb-1 block text-sm font-medium text-foreground">
                {lang === 'ta' ? 'வாடிக்கையாளர் பெயர் *' : 'Customer / Contact Name *'}
              </label>
              <input id="enquiry-field-2"
                type="text"
                required
                placeholder={examples.customer[lang]}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                readOnly={lookup.state === 'found'}
                className={`min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 text-sm text-foreground focus:border-brand-ink focus:outline-none ${lookup.state === 'found' ? 'bg-slate-100' : ''}`}
              />
            </div>

            <div>
              <label htmlFor="enquiry-field-3" className="mb-1 block text-sm font-medium text-foreground">
                {lang === 'ta' ? 'நிறுவனம் / கடை பெயர்' : 'Company / Store Name'}
              </label>
              <input id="enquiry-field-3"
                type="text"
                placeholder={examples.company[lang]}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                readOnly={lookup.state === 'found'}
                className={`min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 text-sm text-foreground focus:border-brand-ink focus:outline-none ${lookup.state === 'found' ? 'bg-slate-100' : ''}`}
              />
            </div>

            <div>
              <label htmlFor="enquiry-field-4" className="mb-1 block text-sm font-medium text-foreground">
                {lang === 'ta' ? 'தேவை / ஆர்டர் விவரம் *' : 'Enquiry Summary *'}
              </label>
              <input id="enquiry-field-4"
                type="text"
                required
                placeholder={examples.enquiry[lang]}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3.5 text-sm text-foreground focus:border-brand-ink focus:outline-none"
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

          {/* Voice note + files: the person preparing the quote sees these with the enquiry */}
          <AttachmentPicker value={attach} onChange={setAttach} lang={lang} disabled={loading} />

          {/* 1-Tap Follow-Up Reminder Chips */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-slate-500">
              {lang === 'ta' ? 'கொட்டேஷன் அனுப்ப வேண்டிய நேரம்' : 'Send the quote by'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'TODAY_EVE', en: 'Today', ta: 'இன்று' },
                { id: 'TOMORROW', en: 'Tomorrow', ta: 'நாளை' },
                { id: 'THREE_DAYS', en: 'In 3 Days', ta: '3 நாட்களில்' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFollowUpPreset(chip.id as any)}
                  className={`min-h-[42px] rounded-lg text-xs font-semibold ${
                    followUpPreset === chip.id
                      ? 'bg-action text-on-action'
                      : 'bg-surface text-slate-600 border border-slate-200'
                  }`}
                >
                  {chip[lang]}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">{error}</p>
          )}

          {/* Primary Action Buttons */}
          <div className="pt-2 flex items-center space-x-3">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[48px] rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold text-foreground hover:bg-slate-100 transition-colors"
              >
                {lang === 'ta' ? 'ரத்து' : 'Cancel'}
              </button>
            )}
            <button
              type="submit"
              disabled={loading || lookup.state === 'checking' || lookup.state === 'invalid'}
              className="flex-1 min-h-[48px] rounded-xl bg-action font-semibold text-on-action shadow-md hover:bg-action/85 disabled:opacity-50 transition-colors"
            >
              {loading
                ? lang === 'ta' ? 'சேமிக்கிறது...' : 'Saving...'
                : savedLeadId
                  ? lang === 'ta' ? 'இணைப்புகளை மீண்டும் அனுப்பு' : 'Retry attachments'
                  : lang === 'ta' ? 'விசாரணையை சேமி' : 'Save Enquiry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
