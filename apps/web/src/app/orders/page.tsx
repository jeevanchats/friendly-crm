'use client';
import { useLocale } from '../../components/shared/LocaleProvider';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/auth/AuthProvider';
import { apiFetch } from '../../lib/session';
import { OrderStageCard } from '../../components/orders/OrderStageCard';
import {
  IndustryKey,
  INDUSTRY_TEMPLATES,
  getIndustryTemplate,
  hasPermission,
  TenantRole,
} from '@friendly-crm/shared';
import {
  ShoppingBag,
  Filter,
  CheckCircle2,
  Clock,
  IndianRupee,
  ShieldAlert,
  UserCheck,
  RefreshCw,
} from 'lucide-react';
import enMessages from '../../../messages/en.json';
import taMessages from '../../../messages/ta.json';

interface OrderItem {
  id: string;
  orderNumber: string;
  productionStage: string;
  totalAmount: string;
  advanceReceived: string;
  balanceDue: string;
  customData: Record<string, any>;
  customer: {
    name: string;
    phone: string;
    companyName?: string;
  };
}

export default function OrdersPage() {
  const router = useRouter();
  const [locale, setLocale] = useLocale();
  // Industry and role are the signed-in user's own (the server derives the role from their membership).
  const { active } = useAuth();
  const activeIndustry: IndustryKey = active!.industryKey;
  const activeRole: TenantRole = active!.role;
  const tenantId = active!.tenantId;
  const [selectedStage, setSelectedStage] = useState<string>('ALL');
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const messages = locale === 'en' ? enMessages : taMessages;
  const template = getIndustryTemplate(activeIndustry);

  const triggerToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url =
        selectedStage && selectedStage !== 'ALL'
          ? `/api/orders?stage=${encodeURIComponent(selectedStage)}`
          : '/api/orders';

      const res = await apiFetch(url);

      if (res.ok) {
        const json = await res.json();
        setOrders(Array.isArray(json) ? json : json.data || []);
      } else {
        setOrders([]);
        setError(res.status === 403 ? 'Your role cannot view orders.' : `Could not load orders (${res.status}).`);
      }
    } catch {
      setOrders([]);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, selectedStage]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Permissions based on active role
  const canUpdateStage = hasPermission(activeRole, 'order:update_stage');
  const canRecordPayment = hasPermission(activeRole, 'payment:create');

  // Financial statistics
  const totalBalanceDue = orders.reduce(
    (sum, o) => sum + (parseFloat(o.balanceDue) || 0),
    0
  );
  const totalAmountSum = orders.reduce(
    (sum, o) => sum + (parseFloat(o.totalAmount) || 0),
    0
  );

  const stages = template.orderStages;

  // Filter orders by selected stage
  const displayedOrders =
    selectedStage === 'ALL'
      ? orders
      : orders.filter((o) => o.productionStage === selectedStage);

  return (
    <div className="min-h-screen bg-surface text-foreground flex flex-col pb-24">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-surface border border-slate-200 text-brand-ink px-4 py-2.5 rounded-2xl shadow-xl flex items-center space-x-2 text-xs font-semibold animate-slide-up border border-brand-ink/40">
          <CheckCircle2 className="w-4 h-4 text-brand-ink" />
          <span>{notification}</span>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-surface/90 backdrop-blur-md border-b border-slate-200/80 px-3.5 py-2.5 shadow-2xs">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-brand-ink">{active!.tenantName}</span>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setLocale(locale === 'en' ? 'ta' : 'en')}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl border border-brand-ink/30 bg-action/10 text-brand-ink font-bold text-xs hover:bg-action/20 transition-colors"
              title="Toggle Tamil / English"
            >
              <span>{locale === 'en' ? '🇮🇳 தமிழ்' : '🇬🇧 English'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-lg mx-auto w-full px-4 pt-3.5 space-y-4">
        {/* Banner */}
        <div className="bg-surface border border-slate-200 rounded-2xl p-4 text-brand-ink shadow-sm relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <span className="inline-flex items-center space-x-1 text-[11px] font-bold uppercase tracking-wider text-brand-teal-dark bg-brand-teal-50 px-2 py-0.5 rounded-md">
                <ShoppingBag className="w-3.5 h-3.5 text-brand-ink" />
                <span>{template.name[locale]}</span>
              </span>
              <h1 className="text-lg font-black mt-1 tracking-tight text-brand-ink">
                {locale === 'ta' ? 'உற்பத்தி ஆர்டர்கள்' : 'Production Floor Orders'}
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                {orders.length} {locale === 'ta' ? 'ஆர்டர்கள்' : 'orders'}
                {orders.length > 0 && orders[0].balanceDue != null
                  ? ` • ₹${totalBalanceDue.toLocaleString('en-IN')} ${locale === 'ta' ? 'பாக்கி' : 'balance due'}`
                  : ''}
              </p>
            </div>

            <button
              onClick={fetchOrders}
              className="p-2 bg-brand-teal-50 hover:bg-brand-teal-100 rounded-xl transition-colors text-brand-ink"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

        </div>

        {/* Financial Metrics Row */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-surface p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {locale === 'ta' ? 'மொத்த ஆர்டர்கள்' : 'Total Orders'}
            </div>
            <div className="text-lg font-extrabold text-brand-ink mt-0.5">
              {orders.length}
            </div>
          </div>

          <div className="bg-surface p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {locale === 'ta' ? 'ஆர்டர் மதிப்பு' : 'Order Value'}
            </div>
            <div className="text-lg font-extrabold text-foreground mt-0.5 truncate">
              {orders.length > 0 && orders[0].totalAmount != null
                ? `₹${(totalAmountSum / 1000).toFixed(0)}k`
                : '—'}
            </div>
          </div>

          <div className="bg-surface p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
              {locale === 'ta' ? 'வரவேண்டியது' : 'Balance Due'}
            </div>
            <div className="text-lg font-extrabold text-rose-600 mt-0.5 truncate">
              {orders.length > 0 && orders[0].balanceDue != null
                ? `₹${(totalBalanceDue / 1000).toFixed(0)}k`
                : '—'}
            </div>
          </div>
        </div>

        {/* Stage Filter Bar */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center space-x-1.5">
              <Filter className="w-4 h-4 text-brand-ink" />
              <span>{locale === 'ta' ? 'நிலை வாரியாக வடிகட்டுக' : 'Filter by Production Stage'}</span>
            </h2>
            <span className="text-[11px] font-semibold text-slate-600">
              ({displayedOrders.length})
            </span>
          </div>

          {/* Swipeable Stage Filter Pills */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1.5 scrollbar-none">
            <button
              onClick={() => setSelectedStage('ALL')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                selectedStage === 'ALL'
                  ? 'bg-action text-on-action shadow-sm'
                  : 'bg-surface border border-slate-200 text-slate-600 hover:text-foreground'
              }`}
            >
              {locale === 'ta' ? 'அனைத்தும் (All)' : 'All Orders'}
            </button>

            {stages.map((st) => {
              const isSelected = selectedStage === st.id;
              const count = orders.filter((o) => o.productionStage === st.id).length;

              return (
                <button
                  key={st.id}
                  onClick={() => setSelectedStage(st.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition-all ${
                    isSelected
                      ? 'bg-action text-on-action shadow-sm'
                      : 'bg-surface border border-slate-200 text-slate-600 hover:text-foreground'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: st.color }}
                  />
                  <span>{st.label[locale]}</span>
                  {count > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                        isSelected ? 'bg-surface/30 text-brand-ink' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Order Cards List */}
        <section className="space-y-3.5">
          {error ? (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : loading && orders.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-600">Loading orders…</div>
          ) : displayedOrders.length === 0 ? (
            <div className="bg-surface rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-600">
                {locale === 'ta' ? 'இந்த நிலையில் ஆர்டர்கள் எதுவும் இல்லை' : 'No orders in this stage'}
              </p>
              <p>
                {locale === 'ta'
                  ? 'மேலே உள்ள பிற நிலைகளைத் தேர்ந்தெடுக்கவும்'
                  : 'Select another stage above.'}
              </p>
            </div>
          ) : (
            displayedOrders.map((order) => (
              <OrderStageCard
                key={order.id}
                order={order}
                industry={activeIndustry}
                lang={locale}
                canUpdateStage={canUpdateStage}
                canRecordPayment={canRecordPayment}
                onRefresh={fetchOrders}
              />
            ))
          )}
        </section>
      </main>

    </div>
  );
}
