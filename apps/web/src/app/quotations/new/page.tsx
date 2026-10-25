'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { hasPermission } from '@friendly-crm/shared';
import { FastQuotationBuilder } from '../../../components/sales/FastQuotationBuilder';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';
import { EnquiryAttachments } from '../../../components/crm/EnquiryAttachments';

interface Customer {
  id: string;
  name: string;
  phone: string;
}

function NewQuotation() {
  const { active } = useAuth();
  const customerId = useSearchParams()?.get('customerId') ?? '';
  const leadId = useSearchParams()?.get('leadId') ?? undefined;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = hasPermission(active!.role, 'quote:create');

  useEffect(() => {
    if (!customerId || !allowed) return;
    setCustomer(null);
    setError(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/crm/customers/${customerId}`);
        if (res.ok) {
          const data = await res.json();
          setCustomer({ id: data.customer.id, name: data.customer.name, phone: data.customer.phone });
        } else {
          setError(res.status === 404 ? 'This customer was not found in the active business.' : `Could not load the customer (${res.status}).`);
        }
      } catch {
        setError('Could not reach the server. Check your connection and try again.');
      }
    })();
  }, [customerId, allowed, active!.tenantId]);

  if (!allowed) {
    return (
      <p role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
        Your role cannot create quotations.
      </p>
    );
  }
  if (!customerId) {
    return (
      <p role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
        Open a customer and press “New Quote”.
      </p>
    );
  }
  if (error) {
    return <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm font-semibold text-red-700">{error}</p>;
  }
  if (!customer) {
    return <p className="rounded-2xl bg-white p-10 text-center text-sm text-slate-400">Loading…</p>;
  }
  return (
    <div className="space-y-4">
      {/* What the customer asked for (voice note, photos, drawings), alongside the quote being prepared */}
      <EnquiryAttachments leadId={leadId} customerId={customer.id} />
      <FastQuotationBuilder
        customer={customer}
        leadId={leadId}
        industry={active!.industryKey}
      />
    </div>
  );
}

export default function NewQuotationPage() {
  return (
    <div className="space-y-4">
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <ArrowLeft className="h-4 w-4" /> Customers
      </Link>
      <Suspense fallback={<p className="p-10 text-center text-sm text-slate-400">Loading…</p>}>
        <NewQuotation />
      </Suspense>
    </div>
  );
}
