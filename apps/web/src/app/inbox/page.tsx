'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, Phone, RefreshCw, IndianRupee } from 'lucide-react';
import { hasPermission } from '@friendly-crm/shared';
import { useAuth } from '../../components/auth/AuthProvider';
import { apiFetch } from '../../lib/session';

interface ChangeRequest {
  quotationId: string;
  quoteNumber: string;
  version: number;
  customerName: string;
  customerPhone: string;
  request: string;
  requestedAt: string;
  grandTotal: string | null;
}

interface AwaitingPayment {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  totalAmount: string | null;
  balanceDue: string | null;
  approvedAt: string;
}

interface Inbox {
  changeRequests: ChangeRequest[];
  awaitingPayment: AwaitingPayment[];
}

const rupees = (v: string | null) =>
  v === null ? '' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

/** wa.me wants digits only, with the country code. */
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

export default function InboxPage() {
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const canRevise = hasPermission(active!.role, 'quote:update');
  const [lang, setLang] = useState<'en' | 'ta'>('en');
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/sales/inbox');
      if (res.ok) {
        setInbox(await res.json());
      } else {
        setInbox(null);
        setError(res.status === 403 ? 'Your role cannot view quotes.' : `Could not load the inbox (${res.status}).`);
      }
    } catch {
      setInbox(null);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [tenantId, load]);

  const ta = lang === 'ta';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-[#243B40]">{ta ? 'வாடிக்கையாளர் செய்திகள்' : 'Customer inbox'}</h1>
          <p className="text-xs text-slate-500">
            {ta
              ? 'WhatsApp வழியாக வாடிக்கையாளர்கள் கேட்ட மாற்றங்களும், பணம் வராத ஆர்டர்களும்.'
              : 'Changes customers asked for on WhatsApp, and approved orders still waiting for payment.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLang(ta ? 'en' : 'ta')}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600"
          >
            {ta ? 'EN' : 'தமிழ்'}
          </button>
          <button
            type="button"
            onClick={load}
            aria-label={ta ? 'புதுப்பி' : 'Refresh'}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {!error && loading && !inbox && (
        <div className="rounded-2xl bg-white p-10 text-center text-sm font-semibold text-slate-400">
          {ta ? 'ஏற்றுகிறது…' : 'Loading…'}
        </div>
      )}

      {inbox && (
        <>
          <section aria-labelledby="changes-h" className="space-y-3">
            <h2 id="changes-h" className="flex items-center gap-2 text-sm font-extrabold text-[#243B40]">
              <MessageSquare className="w-4 h-4 text-[#167D79]" />
              {ta ? 'மாற்றம் கேட்ட விலைப்புள்ளிகள்' : 'Quotes with change requests'}
              <span className="rounded-full bg-[#167D79]/10 px-2 py-0.5 text-xs text-[#167D79]">
                {inbox.changeRequests.length}
              </span>
            </h2>
            {inbox.changeRequests.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-400">
                {ta ? 'நிலுவையில் மாற்றக் கோரிக்கைகள் இல்லை.' : 'No open change requests.'}
              </p>
            ) : (
              inbox.changeRequests.map((c) => (
                <article key={c.quotationId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-[#243B40]">
                      {c.customerName} <span className="font-medium text-slate-400">· {c.quoteNumber} v{c.version}</span>
                    </div>
                    <div className="text-xs text-slate-400">{ago(c.requestedAt)}</div>
                  </div>
                  <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 whitespace-pre-wrap break-words">{c.request}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                    {c.grandTotal !== null && <span className="text-slate-600">{rupees(c.grandTotal)}</span>}
                    <Link href={`/q/${c.quotationId}/pdf`} className="text-[#167D79] hover:underline">
                      {ta ? 'விலைப்புள்ளி' : 'View quote'}
                    </Link>
                    {canRevise && (
                      <Link
                        href={`/quotations/revise?quoteId=${c.quotationId}`}
                        className="rounded-lg bg-[#167D79] px-2.5 py-1 text-white hover:bg-[#126360]"
                      >
                        {ta ? 'திருத்தி அனுப்பு' : 'Revise quote'}
                      </Link>
                    )}
                    {c.customerPhone && (
                      <a href={waLink(c.customerPhone)} target="_blank" rel="noopener noreferrer" className="text-[#167D79] hover:underline">
                        WhatsApp
                      </a>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>

          <section aria-labelledby="pay-h" className="space-y-3">
            <h2 id="pay-h" className="flex items-center gap-2 text-sm font-extrabold text-[#243B40]">
              <IndianRupee className="w-4 h-4 text-[#167D79]" />
              {ta ? 'பணம் வராத ஆர்டர்கள்' : 'Approved, awaiting payment'}
              <span className="rounded-full bg-[#167D79]/10 px-2 py-0.5 text-xs text-[#167D79]">
                {inbox.awaitingPayment.length}
              </span>
            </h2>
            {inbox.awaitingPayment.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-400">
                {ta ? 'பணம் வராத ஆர்டர்கள் இல்லை.' : 'Nothing waiting for payment.'}
              </p>
            ) : (
              inbox.awaitingPayment.map((o) => (
                <article key={o.orderId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-[#243B40]">
                      {o.customerName} <span className="font-medium text-slate-400">· {o.orderNumber}</span>
                    </div>
                    <div className="text-xs text-slate-400">{ago(o.approvedAt)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                    {o.balanceDue !== null && (
                      <span className="text-slate-700">
                        {ta ? 'நிலுவை' : 'Due'} {rupees(o.balanceDue)}
                      </span>
                    )}
                    <Link href={`/orders/${o.orderId}`} className="text-[#167D79] hover:underline">
                      {ta ? 'ஆர்டர்' : 'Open order'}
                    </Link>
                    {o.customerPhone && (
                      <>
                        <a href={waLink(o.customerPhone)} target="_blank" rel="noopener noreferrer" className="text-[#167D79] hover:underline">
                          WhatsApp
                        </a>
                        <a href={`tel:${o.customerPhone}`} className="inline-flex items-center gap-1 text-[#167D79] hover:underline">
                          <Phone className="w-3 h-3" />
                          {ta ? 'அழை' : 'Call'}
                        </a>
                      </>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
