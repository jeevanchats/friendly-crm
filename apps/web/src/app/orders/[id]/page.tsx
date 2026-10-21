'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { OrderDetailView } from '../../../components/orders/OrderDetailView';
import { MobileBottomNav } from '../../../components/layout/MobileBottomNav';
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
  const orderId = (params?.id as string) || 'ord-demo-1';

  const roleParam = (searchParams?.get('role') as TenantRole) || 'OWNER';
  const langParam = (searchParams?.get('lang') as 'en' | 'ta') || 'en';

  const [locale, setLocale] = useState<'en' | 'ta'>(langParam);
  const [activeIndustry, setActiveIndustry] = useState<IndustryKey>(
    orderId.includes('furn') ? 'furniture' : 'printing'
  );
  const [activeRole, setActiveRole] = useState<TenantRole>(roleParam);

  const getFallbackOrderDetail = useCallback((): any => {
    const isFurniture = orderId.includes('furn') || activeIndustry === 'furniture';
    if (isFurniture) {
      return {
        id: orderId,
        orderNumber: 'ORD-2026-4915',
        productionStage: 'WOOD_CUTTING',
        totalAmount: '97800.00',
        advanceReceived: '30000.00',
        balanceDue: '67800.00',
        expectedDeliveryAt: new Date(Date.now() + 10 * 86400000).toISOString(),
        customData: {
          material_type: 'TEAK_WOOD',
          finish: 'WALNUT_MATTE',
          dimensions_lwh: '72x36x30 inches',
          warranty_years: 5,
          installation_required: true,
          artwork_approved: true,
          transport_lr_no: 'VRL-LOGISTICS-7782',
        },
        customer: {
          id: 'c-demo-3',
          name: 'Grand Royal Residency',
          phone: '+919444123890',
          companyName: 'Royal Hospitality Pvt Ltd',
          gstin: '33AABCR1234F1Z8',
        },
        items: [
          {
            id: 'item-f1',
            itemName: 'Solid Teak 6-Seater Dining Table',
            description: 'Seasoned CP Teak with Polyurethane Matte Coat',
            quantity: '1',
            unit: 'Set',
            unitPrice: '58000.00',
            taxPercent: '18.00',
            lineTotal: '68440.00',
          },
          {
            id: 'item-f2',
            itemName: 'Cushioned Teak Dining Chairs',
            description: 'Matching teak chairs with washable fabric seat',
            quantity: '6',
            unit: 'Nos',
            unitPrice: '4500.00',
            taxPercent: '18.00',
            lineTotal: '31860.00',
          },
        ],
        payments: [
          {
            id: 'pay-f1',
            receiptNumber: 'RCP-2026-0045',
            amount: '30000.00',
            mode: 'BANK_TRANSFER',
            referenceNo: 'IMPS/HDFC/81923019',
            paidAt: new Date(Date.now() - 3600000 * 48).toISOString(),
          },
        ],
        timeline: [
          {
            id: 'tl-1',
            action: 'ORDER_PLACED',
            actorName: 'Anand Kumar',
            createdAt: new Date(Date.now() - 3600000 * 50).toISOString(),
          },
          {
            id: 'tl-2',
            action: 'MEASUREMENT_CONFIRMED',
            actorName: 'Ramesh (Site Engineer)',
            createdAt: new Date(Date.now() - 3600000 * 36).toISOString(),
          },
          {
            id: 'tl-3',
            action: 'WOOD_CUTTING_STARTED',
            actorName: 'Murugan (Floor Operator)',
            createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
          },
        ],
      };
    }

    return {
      id: orderId,
      orderNumber: 'ORD-2026-8956',
      productionStage: 'ARTWORK_PENDING',
      totalAmount: '147680.00',
      advanceReceived: '50000.00',
      balanceDue: '97680.00',
      expectedDeliveryAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      customData: {
        job_type: 'PACKAGING_BOX',
        paper_board_gsm: '350 GSM Cyber Premium Board',
        dimensions_lwh: '12x9x4 inches',
        plate_size: '28x40 inch CTP',
        artwork_approved: true,
        print_colors: 'CMYK_4C',
        finishing_ops: ['MATT_LAM', 'DIE_PUNCH'],
        transport_lr_no: 'ARC-PARCEL-8192',
      },
      customer: {
        id: 'c-demo-1',
        name: 'Sri Murugan Textiles & Sweets',
        phone: '+919840123456',
        companyName: 'Murugan Retailers Pvt Ltd',
        gstin: '33AAAAA0000A1Z5',
      },
      items: [
        {
          id: 'item-p1',
          itemName: 'Embossed Gold Sweet Box (Heavy Duty)',
          description: '400 GSM premium rigid box with metallic gold foil stamping',
          quantity: '3000',
          unit: 'Nos',
          unitPrice: '42.00',
          taxPercent: '18.00',
          lineTotal: '148680.00',
        },
      ],
      payments: [
        {
          id: 'pay-p1',
          receiptNumber: 'RCP-2026-8956',
          amount: '50000.00',
          mode: 'UPI',
          referenceNo: 'UPI/GPAY/98127391823',
          paidAt: new Date(Date.now() - 3600000 * 20).toISOString(),
        },
      ],
      timeline: [
        {
          id: 'tl-1',
          action: 'QUOTATION_CONVERTED',
          actorName: 'Anand Kumar (Sales)',
          createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
        },
        {
          id: 'tl-2',
          action: 'ADVANCE_RECORDED',
          actorName: 'Suresh (Accounts)',
          createdAt: new Date(Date.now() - 3600000 * 20).toISOString(),
        },
      ],
    };
  }, [orderId, activeIndustry]);

  const [orderData, setOrderData] = useState<any>(() => getFallbackOrderDetail());
  const [loading, setLoading] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  const messages = locale === 'en' ? enMessages : taMessages;

  const triggerToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchOrderDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        headers: {
          'x-tenant-id': `t-demo-${activeIndustry}`,
          'x-user-role': activeRole,
        },
      });

      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (data && data.orderNumber) {
          setOrderData(data);
          if (data.customData?.wood_type) {
            setActiveIndustry('furniture');
          }
        } else {
          setOrderData(getFallbackOrderDetail());
        }
      } else {
        setOrderData(getFallbackOrderDetail());
      }
    } catch {
      setOrderData(getFallbackOrderDetail());
    } finally {
      setLoading(false);
    }
  }, [orderId, activeIndustry, activeRole, getFallbackOrderDetail]);

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
        {/* Interactive Role Switcher Banner (Direct RBAC Matrix Simulator) */}
        <div className="rounded-2xl bg-gradient-to-r from-[#243B40] to-[#126360] p-4 text-white shadow-sm border border-slate-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <UserCheck className="w-4 h-4 text-[#F4B860]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#F4B860]">
                  {locale === 'ta' ? 'பயனர் பொறுப்பு மாற்றி (RBAC Simulator)' : 'Active User Role (RBAC Matrix Simulator)'}
                </span>
              </div>
              <p className="text-xs text-slate-200 mt-1">
                {activeRole === 'OWNER'
                  ? locale === 'ta'
                    ? '👑 உரிமையாளர்: கட்டண விவரங்கள் & ஜாப் கார்டு மாற்றங்கள் இரண்டும் தெரியும்.'
                    : '👑 OWNER View: Full financial collections, payment receipts & Job Card specs.'
                  : locale === 'ta'
                  ? '🏭 தயாரிப்பு ஆபரேட்டர்: கட்டண விவரங்கள் மறைக்கப்படும், ஜாப் கார்டு மட்டுமே மாற்ற இயலும்.'
                  : '🏭 PRODUCTION Operator: Collections & payment history hidden. Job Card specs editable.'}
              </p>
            </div>

            {/* Switcher Buttons */}
            <div className="flex items-center gap-1.5 bg-black/25 p-1 rounded-xl shrink-0">
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
                      triggerToast(`Switched view to ${r.label}`);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-[#F4B860] text-[#243B40] shadow-sm'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Order Detail View */}
        {loading || !orderData ? (
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

      {/* Bottom Nav */}
      <MobileBottomNav
        currentTab="orders"
        onTabChange={(tab) => {
          if (tab === 'orders') {
            router.push('/orders');
          } else {
            router.push(`/?tab=${tab}`);
          }
        }}
        onQuickAction={() => router.push('/')}
        pendingTasksCount={2}
        locale={locale}
        messages={messages}
      />
    </div>
  );
}
