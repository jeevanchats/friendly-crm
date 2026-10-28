'use client';
import { useLocale } from '../../components/shared/LocaleProvider';

import React, { useState, useEffect } from 'react';
import { ReportsDashboard } from '@/components/reports/ReportsDashboard';
import { TenantRole, hasPermission } from '@friendly-crm/shared';
import { ShieldAlert, BarChart3, Lock, RefreshCw } from 'lucide-react';
import { useAuth } from '../../components/auth/AuthProvider';
import { apiFetch } from '../../lib/session';

export default function ReportsPage() {
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const role: TenantRole = active!.role; // decided by the server from the user's membership
  const [lang, setLang] = useLocale();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        const res = await apiFetch('/api/crm/reports');

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
      <div className="rounded-2xl bg-surface p-4 shadow-xs border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-action/10 text-brand-ink flex items-center justify-center font-bold">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {lang === 'ta' ? 'உங்கள் பொறுப்பு' : `Signed in as ${role}`}
            </div>
            <div className="text-sm font-extrabold text-foreground">
              {lang === 'ta' ? 'அறிக்கை அணுகல் கட்டுப்பாடு' : 'Reports & Insights Guard'}
            </div>
          </div>
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
              : `Your active role ('${role}') lacks the 'report:view' permission required to view executive financial insights, repeat order radar, and collections metrics. Ask the business owner if you need access.`}
          </p>
        </div>
      )}

      {/* Loading State */}
      {canViewReports && loading && (
        <div className="rounded-2xl bg-surface p-12 text-center text-slate-600 space-y-3">
          <RefreshCw className="w-8 h-8 mx-auto animate-spin text-brand-ink" />
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
