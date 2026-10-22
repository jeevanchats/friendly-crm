'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Phone, MessageSquare, ArrowRight, Building, Plus, Users, IndianRupee } from 'lucide-react';
import { PILOT_TENANTS, PilotTenant } from '../../components/layout/AppShell';

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
  const [tenantId, setTenantId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('friendly_tenant_id') || 't-demo-printing';
    }
    return 't-demo-printing';
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const activeTenant = PILOT_TENANTS.find((t) => t.id === tenantId) || PILOT_TENANTS[0];

  const fetchCustomers = useCallback(async (currentTenantId: string, q = '') => {
    setLoading(true);
    try {
      const url = q
        ? `/api/crm/customers?search=${encodeURIComponent(q)}`
        : `/api/crm/customers`;

      const res = await fetch(url, {
        headers: {
          'x-tenant-id': currentTenantId,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setCustomers(data);
      }
    } catch (err) {
      console.warn('Failed to fetch customers, using fallback', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and query filter
  useEffect(() => {
    fetchCustomers(tenantId, searchQuery);
  }, [tenantId, searchQuery, fetchCustomers]);

  // Listen to tenant switcher changes from AppShell
  useEffect(() => {
    const handleTenantChanged = (e: any) => {
      const newTenant = e.detail as PilotTenant;
      if (newTenant?.id) {
        setTenantId(newTenant.id);
        fetchCustomers(newTenant.id, searchQuery);
      }
    };

    window.addEventListener('tenant-changed', handleTenantChanged);
    return () => window.removeEventListener('tenant-changed', handleTenantChanged);
  }, [searchQuery, fetchCustomers]);

  return (
    <div className="space-y-5 pb-20">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#167D79]" />
            <h1 className="text-xl font-bold text-[#243B40]">
              வாடிக்கையாளர் பட்டியல் (Customers Directory)
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Tenant: <strong className="text-[#167D79]">{activeTenant.name}</strong> • Isolated RLS Ledger
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#167D79]/10 px-3 py-1 text-xs font-bold text-[#167D79]">
            {customers.length} Customers
          </span>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, company, or phone (பெயர் / நிறுவனம் / போன்)..."
          className="w-full min-h-[46px] rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-xs sm:text-sm text-[#243B40] placeholder-slate-400 focus:border-[#167D79] focus:outline-none shadow-2xs"
        />
      </div>

      {/* Customers List */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading customers...</div>
        ) : customers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-600">No customers found for this business.</p>
            <p className="text-xs text-slate-400">
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
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#167D79] transition-all space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/customers/${cust.id}`} className="group block flex-1">
                    <h3 className="text-base font-bold text-[#243B40] group-hover:text-[#167D79] transition-colors">
                      {cust.name}
                    </h3>
                    {cust.companyName && (
                      <p className="text-xs font-semibold text-slate-500 flex items-center gap-1 mt-0.5">
                        <Building className="w-3 h-3 text-slate-400" />
                        <span>{cust.companyName}</span>
                      </p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">{cust.phone}</p>
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
                      <span className="block mt-1 text-[11px] font-semibold text-[#167D79]">
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
                      className="flex min-h-[38px] items-center rounded-lg bg-[#F6F8F7] px-3 text-xs font-bold text-[#243B40] border border-slate-200 hover:bg-slate-100"
                    >
                      <Phone className="w-3.5 h-3.5 mr-1" /> Call
                    </a>
                    <a
                      href={`https://wa.me/${cleanPhone}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-[38px] items-center rounded-lg bg-[#25D366]/15 px-3 text-xs font-bold text-[#128C7E] hover:bg-[#25D366]/25"
                    >
                      <MessageSquare className="w-3.5 h-3.5 mr-1" /> WhatsApp
                    </a>
                  </div>

                  <Link
                    href={`/customers/${cust.id}`}
                    className="flex min-h-[38px] items-center rounded-lg bg-[#167D79] px-3.5 text-xs font-bold text-white hover:bg-[#167D79]/90 transition-colors gap-1 shadow-2xs"
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
    </div>
  );
}
