'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Download, RefreshCw } from 'lucide-react';
import { GST_STATES, hasPermission, isValidHsn, TenantRole } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';
import { downloadInvoicePdf } from '../../lib/invoice-pdf';
import { CreditNotePanel } from './CreditNotePanel';
import { EwayBillPanel } from './EwayBillPanel';

interface PreparedLine {
  orderItemId: string;
  itemName: string;
  hsnCode: string | null;
  suggestedHsn: string | null;
  quantity: string;
  unit: string;
}

interface Preparation {
  problems: string[];
  existingInvoice: { id: string; invoiceNumber: string } | null;
  replaces?: { id: string; invoiceNumber: string } | null;
  placeOfSupply: { stateCode: string; stateName: string; source: string } | null;
  lines: PreparedLine[];
  preview: { taxableValue: string; cgst: string; sgst: string; igst: string; roundOff: string; grandTotal: string } | null;
}

interface IssuedInvoice {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  totals: { grandTotal: string };
  lines?: Array<{ hsnCode: string }>;
  credited?: string;
  netTotal?: string;
  payment: { status: string; customerCredit?: string };
}

const rupees = (v: string) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function IssueInvoicePanel({ orderId, role, lang = 'en' }: { orderId: string; role: TenantRole; lang?: 'en' | 'ta' }) {
  const ta = lang === 'ta';
  const canView = hasPermission(role, 'invoice:view');
  const canCreate = hasPermission(role, 'invoice:create');

  const [invoice, setInvoice] = useState<IssuedInvoice | null>(null);
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const [prep, setPrep] = useState<Preparation | null>(null);
  const [hsn, setHsn] = useState<Record<string, string>>({});
  const [place, setPlace] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadExisting = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/invoices/by-order/${orderId}`);
      setInvoice(res.ok ? await res.json() : null);
    } catch {
      setInvoice(null);
    } finally {
      setChecked(true);
    }
  }, [orderId]);

  useEffect(() => {
    if (canView || canCreate) loadExisting();
    else setChecked(true);
  }, [canView, canCreate, loadExisting]);

  /** Asks the server what is missing and what would be charged, given the HSN codes and place typed so far. */
  const prepare = useCallback(
    async (nextHsn: Record<string, string>, nextPlace: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const res = await apiFetch('/api/invoices/prepare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId, hsn: nextHsn, placeOfSupply: nextPlace || undefined }),
        });
        if (!res.ok) {
          setPrep(null);
          setMessage(res.status === 403 ? (ta ? 'இந்தப் பங்கிற்கு அனுமதி இல்லை.' : 'Your role cannot issue invoices.') : `Could not prepare the invoice (${res.status}).`);
          return;
        }
        const p: Preparation = await res.json();
        setPrep(p);
        if (!nextPlace && p.placeOfSupply) setPlace(p.placeOfSupply.stateCode);
      } catch {
        setPrep(null);
        setMessage(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
      } finally {
        setBusy(false);
      }
    },
    [orderId, ta]
  );

  const start = () => {
    setOpen(true);
    prepare({}, '');
  };

  const setLineHsn = (id: string, value: string) => {
    const next = { ...hsn, [id]: value.replace(/\D/g, '').slice(0, 8) };
    setHsn(next);
    // Ask the server again once every typed code is complete, so the preview and problems stay honest.
    if (Object.values(next).every((v) => v === '' || isValidHsn(v))) prepare(compact(next), place);
  };

  const compact = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== ''));

  const issue = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/invoices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, hsn: compact(hsn), placeOfSupply: place || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setInvoice(body);
        setOpen(false);
      } else if (res.status === 409) {
        setMessage(body.message || 'This order already has an invoice.');
        await loadExisting();
        setOpen(false);
      } else if (res.status === 422) {
        setMessage((body.problems || [body.message]).join(' '));
        await prepare(compact(hsn), place);
      } else {
        setMessage(body.message || `Could not issue the invoice (${res.status}).`);
      }
    } catch {
      setMessage(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!invoice) return;
    setMessage(await downloadInvoicePdf(invoice.id, invoice.invoiceNumber));
  };

  if (!checked || (!canView && !canCreate)) return null;

  // ---- already invoiced (and not cancelled)
  if (invoice && invoice.payment.status !== 'CREDITED') {
    return (
      <div className="space-y-3">
      <section className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-xs space-y-2" aria-label={ta ? 'GST விலைப்பட்டியல்' : 'GST invoice'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-extrabold text-foreground">
            <FileText className="w-4 h-4 text-brand-ink" />
            {invoice.invoiceNumber}
          </div>
          <span className="rounded-full bg-action/10 px-2 py-0.5 text-[10px] font-bold text-brand-ink">
            {invoice.payment.status}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {new Date(invoice.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · {rupees(invoice.totals.grandTotal)}
          {Number(invoice.credited ?? 0) > 0 && (
            <span className="ml-1 font-semibold text-amber-800">
              · {ta ? 'கிரெடிட்' : 'credited'} {rupees(invoice.credited as string)} → {ta ? 'நிகரம்' : 'net'} {rupees(invoice.netTotal ?? '0')}
            </span>
          )}
          {Number(invoice.payment.customerCredit ?? 0) > 0 && (
            <span className="block font-semibold text-amber-800">
              {ta ? 'வாடிக்கையாளருக்கு கிரெடிட்' : 'Customer is in credit by'} {rupees(invoice.payment.customerCredit as string)}
            </span>
          )}
        </div>
        <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg bg-action px-3 py-1.5 text-xs font-bold text-on-action">
          <Download className="w-3.5 h-3.5" />
          {ta ? 'PDF பதிவிறக்கு' : 'Download PDF'}
        </button>
        {message && <p role="alert" className="text-xs font-semibold text-red-700">{message}</p>}
      </section>
      <EwayBillPanel invoiceId={invoice.id} role={role} lang={lang} amount={Number(invoice.netTotal ?? invoice.totals.grandTotal)} hsnCodes={(invoice.lines ?? []).map((l) => l.hsnCode)} />
      <CreditNotePanel invoiceId={invoice.id} role={role} lang={lang} onChanged={loadExisting} />
      </div>
    );
  }

  // ---- the invoice was cancelled in full by a credit note: it stays on record, and a corrected one can replace it
  if (invoice && !open) {
    return (
      <div className="space-y-3">
        <section className="space-y-2 rounded-2xl border border-slate-200 bg-surface p-4 shadow-xs" aria-label={ta ? 'ரத்தான GST விலைப்பட்டியல்' : 'Cancelled GST invoice'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-extrabold text-slate-500 line-through">
              <FileText className="w-4 h-4" />
              {invoice.invoiceNumber}
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{ta ? 'ரத்து செய்யப்பட்டது' : 'Cancelled'}</span>
          </div>
          <p className="text-xs text-slate-500">
            {ta
              ? 'இந்த விலைப்பட்டியல் கிரெடிட் நோட் மூலம் முழுவதும் ரத்து செய்யப்பட்டது. தவறை திருத்தி புதிய விலைப்பட்டியல் உருவாக்கலாம்.'
              : 'This invoice was cancelled in full by a credit note. Correct what was wrong (GSTIN, HSN, place of supply) and issue a new invoice for the order.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canCreate && (
              <button type="button" onClick={start} className="inline-flex items-center gap-1.5 rounded-lg bg-surface border border-slate-200 px-3 py-1.5 text-xs font-bold text-brand-ink">
                <FileText className="w-3.5 h-3.5" />
                {ta ? 'திருத்திய விலைப்பட்டியல் உருவாக்கு' : 'Issue corrected invoice'}
              </button>
            )}
            <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-surface px-3 py-1.5 text-xs font-bold text-foreground">
              <Download className="w-3.5 h-3.5" />
              {ta ? 'பழைய PDF' : 'Old invoice PDF'}
            </button>
          </div>
          {message && <p role="alert" className="text-xs font-semibold text-red-700">{message}</p>}
        </section>
        <CreditNotePanel invoiceId={invoice.id} role={role} lang={lang} onChanged={loadExisting} />
      </div>
    );
  }

  if (!canCreate) return null;

  // ---- not invoiced yet
  if (!open) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-surface p-4 space-y-2">
        <button type="button" onClick={start} className="inline-flex items-center gap-1.5 rounded-lg bg-surface border border-slate-200 px-3 py-1.5 text-xs font-bold text-brand-ink">
          <FileText className="w-3.5 h-3.5" />
          {ta ? 'GST விலைப்பட்டியல் உருவாக்கு' : 'Issue GST invoice'}
        </button>
        {message && <p role="alert" className="text-xs font-semibold text-red-700">{message}</p>}
      </section>
    );
  }

  const settingsProblems = prep?.problems.filter((p) => /Settings/.test(p)) ?? [];
  const otherProblems = prep?.problems.filter((p) => !/Settings/.test(p) && !/^Enter an HSN/.test(p)) ?? [];
  const hsnReady = prep ? prep.lines.every((l) => isValidHsn(hsn[l.orderItemId] ?? l.hsnCode ?? '')) : false;
  const canIssue = !!prep && !busy && settingsProblems.length === 0 && otherProblems.length === 0 && hsnReady;

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-xs space-y-4" aria-label={ta ? 'GST விலைப்பட்டியல் உருவாக்கு' : 'Issue GST invoice'}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-foreground">{ta ? 'GST விலைப்பட்டியல்' : 'Issue GST invoice'}</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-slate-500">{ta ? 'மூடு' : 'Cancel'}</button>
      </div>

      {prep?.replaces && (
        <p className="rounded-xl bg-sky-50 p-3 text-xs font-semibold text-sky-900">
          {ta
            ? `இது ரத்தான விலைப்பட்டியல் ${prep.replaces.invoiceNumber} க்கு பதிலாக வரும். வெளியிட்டதும் ஆர்டர் தொகை மீண்டும் சேர்க்கப்படும்.`
            : `This replaces the cancelled invoice ${prep.replaces.invoiceNumber}. The order's total is restored when you issue it, and any payment already received counts towards it.`}
        </p>
      )}

      {!prep && busy && <p className="text-xs text-slate-600"><RefreshCw className="inline w-3 h-3 animate-spin" /> {ta ? 'ஏற்றுகிறது…' : 'Checking…'}</p>}

      {(settingsProblems.length > 0 || otherProblems.length > 0) && (
        <ul role="alert" className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {[...settingsProblems, ...otherProblems].map((p) => (
            <li key={p}>• {p}</li>
          ))}
          {settingsProblems.length > 0 && (
            <li>
              <Link href="/settings" className="text-brand-ink underline">{ta ? 'அமைப்புகளைத் திற' : 'Open Settings'}</Link>
            </li>
          )}
        </ul>
      )}

      {prep && (
        <>
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{ta ? 'HSN / SAC குறியீடு' : 'HSN / SAC code per item'}</div>
            {prep.lines.map((l) => (
              <div key={l.orderItemId} className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{l.itemName}</div>
                <input
                  inputMode="numeric"
                  aria-label={`HSN for ${l.itemName}`}
                  value={hsn[l.orderItemId] ?? l.hsnCode ?? ''}
                  onChange={(e) => setLineHsn(l.orderItemId, e.target.value)}
                  placeholder="e.g. 4910"
                  className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                />
                {l.suggestedHsn && !(hsn[l.orderItemId] ?? l.hsnCode) && (
                  <button type="button" onClick={() => setLineHsn(l.orderItemId, l.suggestedHsn!)} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">
                    {ta ? 'பயன்படுத்து' : 'Use'} {l.suggestedHsn}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <label htmlFor="pos" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {ta ? 'வழங்கல் இடம்' : 'Place of supply'}
            </label>
            <select
              id="pos"
              value={place}
              onChange={(e) => {
                setPlace(e.target.value);
                prepare(compact(hsn), e.target.value);
              }}
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            >
              {Object.entries(GST_STATES).map(([code, name]) => (
                <option key={code} value={code}>{code} - {name}</option>
              ))}
            </select>
            {prep.placeOfSupply?.source === 'DEFAULT_SUPPLIER_STATE' && (
              <p className="text-[11px] text-amber-700">
                {ta
                  ? 'வாடிக்கையாளரின் மாநிலம் தெரியாததால் உங்கள் மாநிலமே எடுக்கப்பட்டது. வேறு மாநிலமானால் மாற்றவும் (IGST).'
                  : 'The customer’s state is not on file, so your own state is assumed. Change it if they are elsewhere (IGST applies).'}
              </p>
            )}
          </div>

          {prep.preview && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-slate-50 p-3 text-xs">
              <dt className="text-slate-500">{ta ? 'வரிக்குட்பட்ட மதிப்பு' : 'Taxable value'}</dt>
              <dd className="text-right font-semibold">{rupees(prep.preview.taxableValue)}</dd>
              {Number(prep.preview.igst) > 0 ? (
                <>
                  <dt className="text-slate-500">IGST</dt>
                  <dd className="text-right font-semibold">{rupees(prep.preview.igst)}</dd>
                </>
              ) : (
                <>
                  <dt className="text-slate-500">CGST</dt>
                  <dd className="text-right font-semibold">{rupees(prep.preview.cgst)}</dd>
                  <dt className="text-slate-500">SGST</dt>
                  <dd className="text-right font-semibold">{rupees(prep.preview.sgst)}</dd>
                </>
              )}
              {Number(prep.preview.roundOff) !== 0 && (
                <>
                  <dt className="text-slate-500">{ta ? 'முழுமையாக்கல்' : 'Round off'}</dt>
                  <dd className="text-right font-semibold">{rupees(prep.preview.roundOff)}</dd>
                </>
              )}
              <dt className="font-bold text-foreground">{ta ? 'மொத்தம்' : 'Total'}</dt>
              <dd className="text-right font-extrabold text-foreground">{rupees(prep.preview.grandTotal)}</dd>
            </dl>
          )}

          <p className="text-[11px] text-slate-500">
            {ta
              ? 'வெளியிட்ட பின் விலைப்பட்டியலை மாற்ற முடியாது.'
              : 'An issued invoice cannot be edited or deleted. Check the details before issuing.'}
          </p>
          <button
            type="button"
            disabled={!canIssue}
            onClick={issue}
            className="rounded-lg bg-action px-4 py-2 text-xs font-bold text-on-action disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (ta ? 'காத்திருக்கவும்…' : 'Working…') : ta ? 'விலைப்பட்டியல் வெளியிடு' : 'Issue invoice'}
          </button>
        </>
      )}
      {message && <p role="alert" className="text-xs font-semibold text-red-700">{message}</p>}
    </section>
  );
}
