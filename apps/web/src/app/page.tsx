'use client';
import { useLocale } from '../components/shared/LocaleProvider';

import React, { useState, useEffect, useCallback } from 'react';
import { HomeDashboard } from '../components/dashboard/HomeDashboard';
import { useAuth } from '../components/auth/AuthProvider';
import { apiFetch } from '../lib/session';

export default function HomePage() {
  const { user, active } = useAuth();
  const tenantId = active!.tenantId;
  const [lang] = useLocale();
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/crm/dashboard');
      if (res.ok) {
        setDashboardData(await res.json());
      } else {
        setDashboardData(null);
        setError(res.status === 403 ? 'Your role cannot view the dashboard.' : `Could not load the dashboard (${res.status}).`);
      }
    } catch {
      setDashboardData(null);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load, and reload when the business is switched.
  useEffect(() => {
    fetchDashboard();
  }, [tenantId, fetchDashboard]);

  if (!dashboardData) {
    return (
      <div className="py-12 text-center text-sm">
        {loading ? (
          <span className="text-slate-600">Loading…</span>
        ) : (
          <div role="alert" className="mx-auto max-w-sm space-y-3">
            <p className="font-semibold text-red-700">{error}</p>
            <button
              type="button"
              onClick={fetchDashboard}
              className="min-h-[44px] rounded-xl bg-action px-4 font-bold text-on-action hover:bg-action/85 transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HomeDashboard
        userName={user?.name || user?.phone || ''}
        lang={lang}
        data={dashboardData}
        onRefresh={fetchDashboard}
      />
    </div>
  );
}
