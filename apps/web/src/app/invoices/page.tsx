'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../../components/auth/AuthProvider';
import { apiFetch } from '../../lib/session';
import { downloadInvoicePdf, downloadCreditNotePdf } from '../../lib/invoice-pdf';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  orderId: string;
  customerName: string;
  grandTotal: string;
  balanceDue: string;
  credited: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'CREDITED';
}

interface CreditNoteRow {
  id: string;
  creditNoteNumber: string;
  issuedAt: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  reasonLabel: string;
  grandTotal: string;
}

const rupees = (v: string) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_STYLE: Record<InvoiceRow['status'], string> = {
  PAID: 'bg-emerald-50 text-emerald-800',
  PARTIAL: 'bg-amber-50 text-amber-800',
  UNPAID: 'bg-rose-50 text-rose-800',
  CREDITED: 'bg-slate-100 text-slate-600',
};

export default function InvoicesPage() {
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const [lang, setLang] = useState<'en' | 'ta'>('en');
  const ta = lang === 'ta';
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [notes, setNotes] = useState<CreditNoteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, cn] = await Promise.all([apiFetch('/api/invoices'), apiFetch('/api/credit-notes')]);
      if (cn.ok) setNotes((await cn.json()).data);
      if (res.ok) setRows((await res.json()).data);
      else {
        setRows(null);
        setError(res.status === 403 ? 'Your role cannot view invoices.' : `Could not load invoices (${res.status}).`);
      }
    } catch {
      setRows(null);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [tenantId, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-[#243B40]">{ta ? 'GST விலைப்பட்டியல்கள்' : 'GST invoices'}</h1>
          <p className="text-xs text-slate-500">{ta ? 'ஆர்டர் பக்கத்திலிருந்து விலைப்பட்டியல் உருவாக்கலாம்.' : 'Issue an invoice from an order’s page.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setLang(ta ? 'en' : 'ta')} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600">{ta ? 'EN' : 'தமிழ்'}</button>
          <button type="button" onClick={load} aria-label={ta ? 'புதுப்பி' : 'Refresh'} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">{error}</div>}
      {!error && loading && !rows && <div className="rounded-2xl bg-white p-10 text-center text-sm text-slate-400">{ta ? 'ஏற்றுகிறது…' : 'Loading…'}</div>}

      {rows && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          {ta ? 'இன்னும் விலைப்பட்டியல் எதுவும் இல்லை.' : 'No invoices issued yet.'}
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#243B40]">{r.invoiceNumber}</div>
                <div className="truncate text-xs text-slate-500">
                  {r.customerName} · {new Date(r.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-extrabold text-[#243B40]">{rupees(r.grandTotal)}</div>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[r.status]}`}>
                  {r.status === 'CREDITED'
                    ? ta ? 'கிரெடிட் செய்யப்பட்டது' : 'Credited in full'
                    : r.status === 'PAID' ? (ta ? 'செலுத்தப்பட்டது' : 'Paid') : r.status === 'PARTIAL' ? `${ta ? 'நிலுவை' : 'Due'} ${rupees(r.balanceDue)}` : ta ? 'செலுத்தவில்லை' : 'Unpaid'}
                </span>
                {Number(r.credited) > 0 && r.status !== 'CREDITED' && (
                  <div className="mt-0.5 text-[10px] font-semibold text-amber-800">{ta ? 'கிரெடிட்' : 'Credit notes'} - {rupees(r.credited)}</div>
                )}
              </div>
              <div className="flex w-full items-center gap-3 text-xs font-semibold">
                <Link href={`/orders/${r.orderId}`} className="text-[#167D79] hover:underline">{ta ? 'ஆர்டர்' : 'Open order'}</Link>
                <button
                  type="button"
                  onClick={async () => {
                    const msg = await downloadInvoicePdf(r.id, r.invoiceNumber);
                    if (msg) setError(msg);
                  }}
                  className="inline-flex items-center gap-1 text-[#167D79] hover:underline"
                >
                  <Download className="w-3 h-3" /> PDF
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {notes.length > 0 && (
        <div className="space-y-2 pt-2">
          <h2 className="text-sm font-extrabold text-[#243B40]">{ta ? 'கிரெடிட் நோட்கள்' : 'Credit notes'}</h2>
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#243B40]">{n.creditNoteNumber}</div>
                  <div className="truncate text-xs text-slate-500">
                    {n.customerName} · {new Date(n.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · {n.reasonLabel} · {ta ? 'விலைப்பட்டியல்' : 'against'} {n.invoiceNumber}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-sm font-extrabold text-[#243B40]">- {rupees(n.grandTotal)}</div>
                  <button
                    type="button"
                    onClick={async () => {
                      const msg = await downloadCreditNotePdf(n.id, n.creditNoteNumber);
                      if (msg) setError(msg);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#167D79] hover:underline"
                  >
                    <Download className="w-3 h-3" /> PDF
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
