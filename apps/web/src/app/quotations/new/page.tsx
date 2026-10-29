'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { hasPermission, SuggestedLine } from '@friendly-crm/shared';
import { FastQuotationBuilder } from '../../../components/sales/FastQuotationBuilder';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';
import { EnquiryAttachments } from '../../../components/crm/EnquiryAttachments';
import { useLocale } from '../../../components/shared/LocaleProvider';

interface Customer {
  id: string;
  name: string;
  phone: string;
}

function NewQuotation() {
  const { active } = useAuth();
  const [lang] = useLocale();
  const ta = lang === 'ta';
  const customerId = useSearchParams()?.get('customerId') ?? '';
  const leadId = useSearchParams()?.get('leadId') ?? undefined;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ id: number; lines: SuggestedLine[] } | null>(null);

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
          setError(res.status === 404 ? (ta ? 'இந்த வாடிக்கையாளர் தற்போதைய வணிகத்தில் கிடைக்கவில்லை.' : 'This customer was not found in the active business.') : ta ? `வாடிக்கையாளரை ஏற்ற முடியவில்லை (${res.status}).` : `Could not load the customer (${res.status}).`);
        }
      } catch {
        setError(ta ? 'சர்வரை அடைய முடியவில்லை. இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.' : 'Could not reach the server. Check your connection and try again.');
      }
    })();
  }, [customerId, allowed, active!.tenantId, ta]);

  if (!allowed) {
    return (
      <p role="alert" className="rounded-2xl border border-slate-200 bg-surface p-8 text-center text-sm font-semibold text-slate-500">
        {ta ? 'உங்கள் பொறுப்புக்கு விலைப்புள்ளிகளை உருவாக்க அனுமதி இல்லை.' : 'Your role cannot create quotations.'}
      </p>
    );
  }
  if (!customerId) {
    return (
      <p role="alert" className="rounded-2xl border border-slate-200 bg-surface p-8 text-center text-sm font-semibold text-slate-500">
        {ta ? 'ஒரு வாடிக்கையாளரைத் திறந்து “புதிய விலைப்புள்ளி” அழுத்தவும்.' : 'Open a customer and press “New Quote”.'}
      </p>
    );
  }
  if (error) {
    return <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm font-semibold text-red-700">{error}</p>;
  }
  if (!customer) {
    return <p className="rounded-2xl bg-surface p-10 text-center text-sm text-slate-600">{ta ? 'ஏற்றப்படுகிறது…' : 'Loading…'}</p>;
  }
  return (
    <div className="space-y-4">
      {/* What the customer asked for (voice note, photos, drawings), alongside the quote being prepared */}
      <EnquiryAttachments
        leadId={leadId}
        customerId={customer.id}
        onSuggest={(lines) => setSuggestion((prev) => ({ id: (prev?.id ?? 0) + 1, lines }))}
      />
      <FastQuotationBuilder
        customer={customer}
        leadId={leadId}
        industry={active!.industryKey}
        suggestion={suggestion}
      />
    </div>
  );
}

export default function NewQuotationPage() {
  const [lang] = useLocale();
  const ta = lang === 'ta';
  return (
    <div className="space-y-4">
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <ArrowLeft className="h-4 w-4" /> {ta ? 'வாடிக்கையாளர்கள்' : 'Customers'}
      </Link>
      <Suspense fallback={<p className="p-10 text-center text-sm text-slate-600">{ta ? 'ஏற்றப்படுகிறது…' : 'Loading…'}</p>}>
        <NewQuotation />
      </Suspense>
    </div>
  );
}
