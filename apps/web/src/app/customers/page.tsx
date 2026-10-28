'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Search, Phone, MessageSquare, ArrowRight, Building, Plus, Users, IndianRupee } from 'lucide-react';
import { hasPermission } from '@friendly-crm/shared';
import { useAuth } from '../../components/auth/AuthProvider';
import { AddCustomerForm } from '../../components/crm/AddCustomerForm';
import { apiFetch } from '../../lib/session';

interface CustomerSummary {
  id: string;
  name: string;
  companyName?: string;
  phone: string;
  whatsappNumber?: string;
  gstin?: string;
  openingBalance: string;
  activeOrdersCount: number;
  totalReceivable: string;
}

export default function CustomersDirectoryPage() {
  const { active } = useAuth();
  // AuthProvider only renders this page once a business is active.
  const tenantId = active!.tenantId;
  const activeTenant = { name: active!.tenantName };

  const canAdd = hasPermission(active!.role, 'customer:create');
  const searchRequest = useRef<AbortController | null>(null);
  const searchSequence = useRef(0);
  const [showAdd, setShowAdd] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomers = useCallback(async (q = '') => {
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    const sequence = ++searchSequence.current;
    setLoading(true);
    setError(null);
    try {
      const url = q
        ? `/api/crm/customers?search=${encodeURIComponent(q)}`
        : `/api/crm/customers`;

      const res = await apiFetch(url, { signal: controller.signal });
      if (controller.signal.aborted || sequence !== searchSequence.current) return;

      if (res.ok) {
        const data = await res.json();
        if (controller.signal.aborted || sequence !== searchSequence.current) return;
        setCustomers(data);
      } else {
        setCustomers([]);
        setError(res.status === 403 ? 'Your role cannot view customers.' : `Could not load customers (${res.status}).`);
      }
    } catch {
      if (controller.signal.aborted || sequence !== searchSequence.current) return;
      setCustomers([]);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      if (sequence === searchSequence.current && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  // Load on first render, when the search changes, and when the business is switched.
  useEffect(() => {
    searchRequest.current?.abort();
    ++searchSequence.current;
    setCustomers([]);
    setLoading(true);
    const timer = setTimeout(() => fetchCustomers(searchQuery), searchQuery ? 250 : 0);
    return () => { clearTimeout(timer); searchRequest.current?.abort(); ++searchSequence.current; };
  }, [tenantId, searchQuery, fetchCustomers]);

  return (
    <div className="space-y-5 pb-20">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-ink" />
            <h1 className="text-xl font-bold text-foreground">
              வாடிக்கையாளர் பட்டியல் (Customers Directory)
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Tenant: <strong className="text-brand-ink">{activeTenant.name}</strong> • Isolated RLS Ledger
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-action/10 px-3 py-1 text-xs font-bold text-brand-ink">
            {customers.length} Customers
          </span>
          {canAdd && (
            <>
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-action px-3 py-1.5 text-xs font-bold text-on-action"
              >
                <Plus className="w-3.5 h-3.5" /> Add customer
              </button>
              <Link href="/customers/import" className="inline-flex items-center rounded-lg border border-brand-ink px-3 py-1.5 text-xs font-bold text-brand-ink">
                Import from Excel / CSV
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
        <input
          aria-label="Search customers by name, company or phone"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, company, or phone (பெயர் / நிறுவனம் / போன்)..."
          className="w-full min-h-[46px] rounded-xl border border-slate-200 bg-surface pl-10 pr-4 text-xs sm:text-sm text-foreground placeholder-slate-600 focus:border-brand-ink focus:outline-none shadow-2xs"
        />
      </div>

      {/* Customers List */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-600">Loading customers...</div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : customers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-surface p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-600">No customers found for this business.</p>
            {canAdd && (
              <p className="text-xs text-slate-500">
                Use <strong>Add customer</strong>, or <Link href="/customers/import" className="font-bold text-brand-ink underline">import your customer list</Link>.
              </p>
            )}
            <p className="text-xs text-slate-600">
              Each tenant's database is strictly isolated. Switch business from the top dropdown to see other customers.
            </p>
          </div>
        ) : (
          customers.map((cust) => {
            const cleanPhone = cust.phone.replace(/\D/g, '');
            const hasReceivable = parseFloat(cust.totalReceivable) > 0;

            return (
              <div
                key={cust.id}
                className="rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm hover:border-brand-ink transition-all space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/customers/${cust.id}`} className="group block flex-1">
                    <h3 className="text-base font-bold text-foreground group-hover:text-brand-ink transition-colors">
                      {cust.name}
                    </h3>
                    {cust.companyName && (
                      <p className="text-xs font-semibold text-slate-500 flex items-center gap-1 mt-0.5">
                        <Building className="w-3 h-3 text-slate-600" />
                        <span>{cust.companyName}</span>
                      </p>
                    )}
                    <p className="text-xs text-slate-600 mt-0.5">{cust.phone}</p>
                  </Link>

                  <div className="text-right shrink-0">
                    {cust.totalReceivable != null && (
                      <span
                        className={`inline-block rounded-lg px-2.5 py-1 text-xs font-bold ${
                          hasReceivable
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {hasReceivable ? `₹${cust.totalReceivable} Due` : 'Nil Balance'}
                      </span>
                    )}
                    {cust.activeOrdersCount > 0 && (
                      <span className="block mt-1 text-[11px] font-semibold text-brand-ink">
                        {cust.activeOrdersCount} active order(s)
                      </span>
                    )}
                  </div>
                </div>

                {/* 1-Tap Quick Action Footer */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <div className="flex items-center gap-1.5">
                    <a
                      href={`tel:${cust.phone}`}
                      className="flex min-h-[44px] items-center rounded-lg bg-surface px-3 text-xs font-bold text-foreground border border-slate-200 hover:bg-slate-100"
                    >
                      <Phone className="w-3.5 h-3.5 mr-1" /> Call
                    </a>
                    <a
                      href={`https://wa.me/${cleanPhone}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-[44px] items-center rounded-lg bg-[#25D366]/15 px-3 text-xs font-bold text-[#128C7E] hover:bg-[#25D366]/25"
                    >
                      <MessageSquare className="w-3.5 h-3.5 mr-1" /> WhatsApp
                    </a>
                  </div>

                  <Link
                    href={`/customers/${cust.id}`}
                    className="flex min-h-[44px] items-center rounded-lg bg-action px-3.5 text-xs font-bold text-on-action hover:bg-action/90 transition-colors gap-1 shadow-2xs"
                  >
                    <span>360° Profile</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
      {showAdd && (
        <AddCustomerForm
          role={active!.role}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            fetchCustomers(searchQuery);
          }}
        />
      )}
    </div>
  );
}
