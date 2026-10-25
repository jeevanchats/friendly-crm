'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Customer360View } from '../../../components/crm/Customer360View';
import { BillingDetailsCard } from '../../../components/crm/BillingDetailsCard';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';
import { ArrowLeft, UserCheck, RefreshCw, AlertCircle } from 'lucide-react';

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = (params?.id as string) || '';

  // The role is the one the server derived from the signed-in user's membership; it cannot be chosen here.
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const activeRole = active!.role;
  const activeTenant = { name: active!.tenantName };

  const searchParams = useSearchParams();
  const langParam = (searchParams?.get('lang') as 'en' | 'ta') || 'en';
  const [locale, setLocale] = useState<'en' | 'ta'>(langParam);

  const [customerData, setCustomerData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomer360 = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/crm/customers/${customerId}`);

      if (res.ok) {
        const data = await res.json();
        setCustomerData(data);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setError(errJson.message || 'This customer is not available in the active business.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch customer 360 profile');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  // Load, and reload when the business is switched.
  useEffect(() => {
    fetchCustomer360();
  }, [tenantId, fetchCustomer360]);

  return (
    <div className="space-y-5 pb-20">
      {/* Top Breadcrumb Navigation & RBAC Role Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-3">
          <Link
            href="/customers"
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#167D79]">
              Customer 360° Profile
            </span>
            <h2 className="text-sm font-bold text-[#243B40] leading-tight">
              {activeTenant.name}
            </h2>
          </div>
        </div>

        {/* Signed-in role (decided by the server) */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-[#F6F8F7] px-2.5 py-1 rounded-xl border border-slate-200 text-xs font-semibold">
            <UserCheck className="w-3.5 h-3.5 text-[#167D79]" />
            <span className="text-slate-500 text-[11px]">Your role:</span>
            <span className="font-bold text-[#167D79]">{activeRole}</span>
          </div>

          <button
            type="button"
            onClick={() => fetchCustomer360()}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#167D79]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="py-16 text-center text-xs text-slate-400">Loading Customer 360° View...</div>
      ) : error ? (
        <div className="rounded-2xl border border-dashed border-rose-300 bg-rose-50/50 p-8 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
          <h3 className="text-base font-bold text-rose-900">Tenant Isolation Enforced (RLS)</h3>
          <p className="text-xs text-rose-700 max-w-md mx-auto">{error}</p>
          <div className="pt-2">
            <Link
              href="/customers"
              className="inline-flex items-center justify-center rounded-xl bg-[#167D79] px-4 py-2 text-xs font-bold text-white shadow-sm"
            >
              Back to Customers Directory
            </Link>
          </div>
        </div>
      ) : customerData ? (
        <>
          <Customer360View data={customerData} defaultLang={locale} />
          <BillingDetailsCard
            key={customerId}
            customerId={customerId}
            role={activeRole}
            lang={locale}
            initial={{
              gstin: customerData.customer?.gstin,
              billingAddress: customerData.customer?.billingAddress,
              stateCode: customerData.customer?.stateCode,
              remindersOptOut: customerData.customer?.remindersOptOut,
            }}
          />
        </>
      ) : null}
    </div>
  );
}
