'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { BusinessSwitcher } from '../../components/layout/BusinessSwitcher';
import { MobileBottomNav } from '../../components/layout/MobileBottomNav';
import { OrderStageCard } from '../../components/orders/OrderStageCard';
import {
  IndustryKey,
  INDUSTRY_TEMPLATES,
  getIndustryTemplate,
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
  const [locale, setLocale] = useState<'en' | 'ta'>('en');
  const [activeIndustry, setActiveIndustry] = useState<IndustryKey>('printing');
  const [activeRole, setActiveRole] = useState<TenantRole>('OWNER');
  const [selectedStage, setSelectedStage] = useState<string>('ALL');
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [notification, setNotification] = useState<string | null>(null);

  const messages = locale === 'en' ? enMessages : taMessages;
  const template = getIndustryTemplate(activeIndustry);

  const triggerToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const getFallbackOrders = useCallback((): OrderItem[] => {
    if (activeIndustry === 'furniture') {
      return [
        {
          id: 'ord-furn-1',
          orderNumber: 'ORD-2026-4915',
          productionStage: 'MEASUREMENT_CONFIRMED',
          totalAmount: '97800.00',
          advanceReceived: '30000.00',
          balanceDue: '67800.00',
          customData: {
            wood_type: 'TEAK_WOOD',
            finish: 'WALNUT_MATTE',
            dimensions: '72x36x30 inches',
          },
          customer: {
            name: 'Grand Royal Residency',
            phone: '+919444123890',
            companyName: 'Royal Hospitality',
          },
        },
        {
          id: 'ord-furn-2',
          orderNumber: 'ORD-2026-4890',
          productionStage: 'WOOD_CUTTING',
          totalAmount: '145000.00',
          advanceReceived: '80000.00',
          balanceDue: '65000.00',
          customData: {
            wood_type: 'ROSEWOOD',
            finish: 'GLOSS_NATURAL',
            dimensions: 'King Size Bed Set',
          },
          customer: {
            name: 'Kavitha S.',
            phone: '+919840987654',
            companyName: 'Elite Residences',
          },
        },
      ];
    }

    return [
      {
        id: 'ord-print-1',
        orderNumber: 'ORD-2026-8956',
        productionStage: 'ARTWORK_PENDING',
        totalAmount: '147680.00',
        advanceReceived: '50000.00',
        balanceDue: '97680.00',
        customData: {
          job_type: 'PACKAGING_BOX',
          paper_gsm: 400,
          dimensions: '12x9x4 inches',
        },
        customer: {
          name: 'Sri Murugan Textiles & Sweets',
          phone: '+919840123456',
          companyName: 'Murugan Retailers Pvt Ltd',
        },
      },
      {
        id: 'ord-print-2',
        orderNumber: 'ORD-2026-8940',
        productionStage: 'PRINTING',
        totalAmount: '72000.00',
        advanceReceived: '50000.00',
        balanceDue: '22000.00',
        customData: {
          job_type: 'CALENDAR',
          paper_gsm: 170,
          dimensions: '15x20 inches',
        },
        customer: {
          name: 'Karthik Precision Engineering',
          phone: '+919876543210',
          companyName: 'Karthik Works',
        },
      },
      {
        id: 'ord-print-3',
        orderNumber: 'ORD-2026-8912',
        productionStage: 'POST_PRESS_FINISHING',
        totalAmount: '34500.00',
        advanceReceived: '34500.00',
        balanceDue: '0.00',
        customData: {
          job_type: 'BROCHURE',
          paper_gsm: 300,
          dimensions: 'A4 Tri-fold',
        },
        customer: {
          name: 'Anand Bio-Tech Solutions',
          phone: '+919444123890',
          companyName: 'Anand Pharma',
        },
      },
    ];
  }, [activeIndustry]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const url =
        selectedStage && selectedStage !== 'ALL'
          ? `/api/orders?stage=${selectedStage}`
          : '/api/orders';

      const res = await fetch(url, {
        headers: {
          'x-tenant-id': `t-demo-${activeIndustry}`,
          'x-user-role': activeRole,
        },
      });

      if (res.ok) {
        const json = await res.json();
        const data = Array.isArray(json) ? json : json.data || [];
        setOrders(data.length > 0 ? data : getFallbackOrders());
      } else {
        setOrders(getFallbackOrders());
      }
    } catch {
      setOrders(getFallbackOrders());
    } finally {
      setLoading(false);
    }
  }, [activeIndustry, activeRole, selectedStage, getFallbackOrders]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Permissions based on active role
  const canUpdateStage = activeRole === 'OWNER' || activeRole === 'MANAGER' || activeRole === 'PRODUCTION';
  const canRecordPayment = activeRole === 'OWNER' || activeRole === 'ACCOUNTS';

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
    <div className="min-h-screen bg-[#F6F8F7] text-[#243B40] flex flex-col pb-24">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#243B40] text-white px-4 py-2.5 rounded-2xl shadow-xl flex items-center space-x-2 text-xs font-semibold animate-slide-up border border-[#167D79]/40">
          <CheckCircle2 className="w-4 h-4 text-[#F4B860]" />
          <span>{notification}</span>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-3.5 py-2.5 shadow-2xs">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <BusinessSwitcher
            activeIndustry={activeIndustry}
            onSelectIndustry={(ind) => {
              setActiveIndustry(ind);
              setSelectedStage('ALL');
              triggerToast(`${messages.industries.selectActive}: ${INDUSTRY_TEMPLATES[ind].name[locale]}`);
            }}
            locale={locale}
          />

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

      {/* Main Content Container */}
      <main className="max-w-lg mx-auto w-full px-4 pt-3.5 space-y-4">
        {/* Banner with Role Simulator for Live Testing */}
        <div className="bg-gradient-to-r from-[#243B40] to-[#126360] rounded-2xl p-4 text-white shadow-md relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <span className="inline-flex items-center space-x-1 text-[11px] font-bold uppercase tracking-wider text-[#F4B860] bg-black/20 px-2 py-0.5 rounded-md">
                <ShoppingBag className="w-3.5 h-3.5 text-[#F4B860]" />
                <span>{template.name[locale]}</span>
              </span>
              <h1 className="text-lg font-black mt-1 tracking-tight text-white">
                {locale === 'ta' ? 'உற்பத்தி ஆர்டர்கள்' : 'Production Floor Orders'}
              </h1>
              <p className="text-xs text-slate-200 mt-0.5">
                {orders.length} {locale === 'ta' ? 'ஆர்டர்கள்' : 'orders'} • ₹{totalBalanceDue.toLocaleString('en-IN')}{' '}
                {locale === 'ta' ? 'பாக்கி' : 'balance due'}
              </p>
            </div>

            <button
              onClick={fetchOrders}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors text-white"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Interactive Role Switcher Pill Bar (Demonstrating RBAC Matrix) */}
          <div className="mt-3.5 pt-3 border-t border-white/15">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-300 flex items-center space-x-1 mb-1.5">
              <UserCheck className="w-3.5 h-3.5 text-[#F4B860]" />
              <span>{locale === 'ta' ? 'பயனர் பொறுப்பு (RBAC Matrix):' : 'Active Role (RBAC Matrix):'}</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {[
                { role: 'OWNER', label: locale === 'ta' ? 'உரிமையாளர்' : 'Owner' },
                { role: 'PRODUCTION', label: locale === 'ta' ? 'ஆபரேட்டர்' : 'Floor Operator' },
                { role: 'ACCOUNTS', label: locale === 'ta' ? 'கணக்காளர்' : 'Accounts' },
              ].map((r) => {
                const isSelected = activeRole === r.role;
                return (
                  <button
                    key={r.role}
                    onClick={() => {
                      setActiveRole(r.role as TenantRole);
                      triggerToast(`Switched to ${r.label}`);
                    }}
                    className={`py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all ${
                      isSelected
                        ? 'bg-[#F4B860] text-[#243B40] shadow-sm'
                        : 'bg-white/10 text-slate-200 hover:bg-white/20'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Financial Metrics Row */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {locale === 'ta' ? 'மொத்த ஆர்டர்கள்' : 'Total Orders'}
            </div>
            <div className="text-lg font-extrabold text-[#167D79] mt-0.5">
              {orders.length}
            </div>
          </div>

          <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {locale === 'ta' ? 'ஆர்டர் மதிப்பு' : 'Order Value'}
            </div>
            <div className="text-lg font-extrabold text-[#243B40] mt-0.5 truncate">
              ₹{(totalAmountSum / 1000).toFixed(0)}k
            </div>
          </div>

          <div className="bg-white p-3 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {locale === 'ta' ? 'வரவேண்டியது' : 'Balance Due'}
            </div>
            <div className="text-lg font-extrabold text-rose-600 mt-0.5 truncate">
              ₹{(totalBalanceDue / 1000).toFixed(0)}k
            </div>
          </div>
        </div>

        {/* Stage Filter Bar */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#243B40] flex items-center space-x-1.5">
              <Filter className="w-4 h-4 text-[#167D79]" />
              <span>{locale === 'ta' ? 'நிலை வாரியாக வடிகட்டுக' : 'Filter by Production Stage'}</span>
            </h2>
            <span className="text-[11px] font-semibold text-slate-400">
              ({displayedOrders.length})
            </span>
          </div>

          {/* Swipeable Stage Filter Pills */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1.5 scrollbar-none">
            <button
              onClick={() => setSelectedStage('ALL')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                selectedStage === 'ALL'
                  ? 'bg-[#167D79] text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-[#243B40]'
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
                      ? 'bg-[#167D79] text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-600 hover:text-[#243B40]'
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
                        isSelected ? 'bg-white/30 text-white' : 'bg-slate-100 text-slate-600'
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
          {displayedOrders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-400 space-y-1">
              <p className="font-semibold text-slate-600">
                {locale === 'ta' ? 'இந்த நிலையில் ஆர்டர்கள் எதுவும் இல்லை' : 'No orders in this stage'}
              </p>
              <p>
                {locale === 'ta'
                  ? 'மேலே உள்ள பிற நிலைகளைத் தேர்ந்தெடுக்கவும்'
                  : 'Select another stage or switch active industry above.'}
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

      {/* Fixed Mobile Bottom Nav */}
      <MobileBottomNav
        currentTab="orders"
        onTabChange={(tab) => {
          if (tab === 'orders') return;
          router.push(`/?tab=${tab}`);
        }}
        onQuickAction={() => router.push('/')}
        pendingTasksCount={2}
        locale={locale}
        messages={messages}
      />
    </div>
  );
}
