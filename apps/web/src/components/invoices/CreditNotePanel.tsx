'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FilePlus2, RefreshCw } from 'lucide-react';
import { CREDIT_NOTE_REASONS, CREDIT_NOTE_REASON_LABELS, CreditNoteReason, hasPermission, TenantRole } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';
import { downloadCreditNotePdf } from '../../lib/invoice-pdf';

interface NoteSummary {
  id: string;
  creditNoteNumber: string;
  issuedAt: string;
  reasonLabel: string;
  grandTotal: string;
}

interface Prep {
  lines: Array<{
    lineNo: number;
    itemName: string;
    unit: string;
    quantity: string;
    remainingQuantity: string;
    remainingTaxableValue: string;
    remainingTotal: string;
  }>;
  creditedTotal: string;
  remainingTotal: string;
  orderBalance: string;
  creditNotes: NoteSummary[];
}

interface Preview {
  totals: { taxableValue: string; cgst: string; sgst: string; igst: string; roundOff: string; grandTotal: string };
  orderBalanceAfter?: string;
}

type Entry = { qty: string; amt: string };

const rupees = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const errorText = (body: any, status: number, fallback: string) =>
  (Array.isArray(body?.message) ? body.message.join(' ') : body?.message) || `${fallback} (${status}).`;

/**
 * Credit notes for one issued invoice: the ones already issued, and a form to issue another (goods returned,
 * a discount after the sale, a correction, or cancelling the invoice). The exact amount is worked out by the
 * server before anything is issued.
 */
export function CreditNotePanel({
  invoiceId,
  role,
  lang = 'en',
  onChanged,
}: {
  invoiceId: string;
  role: TenantRole;
  lang?: 'en' | 'ta';
  /** Called after a credit note is issued, so the invoice and order on screen can refresh. */
  onChanged?: () => void;
}) {
  const ta = lang === 'ta';
  const canCreate = hasPermission(role, 'invoice:create');
  const [prep, setPrep] = useState<Prep | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'LINES' | 'FULL'>('LINES');
  const [reason, setReason] = useState<CreditNoteReason>('SALES_RETURN');
  const [note, setNote] = useState('');
  const [entries, setEntries] = useState<Record<number, Entry>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; number: string; total: string; balanceAfter?: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/credit-notes/prepare/${invoiceId}`);
      if (res.ok) {
        setPrep(await res.json());
        setLoadError(null);
      } else if (res.status === 403) {
        // A role that can view but not issue still sees the notes
        const list = await apiFetch(`/api/credit-notes?invoiceId=${invoiceId}`);
        if (list.ok) setPrep({ lines: [], creditedTotal: '0', remainingTotal: '0', orderBalance: '0', creditNotes: (await list.json()).data });
      } else {
        setLoadError(errorText(await res.json().catch(() => ({})), res.status, 'Could not load credit notes'));
      }
    } catch {
      setLoadError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
    }
  }, [invoiceId, ta]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestBody = useCallback(
    (dryRun: boolean) => {
      if (mode === 'FULL') return { invoiceId, full: true, reason: reason === 'SALES_RETURN' ? 'CANCELLATION' : reason, note: note.trim() || undefined, dryRun };
      const lines = Object.entries(entries)
        .map(([lineNo, e]) => ({
          lineNo: Number(lineNo),
          ...(e.qty !== '' ? { quantity: Number(e.qty) } : {}),
          ...(e.amt !== '' ? { taxableAmount: Number(e.amt) } : {}),
        }))
        .filter((l) => 'quantity' in l || 'taxableAmount' in l);
      return { invoiceId, reason, note: note.trim() || undefined, lines, dryRun };
    },
    [mode, entries, reason, note, invoiceId]
  );

  const hasInput = mode === 'FULL' || Object.values(entries).some((e) => e.qty !== '' || e.amt !== '');

  // Ask the server what this credit note would be, as the person types
  useEffect(() => {
    if (!open || !hasInput) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/credit-notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody(true)) });
        const body = await res.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (res.ok) {
          setPreview(body);
          setPreviewError(null);
        } else {
          setPreview(null);
          // A missing reason or note is the person's next step, not an error to show yet
          setPreviewError(res.status === 400 ? null : errorText(body, res.status, 'Cannot credit this'));
        }
      } catch {
        if (mine === seq.current) setPreviewError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [open, hasInput, requestBody, ta]);

  const issue = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await apiFetch('/api/credit-notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody(false)) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone({ id: body.id, number: body.creditNoteNumber, total: body.totals.grandTotal, balanceAfter: body.orderBalanceAfter });
        setOpen(false);
        setEntries({});
        setNote('');
        await load();
        onChanged?.();
      } else {
        setSubmitError(errorText(body, res.status, 'Could not issue the credit note'));
        await load();
      }
    } catch {
      setSubmitError(ta ? 'சர்வரை அடைய முடியவில்லை.' : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const setEntry = (lineNo: number, key: 'qty' | 'amt', value: string) => {
    const clean = value.replace(/[^0-9.]/g, '');
    // One or the other per line: goods returned, or a value reduction
    setEntries((m) => ({ ...m, [lineNo]: key === 'qty' ? { qty: clean, amt: '' } : { qty: '', amt: clean } }));
  };

  if (!prep && !loadError) return null;
  if (loadError) return <p role="alert" className="text-xs font-semibold text-red-700">{loadError}</p>;
  if (!prep) return null;

  const nothingLeft = prep.lines.length > 0 && Number(prep.remainingTotal) <= 0;
  const needsNote = reason === 'OTHER' && !note.trim();
  const canIssue = !busy && hasInput && !!preview && !previewError && !needsNote;

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs" aria-label={ta ? 'கிரெடிட் நோட்' : 'Credit notes'}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-[#243B40]">{ta ? 'கிரெடிட் நோட்கள்' : 'Credit notes'}</h3>
        {canCreate && !open && !nothingLeft && (
          <button type="button" onClick={() => { setOpen(true); setDone(null); }} className="inline-flex items-center gap-1.5 rounded-lg bg-[#243B40] px-3 py-1.5 text-xs font-bold text-white">
            <FilePlus2 className="h-3.5 w-3.5" /> {ta ? 'கிரெடிட் நோட் உருவாக்கு' : 'Issue credit note'}
          </button>
        )}
      </div>

      {done && (
        <div role="status" className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">
          {done.number}: {rupees(done.total)} {ta ? 'கடன் வழங்கப்பட்டது.' : 'credited.'}
          {done.balanceAfter !== undefined && Number(done.balanceAfter) < 0 && (
            <span className="block text-amber-800">
              {ta ? 'வாடிக்கையாளருக்கு' : 'The customer is now in credit by'} {rupees(Math.abs(Number(done.balanceAfter)))}.
            </span>
          )}
          <button type="button" onClick={() => downloadCreditNotePdf(done.id, done.number)} className="mt-1 inline-flex items-center gap-1 text-[#167D79] underline">
            <Download className="h-3 w-3" /> PDF
          </button>
        </div>
      )}

      {prep.creditNotes.length === 0 && !open && <p className="text-xs text-slate-400">{ta ? 'இன்னும் இல்லை.' : 'None issued against this invoice.'}</p>}
      {prep.creditNotes.length > 0 && (
        <ul className="space-y-1.5">
          {prep.creditNotes.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-2 rounded-lg bg-[#F6F8F7] px-3 py-2 text-xs">
              <span className="min-w-0">
                <span className="font-bold text-[#243B40]">{n.creditNoteNumber}</span>
                <span className="ml-2 text-slate-500">
                  {new Date(n.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · {n.reasonLabel}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-bold text-[#243B40]">- {rupees(n.grandTotal)}</span>
                <button type="button" onClick={() => downloadCreditNotePdf(n.id, n.creditNoteNumber)} aria-label={`Download ${n.creditNoteNumber}`} className="text-[#167D79]">
                  <Download className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {nothingLeft && <p className="text-xs font-semibold text-slate-500">{ta ? 'இந்த விலைப்பட்டியல் முழுவதும் கடன் வழங்கப்பட்டது.' : 'This invoice has been credited in full.'}</p>}

      {open && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['LINES', ta ? 'பொருட்களைத் தேர்வு செய்' : 'Choose items'],
                ['FULL', ta ? 'முழு விலைப்பட்டியலை ரத்து செய்' : 'Cancel the whole invoice'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={`min-h-[40px] rounded-lg text-xs font-bold ${mode === k ? 'bg-[#167D79] text-white' : 'border border-slate-200 bg-white text-[#243B40]'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'LINES' && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-500">
                {ta
                  ? 'திரும்பிய அளவு அல்லது குறைக்கும் தொகை (GST க்கு முன்) - ஒரு வரிக்கு ஏதேனும் ஒன்று.'
                  : 'For each item give the quantity returned, or an amount to reduce it by (before GST). One or the other per item.'}
              </p>
              {prep.lines.map((l) => (
                <div key={l.lineNo} className="rounded-xl bg-[#F6F8F7] p-3">
                  <div className="text-xs font-bold text-[#243B40]">{l.itemName}</div>
                  <div className="text-[11px] text-slate-500">
                    {ta ? 'மீதம்' : 'Left to credit'}: {l.remainingQuantity} {l.unit} · {rupees(l.remainingTaxableValue)} {ta ? '(GST க்கு முன்)' : 'before GST'}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-[11px] font-semibold text-slate-500">
                      {ta ? 'திரும்பிய அளவு' : 'Quantity returned'}
                      <input
                        inputMode="decimal"
                        value={entries[l.lineNo]?.qty ?? ''}
                        onChange={(e) => setEntry(l.lineNo, 'qty', e.target.value)}
                        disabled={Number(l.remainingQuantity) <= 0}
                        className="mt-0.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal text-[#243B40] disabled:bg-slate-100"
                      />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-500">
                      {ta ? 'குறைக்கும் தொகை ₹' : 'Reduce value by ₹'}
                      <input
                        inputMode="decimal"
                        value={entries[l.lineNo]?.amt ?? ''}
                        onChange={(e) => setEntry(l.lineNo, 'amt', e.target.value)}
                        disabled={Number(l.remainingTaxableValue) <= 0}
                        className="mt-0.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal text-[#243B40] disabled:bg-slate-100"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
          {mode === 'FULL' && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">
              {ta ? 'மீதமுள்ள அனைத்தும் கடன் வழங்கப்படும்:' : 'Everything still left on this invoice will be credited:'} {rupees(prep.remainingTotal)}.
            </p>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-slate-500">
              {ta ? 'காரணம்' : 'Reason'}
              <select
                value={mode === 'FULL' && reason === 'SALES_RETURN' ? 'CANCELLATION' : reason}
                onChange={(e) => setReason(e.target.value as CreditNoteReason)}
                className="mt-0.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal text-[#243B40]"
              >
                {CREDIT_NOTE_REASONS.map((r) => (
                  <option key={r} value={r}>{CREDIT_NOTE_REASON_LABELS[r]}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-slate-500">
              {ta ? 'குறிப்பு' : 'Note'} {reason === 'OTHER' ? '*' : `(${ta ? 'விருப்பம்' : 'optional'})`}
              <input
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
                className="mt-0.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal text-[#243B40]"
              />
            </label>
          </div>

          {previewError && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">{previewError}</p>}
          {preview && !previewError && (
            <div className="rounded-xl bg-[#243B40] p-3 text-xs text-white">
              <div className="flex justify-between text-slate-300"><span>{ta ? 'GST க்கு முன்' : 'Taxable value'}</span><span>{rupees(preview.totals.taxableValue)}</span></div>
              {Number(preview.totals.igst) > 0 ? (
                <div className="flex justify-between text-slate-300"><span>IGST</span><span>{rupees(preview.totals.igst)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between text-slate-300"><span>CGST</span><span>{rupees(preview.totals.cgst)}</span></div>
                  <div className="flex justify-between text-slate-300"><span>SGST</span><span>{rupees(preview.totals.sgst)}</span></div>
                </>
              )}
              {Number(preview.totals.roundOff) !== 0 && <div className="flex justify-between text-slate-300"><span>{ta ? 'ரவுண்ட் ஆஃப்' : 'Round off'}</span><span>{rupees(preview.totals.roundOff)}</span></div>}
              <div className="mt-1 flex justify-between border-t border-slate-600 pt-1.5 text-sm font-bold text-[#F4B860]">
                <span>{ta ? 'கடன் தொகை' : 'Credit note total'}</span>
                <span>{rupees(preview.totals.grandTotal)}</span>
              </div>
              {preview.orderBalanceAfter !== undefined && (
                <p className="mt-1.5 text-[11px] text-slate-300">
                  {Number(preview.orderBalanceAfter) < 0
                    ? `${ta ? 'வாடிக்கையாளருக்கு கிரெடிட்' : 'Customer will be in credit by'} ${rupees(Math.abs(Number(preview.orderBalanceAfter)))}`
                    : `${ta ? 'ஆர்டரில் நிலுவை' : 'Order balance after'}: ${rupees(preview.orderBalanceAfter)}`}
                </p>
              )}
            </div>
          )}
          {needsNote && hasInput && <p className="text-[11px] font-semibold text-amber-800">{ta ? '"மற்றவை" என்பதற்கு குறிப்பு தேவை.' : 'Add a note to say what this is for.'}</p>}
          {submitError && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">{submitError}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={issue} disabled={!canIssue} className="min-h-[44px] flex-1 rounded-xl bg-[#167D79] text-sm font-bold text-white disabled:opacity-50">
              {busy ? (
                <RefreshCw className="mx-auto h-4 w-4 animate-spin" />
              ) : mode === 'FULL' ? (ta ? 'ரத்து செய்து கிரெடிட் நோட் உருவாக்கு' : 'Cancel invoice and issue credit note') : ta ? 'கிரெடிட் நோட் உருவாக்கு' : 'Issue credit note'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setSubmitError(null); }} disabled={busy} className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-[#243B40]">
              {ta ? 'மூடு' : 'Close'}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            {ta ? 'உருவாக்கிய கிரெடிட் நோட்டை மாற்றவோ நீக்கவோ முடியாது.' : 'An issued credit note cannot be edited or deleted.'}
          </p>
        </div>
      )}
    </section>
  );
}
