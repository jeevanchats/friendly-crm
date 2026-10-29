'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { OrderDetailView } from '../../../components/orders/OrderDetailView';
import { IssueInvoicePanel } from '../../../components/invoices/IssueInvoicePanel';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';
import { useLocale } from '../../../components/shared/LocaleProvider';
import {
  IndustryKey,
  TenantRole,
  INDUSTRY_TEMPLATES,
  getIndustryTemplate,
} from '@friendly-crm/shared';
import {
  ArrowLeft,
  UserCheck,
  RefreshCw,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import enMessages from '../../../../messages/en.json';
import taMessages from '../../../../messages/ta.json';

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = (params?.id as string) || '';

  const [locale, setLocale] = useLocale();
  // Industry and role are the signed-in user's own (the server derives the role from their membership).
  const { active } = useAuth();
  const activeIndustry: IndustryKey = active!.industryKey;
  const activeRole: TenantRole = active!.role;
  const tenantId = active!.tenantId;

  const [orderData, setOrderData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const messages = locale === 'en' ? enMessages : taMessages;

  const triggerToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchOrderDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/orders/${orderId}`);

      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (data && data.orderNumber) {
          setOrderData(data);
        } else {
          setOrderData(null);
          setError(locale === 'ta' ? 'இந்த ஆர்டர் கிடைக்கவில்லை.' : 'This order could not be found.');
        }
      } else {
        setOrderData(null);
        setError(
          res.status === 404
            ? locale === 'ta' ? 'இந்த ஆர்டர் தற்போதைய வணிகத்தில் கிடைக்கவில்லை.' : 'This order was not found in the active business.'
            : res.status === 403
            ? locale === 'ta' ? 'உங்கள் பொறுப்புக்கு இந்த ஆர்டரைப் பார்க்க அனுமதி இல்லை.' : 'Your role cannot view this order.'
            : locale === 'ta' ? `ஆர்டரை ஏற்ற முடியவில்லை (${res.status}).` : `Could not load the order (${res.status}).`
        );
      }
    } catch {
      setOrderData(null);
      setError(locale === 'ta' ? 'சர்வரை அடைய முடியவில்லை. இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.' : 'Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [orderId, tenantId, locale]);

  useEffect(() => {
    fetchOrderDetail();
  }, [fetchOrderDetail]);

  return (
    <div className="min-h-screen bg-surface text-foreground pb-24">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-surface border border-slate-200 text-brand-ink px-4 py-2.5 rounded-2xl shadow-xl flex items-center space-x-2 text-xs font-semibold animate-slide-up border border-brand-ink/40">
          <CheckCircle2 className="w-4 h-4 text-brand-ink" />
          <span>{notification}</span>
        </div>
      )}

      {/* Top Header Bar with Back Nav & Language Toggle */}
      <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-2.5 shadow-2xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link
            href="/orders"
            className="flex items-center space-x-1.5 text-xs font-bold text-brand-ink hover:text-[#1CA58E] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{locale === 'ta' ? 'அனைத்து ஆர்டர்கள்' : 'Back to Orders'}</span>
          </Link>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setLocale(locale === 'en' ? 'ta' : 'en')}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-brand-ink/30 bg-action/10 text-brand-ink font-bold text-xs hover:bg-action/20 transition-colors"
              title={locale === 'ta' ? 'தமிழ் / English மாற்று' : 'Toggle Tamil / English'}
            >
              <span>{locale === 'en' ? '🇮🇳 தமிழ்' : '🇬🇧 English'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 pt-4 space-y-4">
        {/* Order Detail View */}
        {error ? (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : loading || !orderData ? (
          <div className="rounded-2xl bg-surface p-12 text-center text-xs text-slate-600 space-y-2 border">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-ink" />
            <p>{locale === 'ta' ? 'ஆர்டர் விவரங்கள் ஏற்றப்படுகின்றன...' : 'Loading order specifications...'}</p>
          </div>
        ) : (
          <>
            <OrderDetailView
              initialOrder={orderData}
              industry={activeIndustry}
              userRole={activeRole}
              defaultLang={locale}
            />
            <IssueInvoicePanel orderId={orderData.id} role={activeRole} lang={locale} />
          </>
        )}
      </main>

    </div>
  );
}
