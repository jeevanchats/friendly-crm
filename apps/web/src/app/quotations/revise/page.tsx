'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { hasPermission } from '@friendly-crm/shared';
import { FastQuotationBuilder, ReviseSeed } from '../../../components/sales/FastQuotationBuilder';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';

interface Loaded {
  customer: { id: string; name: string; phone: string };
  seed: ReviseSeed;
}

function ReviseQuotation() {
  const { active } = useAuth();
  const quoteId = useSearchParams()?.get('quoteId') ?? '';
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = hasPermission(active!.role, 'quote:update');

  useEffect(() => {
    if (!quoteId || !allowed) return;
    setLoaded(null);
    setError(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/sales/quotations/${quoteId}`);
        if (!res.ok) {
          setError(res.status === 404 ? 'This quotation was not found in the active business.' : `Could not load the quotation (${res.status}).`);
          return;
        }
        const data = await res.json();
        const q = data.quote;
        if (q.status === 'CONVERTED') {
          setError(`${q.quoteNumber} was already approved and became an order, so it can no longer be revised.`);
          return;
        }
        if (q.status !== 'SENT' && q.status !== 'DRAFT') {
          setError(`This version of ${q.quoteNumber} has already been replaced by a newer one. Open the latest version to revise it.`);
          return;
        }
        setLoaded({
          customer: { id: data.customer.id, name: data.customer.name, phone: data.customer.phone },
          seed: {
            quoteId: q.id,
            quoteNumber: q.quoteNumber,
            version: Number(q.version ?? 1),
            discount: Number(q.discountTotal ?? 0),
            customData: q.customData ?? {},
            items: data.items.map((i: any) => ({
              itemName: i.itemName,
              description: i.description ?? '',
              hsnCode: i.hsnCode ?? '',
              quantity: Number(i.quantity),
              unit: i.unit ?? 'Nos',
              unitPrice: Number(i.unitPrice),
              taxPercent: Number(i.taxPercent),
            })),
          },
        });
      } catch {
        setError('Could not reach the server. Check your connection and try again.');
      }
    })();
  }, [quoteId, allowed, active!.tenantId]);

  if (!allowed) {
    return <p role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">Your role cannot revise quotations.</p>;
  }
  if (!quoteId) {
    return <p role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">Open a change request in the Inbox and press “Revise quote”.</p>;
  }
  if (error) {
    return <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm font-semibold text-red-700">{error}</p>;
  }
  if (!loaded) {
    return <p className="rounded-2xl bg-white p-10 text-center text-sm text-slate-400">Loading…</p>;
  }
  return <FastQuotationBuilder customer={loaded.customer} industry={active!.industryKey} revise={loaded.seed} />;
}

export default function ReviseQuotationPage() {
  return (
    <div className="space-y-4">
      <Link href="/inbox" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <ArrowLeft className="h-4 w-4" /> Inbox
      </Link>
      <Suspense fallback={<p className="p-10 text-center text-sm text-slate-400">Loading…</p>}>
        <ReviseQuotation />
      </Suspense>
    </div>
  );
}
