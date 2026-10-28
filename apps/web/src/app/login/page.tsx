'use client';
import { useLocale } from '../../components/shared/LocaleProvider';

import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../components/auth/AuthProvider';

const RESEND_SECONDS = 60;

const COPY = {
  en: {
    title: 'Sign in',
    subtitle: 'Use the mobile number your business registered with.',
    phone: 'Mobile number',
    send: 'Send code',
    sending: 'Sending…',
    codeSent: 'We sent a 6-digit code to',
    code: '6-digit code',
    verify: 'Sign in',
    verifying: 'Checking…',
    change: 'Change number',
    resend: 'Resend code',
    resendIn: 'Resend in',
    badPhone: 'Enter a 10-digit mobile number.',
    badCode: 'Enter the 6-digit code.',
    devCode: 'Development mode, no SMS sent. Your code:',
    toggle: 'தமிழ்',
  },
  ta: {
    title: 'உள்நுழைக',
    subtitle: 'உங்கள் நிறுவனம் பதிவு செய்த மொபைல் எண்ணைப் பயன்படுத்தவும்.',
    phone: 'மொபைல் எண்',
    send: 'குறியீட்டை அனுப்பு',
    sending: 'அனுப்புகிறது…',
    codeSent: '6 இலக்க குறியீடு அனுப்பப்பட்டது:',
    code: '6 இலக்க குறியீடு',
    verify: 'உள்நுழைக',
    verifying: 'சரிபார்க்கிறது…',
    change: 'எண்ணை மாற்று',
    resend: 'மீண்டும் அனுப்பு',
    resendIn: 'மீண்டும் அனுப்ப',
    badPhone: '10 இலக்க மொபைல் எண்ணை உள்ளிடவும்.',
    badCode: '6 இலக்க குறியீட்டை உள்ளிடவும்.',
    devCode: 'சோதனை முறை, SMS அனுப்பப்படவில்லை. உங்கள் குறியீடு:',
    toggle: 'English',
  },
} as const;

export default function LoginPage() {
  const { requestOtp, verifyOtp } = useAuth();
  const [lang, setLang] = useLocale();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const c = COPY[lang];

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  const digits = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (digits.length !== 10) {
      setError(c.badPhone);
      return;
    }
    setBusy(true);
    try {
      setDevCode((await requestOtp(digits)) ?? null);
      setStep('code');
      setCode('');
      setWait(RESEND_SECONDS);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError(c.badCode);
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(digits, code);
      // AuthProvider moves the user on to the app once the profile has loaded
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface text-foreground flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand-ink">Friendly CRM</span>
          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}
            className="min-h-[36px] rounded-lg bg-action/25 px-3 text-xs font-bold hover:bg-action/40 transition-colors"
          >
            {c.toggle}
          </button>
        </div>

        <div className="rounded-2xl bg-surface border border-slate-200 shadow-sm p-5">
          <h1 className="text-xl font-black tracking-tight">{c.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{c.subtitle}</p>

          {step === 'phone' ? (
            <form onSubmit={send} className="mt-5 space-y-4" noValidate>
              <div>
                <label htmlFor="phone" className="block text-xs font-bold mb-1.5">
                  {c.phone}
                </label>
                <div className="flex items-stretch rounded-xl border border-slate-300 focus-within:border-brand-ink focus-within:ring-2 focus-within:ring-[#02937B]/20 overflow-hidden bg-surface">
                  <span className="flex items-center px-3 text-sm font-semibold text-slate-500 bg-slate-50 border-r border-slate-200">
                    +91
                  </span>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    autoFocus
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="98765 43210"
                    className="w-full min-h-[48px] px-3 text-base outline-none"
                  />
                </div>
              </div>
              {error && (
                <p role="alert" className="text-sm font-semibold text-red-700">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[48px] rounded-xl bg-action text-on-action font-bold hover:bg-action/85 disabled:opacity-60 transition-colors"
              >
                {busy ? c.sending : c.send}
              </button>
            </form>
          ) : (
            <form onSubmit={verify} className="mt-5 space-y-4" noValidate>
              <p className="text-sm text-slate-600">
                {c.codeSent} <span className="font-bold text-foreground">+91 {digits}</span>
              </p>
              {devCode && (
                <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
                  {c.devCode} <span className="font-bold tracking-widest">{devCode}</span>
                </p>
              )}
              <div>
                <label htmlFor="code" className="block text-xs font-bold mb-1.5">
                  {c.code}
                </label>
                <input
                  ref={codeRef}
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="w-full min-h-[52px] rounded-xl border border-slate-300 px-3 text-center text-2xl font-bold tracking-[0.5em] outline-none focus:border-brand-ink focus:ring-2 focus:ring-[#02937B]/20"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm font-semibold text-red-700">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[48px] rounded-xl bg-action text-on-action font-bold hover:bg-action/85 disabled:opacity-60 transition-colors"
              >
                {busy ? c.verifying : c.verify}
              </button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setError(null);
                  }}
                  className="min-h-[44px] font-semibold text-brand-ink hover:underline"
                >
                  {c.change}
                </button>
                <button
                  type="button"
                  disabled={wait > 0 || busy}
                  onClick={() => send()}
                  className="min-h-[44px] font-semibold text-brand-ink hover:underline disabled:text-slate-600 disabled:no-underline"
                >
                  {wait > 0 ? `${c.resendIn} ${wait}s` : c.resend}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
