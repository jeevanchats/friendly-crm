'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { OrderDetailView } from '../../../components/orders/OrderDetailView';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';
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
  const searchParams = useSearchParams();
  const orderId = (params?.id as string) || '';

  const langParam = (searchParams?.get('lang') as 'en' | 'ta') || 'en';

  const [locale, setLocale] = useState<'en' | 'ta'>(langParam);
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
          setError('This order could not be found.');
        }
      } else {
        setOrderData(null);
        setError(
          res.status === 404
            ? 'This order was not found in the active business.'
            : res.status === 403
            ? 'Your role cannot view this order.'
            : `Could not load the order (${res.status}).`
        );
      }
    } catch {
      setOrderData(null);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [orderId, tenantId]);

  useEffect(() => {
    fetchOrderDetail();
  }, [fetchOrderDetail]);

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#243B40] pb-24">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#243B40] text-white px-4 py-2.5 rounded-2xl shadow-xl flex items-center space-x-2 text-xs font-semibold animate-slide-up border border-[#167D79]/40">
          <CheckCircle2 className="w-4 h-4 text-[#F4B860]" />
          <span>{notification}</span>
        </div>
      )}

      {/* Top Header Bar with Back Nav & Language Toggle */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-2.5 shadow-2xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link
            href="/orders"
            className="flex items-center space-x-1.5 text-xs font-bold text-[#167D79] hover:text-[#126360] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{locale === 'ta' ? 'அனைத்து ஆர்டர்கள்' : 'Back to Orders'}</span>
          </Link>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setLocale(locale === 'en' ? 'ta' : 'en')}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-[#167D79]/30 bg-[#167D79]/10 text-[#167D79] font-bold text-xs hover:bg-[#167D79]/20 transition-colors"
              title="Toggle Tamil / English"
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
          <div className="rounded-2xl bg-white p-12 text-center text-xs text-slate-400 space-y-2 border">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#167D79]" />
            <p>{locale === 'ta' ? 'ஆர்டர் விவரங்கள் ஏற்றப்படுகின்றன...' : 'Loading order specifications...'}</p>
          </div>
        ) : (
          <OrderDetailView
            initialOrder={orderData}
            industry={activeIndustry}
            userRole={activeRole}
            defaultLang={locale}
          />
        )}
      </main>

    </div>
  );
}
