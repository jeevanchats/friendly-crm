'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../lib/session';

export interface SimilarMatch {
  id: string;
  name: string;
  companyName?: string | null;
  phone?: string;
  gstin?: string | null;
  code?: string | null;
  description?: string | null;
  hsnCode?: string | null;
  taxPercent?: string;
  unit?: string;
  unitPrice?: string;
  isActive?: boolean;
  reason: 'gstin' | 'code' | 'same-name' | 'similar-name';
  score: number;
}

/**
 * Looks up records that resemble what is being typed (after a short pause). It is only a warning aid, so a failed
 * lookup just shows nothing.
 */
export function useSimilar(path: string, params: Record<string, string>, enabled: boolean): SimilarMatch[] {
  return useSimilarWithAi(path, params, enabled).matches;
}

/** Same lookup, also saying whether an AI second opinion is set up on the server. */
export function useSimilarWithAi(path: string, params: Record<string, string>, enabled: boolean): { matches: SimilarMatch[]; ai: boolean } {
  const [matches, setMatches] = useState<SimilarMatch[]>([]);
  const [ai, setAi] = useState(false);
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();

  useEffect(() => {
    if (!enabled) {
      setMatches([]);
      setAi(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`${path}?${query}`, { signal: controller.signal });
        if (res.ok && !controller.signal.aborted) {
          const body = (await res.json()) as { matches?: SimilarMatch[]; ai?: boolean };
          setMatches(body.matches ?? []);
          setAi(body.ai === true);
        }
      } catch {
        /* a warning aid: stay quiet when it cannot be reached */
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, query, enabled]);

  return { matches, ai };
}

export interface AiReview {
  available: boolean;
  state: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  verdicts: Record<string, { verdict: 'same' | 'different' | 'unsure'; reason: string }>;
  run: () => void;
}

/**
 * The AI second opinion on the matches shown. Only runs when the person presses the button (it costs a call), and
 * starts over whenever the matches or what was typed change. It advises; nothing is decided by it.
 */
export function useAiReview(path: string, body: Record<string, string>, matches: SimilarMatch[], available: boolean, ta: boolean): AiReview {
  const [state, setState] = useState<AiReview['state']>('idle');
  const [verdicts, setVerdicts] = useState<AiReview['verdicts']>({});
  const [error, setError] = useState<string | undefined>();
  const key = `${matches.map((m) => m.id).join(',')}|${JSON.stringify(body)}`;

  useEffect(() => {
    setState('idle');
    setVerdicts({});
    setError(undefined);
  }, [key]);

  const run = async () => {
    setState('loading');
    setError(undefined);
    try {
      const res = await apiFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { matches?: Array<SimilarMatch & { verdict?: 'same' | 'different' | 'unsure'; reason?: string }>; message?: string };
      if (!res.ok) {
        setError(typeof json.message === 'string' ? json.message : ta ? 'AI சரிபார்ப்பு இப்போது கிடைக்கவில்லை.' : 'The AI check is not available right now.');
        setState('error');
        return;
      }
      const map: AiReview['verdicts'] = {};
      for (const m of json.matches ?? []) if (m.verdict) map[m.id] = { verdict: m.verdict, reason: m.reason ?? '' };
      setVerdicts(map);
      setState('done');
    } catch {
      setError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
      setState('error');
    }
  };

  return { available: available && matches.length > 0, state, error, verdicts, run: () => void run() };
}

const VERDICT: Record<'same' | 'different' | 'unsure', { en: string; ta: string; style: string }> = {
  same: { en: 'AI: probably the same', ta: 'AI: ஒன்றாக இருக்கலாம்', style: 'bg-rose-100 text-rose-900' },
  different: { en: 'AI: looks different', ta: 'AI: வேறு போல் தெரிகிறது', style: 'bg-emerald-100 text-emerald-900' },
  unsure: { en: 'AI: not sure', ta: 'AI: உறுதியில்லை', style: 'bg-slate-200 text-slate-800' },
};

const REASON: Record<SimilarMatch['reason'], { en: string; ta: string }> = {
  gstin: { en: 'Same GSTIN', ta: 'அதே GSTIN' },
  code: { en: 'Same code', ta: 'அதே குறியீடு' },
  'same-name': { en: 'Same name', ta: 'அதே பெயர்' },
  'similar-name': { en: 'Similar name', ta: 'ஒத்த பெயர்' },
};

/** "This may already exist": the matches, and for customers a tick to confirm it really is a different one. */
export function SimilarMatches({
  kind,
  matches,
  ta,
  confirmed,
  onConfirm,
  review,
}: {
  kind: 'customer' | 'product';
  matches: SimilarMatch[];
  ta: boolean;
  /** Offer an AI second opinion on these matches (only when the server has one set up). */
  review?: AiReview;
  /** Customers only: shown when a match is certain enough to ask the person to confirm. */
  confirmed?: boolean;
  onConfirm?: (v: boolean) => void;
}) {
  if (matches.length === 0) return null;
  const needsConfirm = kind === 'customer' && !!onConfirm && matches.some((m) => m.reason === 'same-name') && !matches.some((m) => m.reason === 'gstin');
  return (
    <div role="status" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      <p className="flex items-center gap-1.5 font-bold">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {kind === 'customer'
          ? ta ? 'இவர் ஏற்கனவே வாடிக்கையாளராக இருக்கலாம்' : 'This may already be a customer'
          : ta ? 'ஒத்த பொருட்கள் ஏற்கனவே உள்ளன' : 'Similar products already exist'}
      </p>
      <ul className="space-y-1.5">
        {matches.map((m) => (
          <li key={m.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface/70 px-2.5 py-1.5">
            <span className="min-w-0">
              <span className="font-semibold">{m.name}</span>
              {m.isActive === false && <span className="ml-1 text-slate-600">({ta ? 'காப்பகம்' : 'archived'})</span>}
              {review?.verdicts[m.id] && (
                <span className="mt-0.5 block text-[11px]">
                  <span className={`mr-1 inline-block rounded-full px-2 py-0.5 font-bold ${VERDICT[review.verdicts[m.id].verdict].style}`}>
                    {VERDICT[review.verdicts[m.id].verdict][ta ? 'ta' : 'en']}
                  </span>
                  {review.verdicts[m.id].reason}
                </span>
              )}
              <span className="block text-[11px] text-slate-700">
                {[
                  REASON[m.reason][ta ? 'ta' : 'en'],
                  m.companyName,
                  m.phone,
                  m.gstin,
                  m.code,
                  m.unitPrice != null ? `₹${Number(m.unitPrice)}${m.unit ? ` / ${m.unit}` : ''}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {kind === 'customer' && (
              <Link href={`/customers/${m.id}`} className="shrink-0 font-bold text-brand-ink underline">
                {ta ? 'திற' : 'Open'}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {review?.available && review.state !== 'done' && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={review.run}
            disabled={review.state === 'loading'}
            className="rounded-md border border-amber-500 bg-surface px-2.5 py-1 font-bold text-brand-ink disabled:opacity-60"
          >
            {review.state === 'loading' ? (ta ? 'ஒப்பிடுகிறது…' : 'Comparing…') : ta ? 'AI-யிடம் ஒப்பிடக் கேள்' : 'Ask AI to compare'}
          </button>
          <span className="block text-[11px] text-slate-700">
            {ta ? 'AI ஆலோசனை மட்டுமே; முடிவு உங்களுடையது. பெயர்கள் (மற்றும் GST மாநிலம்) மட்டுமே அனுப்பப்படும்.' : 'The AI only advises; you decide. Only names (and the GST state) are sent.'}
          </span>
          {review.state === 'error' && review.error && <span role="alert" className="block font-semibold text-red-700">{review.error}</span>}
        </div>
      )}
      {kind === 'customer' && (
        <p className="text-[11px]">
          {matches.some((m) => m.reason === 'gstin')
            ? ta
              ? 'ஒரு GSTIN-க்கு ஒரு வாடிக்கையாளர் மட்டுமே. அதே வணிகத்தின் மற்றொரு நபர் என்றால், இருக்கும் வாடிக்கையாளரைத் திறந்து தொடர்பாகச் சேர்க்கவும்.'
              : 'One GSTIN, one customer. If this is another person at the same business, open the existing customer and add them as a contact.'
            : ta
              ? 'அதே வணிகத்தின் மற்றொரு நபர் என்றால், புதிதாகச் சேர்க்காமல் இருக்கும் வாடிக்கையாளரைத் திறந்து தொடர்பாகச் சேர்க்கவும்.'
              : 'If this is another person at the same business, open the existing customer and add them as a contact instead of adding a new one.'}
        </p>
      )}
      {kind === 'product' && matches.some((m) => m.isActive === false) && (
        <p className="text-[11px]">{ta ? 'காப்பகத்தில் உள்ள பொருளை பொருள் பட்டியலிலிருந்து மீட்டெடுக்கலாம்.' : 'An archived product can be restored from the product list.'}</p>
      )}
      {needsConfirm && (
        <label className="flex items-start gap-2 font-semibold">
          <input type="checkbox" className="mt-0.5" checked={!!confirmed} onChange={(e) => onConfirm!(e.target.checked)} />
          {ta ? 'இது வேறு வாடிக்கையாளர் (எ.கா. மற்றொரு கிளை)' : 'This is a different customer (for example another branch)'}
        </label>
      )}
    </div>
  );
}
