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
  const [matches, setMatches] = useState<SimilarMatch[]>([]);
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();

  useEffect(() => {
    if (!enabled) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`${path}?${query}`, { signal: controller.signal });
        if (res.ok && !controller.signal.aborted) setMatches(((await res.json()) as { matches?: SimilarMatch[] }).matches ?? []);
      } catch {
        /* a warning aid: stay quiet when it cannot be reached */
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, query, enabled]);

  return matches;
}

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
}: {
  kind: 'customer' | 'product';
  matches: SimilarMatch[];
  ta: boolean;
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
