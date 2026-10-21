'use client';

import React, { useState, useEffect } from 'react';
import { ReportsDashboard } from '@/components/reports/ReportsDashboard';
import { TenantRole, hasPermission } from '@friendly-crm/shared';
import { ShieldAlert, BarChart3, Lock, RefreshCw } from 'lucide-react';

export default function ReportsPage() {
  const [tenantId, setTenantId] = useState<string>('t-demo-printing');
  const [role, setRole] = useState<TenantRole>('OWNER');
  const [lang, setLang] = useState<'en' | 'ta'>('en');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize tenant & role from localStorage / cookies
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTenant = localStorage.getItem('friendly_tenant_id');
      if (savedTenant) setTenantId(savedTenant);

      const savedRole = localStorage.getItem('friendly_user_role') as TenantRole;
      if (savedRole) setRole(savedRole);

      const handleTenantChange = (e: any) => {
        if (e.detail?.id) {
          setTenantId(e.detail.id);
        }
      };
      window.addEventListener('tenant-changed', handleTenantChange);
      return () => window.removeEventListener('tenant-changed', handleTenantChange);
    }
  }, []);

  const handleRoleChange = (newRole: TenantRole) => {
    setRole(newRole);
    if (typeof window !== 'undefined') {
      localStorage.setItem('friendly_user_role', newRole);
      window.dispatchEvent(new CustomEvent('role-changed', { detail: newRole }));
    }
  };

  useEffect(() => {
    async function loadReports() {
      if (!hasPermission(role, 'report:view')) {
        setLoading(false);
        setData(null);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/crm/reports', {
          headers: {
            'x-tenant-id': tenantId,
            'x-user-role': role,
          },
        });

        if (!res.ok) {
          if (res.status === 403) {
            setData(null);
            setError('Access Denied: Your role does not have permission to view business reports.');
          } else {
            throw new Error(`Failed to load reports (Status ${res.status})`);
          }
        } else {
          const json = await res.json();
          setData(json);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch business reports');
      } finally {
        setLoading(false);
      }
    }

    loadReports();
  }, [tenantId, role]);

  const canViewReports = hasPermission(role, 'report:view');

  return (
    <div className="space-y-6">
      {/* Top Banner: Role Selector & Security Context */}
      <div className="rounded-2xl bg-white p-4 shadow-xs border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-[#167D79]/10 text-[#167D79] flex items-center justify-center font-bold">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {lang === 'ta' ? 'பாதுகாப்பு & அனுமதி முறைமை' : 'RBAC Role Simulator'}
            </div>
            <div className="text-sm font-extrabold text-[#243B40]">
              {lang === 'ta' ? 'அறிக்கை அணுகல் கட்டுப்பாடு' : 'Reports & Insights Guard'}
            </div>
          </div>
        </div>

        {/* Role Toggle Pills */}
        <div className="flex items-center gap-1.5 bg-[#F6F8F7] p-1 rounded-xl border border-slate-200">
          {(['OWNER', 'MANAGER', 'ACCOUNTS', 'PRODUCTION', 'SALESPERSON'] as TenantRole[]).map((r) => {
            const isSelected = role === r;
            const isPermitted = hasPermission(r, 'report:view');
            return (
              <button
                key={r}
                type="button"
                onClick={() => handleRoleChange(r)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1 ${
                  isSelected
                    ? isPermitted
                      ? 'bg-[#167D79] text-white shadow-xs'
                      : 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-200/60'
                }`}
              >
                {!isPermitted && <Lock className="w-3 h-3 inline-block opacity-75" />}
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {/* RBAC Blocked State for PRODUCTION or SALESPERSON */}
      {!canViewReports && (
        <div className="rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/60 p-8 text-center space-y-3 animate-fade-in">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shadow-xs">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-rose-900">
            {lang === 'ta' ? 'வணிக அறிக்கைகள் அணுகல் மறுக்கப்பட்டது' : 'Business Insights Access Restricted'}
          </h2>
          <p className="text-xs text-rose-700 max-w-md mx-auto">
            {lang === 'ta'
              ? `உங்கள் பாத்திரத்திற்கு ('${role}') 'report:view' அனுமதி இல்லை. வணிக அறிக்கைகள், வசூல் பாக்கி மற்றும் வர்த்தக நுண்ணறிவுகள் OWNER, MANAGER, மற்றும் ACCOUNTS பாத்திரங்களுக்கு மட்டுமே அனுமதிக்கப்பட்டுள்ளன.`
              : `Your active role ('${role}') lacks the 'report:view' permission required to view executive financial insights, repeat order radar, and collections metrics. Switch to OWNER, MANAGER, or ACCOUNTS to review.`}
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => handleRoleChange('OWNER')}
              className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-rose-700 transition-colors"
            >
              {lang === 'ta' ? 'OWNER பாத்திரத்திற்கு மாற்றவும்' : 'Switch to OWNER Role'}
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {canViewReports && loading && (
        <div className="rounded-2xl bg-white p-12 text-center text-slate-400 space-y-3">
          <RefreshCw className="w-8 h-8 mx-auto animate-spin text-[#167D79]" />
          <p className="text-sm font-semibold">
            {lang === 'ta' ? 'அறிக்கைகள் தயாராகின்றன...' : 'Loading business reports & conversion metrics...'}
          </p>
        </div>
      )}

      {/* Error State */}
      {canViewReports && !loading && error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-6 text-rose-700 text-center">
          <p className="text-sm font-bold">{error}</p>
        </div>
      )}

      {/* Render Reports Dashboard when Permitted & Loaded */}
      {canViewReports && !loading && data && (
        <ReportsDashboard data={data} defaultLang={lang} />
      )}
    </div>
  );
}
