'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { INDUSTRY_TEMPLATES, IndustryKey, getIndustryTemplate } from '@friendly-crm/shared';

interface OrderCardProps {
  order: {
    id: string;
    orderNumber: string;
    productionStage: string;
    totalAmount: string;
    advanceReceived: string;
    balanceDue: string;
    customData: Record<string, any>;
    customer: { name: string; phone: string; companyName?: string };
  };
  industry: IndustryKey;
  lang?: 'en' | 'ta';
  canUpdateStage?: boolean;
  canRecordPayment?: boolean;
  onRefresh?: () => void;
}

export function OrderStageCard({
  order,
  industry,
  lang = 'en',
  canUpdateStage = true,
  canRecordPayment = true,
  onRefresh,
}: OrderCardProps) {
  const [currentStage, setCurrentStage] = useState(order.productionStage);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState<'UPI' | 'CASH' | 'BANK_TRANSFER'>('UPI');

  const template = getIndustryTemplate(industry);
  const stages = template.orderStages;
  const activeStageObj = stages.find((s) => s.id === currentStage) || stages[0];

  const handleStageChange = async (nextStageId: string) => {
    if (!canUpdateStage) return;
    setCurrentStage(nextStageId);
    try {
      await fetch(`/api/orders/${order.id}/stage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': `t-demo-${industry}`,
        },
        body: JSON.stringify({ nextStageId }),
      });
      onRefresh?.();
    } catch (err) {
      console.error('Failed to update stage', err);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch(`/api/orders/${order.id}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': `t-demo-${industry}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          amount: Number(payAmount),
          mode: payMode,
        }),
      });
      setShowPayModal(false);
      setPayAmount('');
      onRefresh?.();
    } catch (err) {
      console.error('Failed to record payment', err);
    }
  };

  const buildWhatsAppStatusUrl = () => {
    const cleanPhone = order.customer.phone.replace(/\D/g, '');
    const balanceText = order.balanceDue != null
      ? (lang === 'ta' ? `\nபாக்கித் தொகை: ₹${order.balanceDue}` : `\nBalance Due: ₹${order.balanceDue}`)
      : '';
    const msg =
      lang === 'ta'
        ? `வணக்கம் ${order.customer.name},\nஉங்கள் ஆர்டர் *${order.orderNumber}* தற்போதைய நிலை: *${activeStageObj.label.ta}*.${balanceText}`
        : `Hello ${order.customer.name},\nYour Order *${order.orderNumber}* status is now: *${activeStageObj.label.en}*.${balanceText}`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      {/* Header - Clickable to navigate to /orders/[id] */}
      <div className="flex items-start justify-between">
        <Link
          href={`/orders/${order.id}`}
          className="group block flex-1 cursor-pointer"
        >
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-[#167D79] group-hover:underline">
              {order.orderNumber}
            </span>
            <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-[#167D79] transition-colors" />
          </div>
          <h3 className="text-base font-bold text-[#243B40] group-hover:text-[#167D79] transition-colors">
            {order.customer.name}
          </h3>
          {order.customer.companyName && (
            <p className="text-xs text-slate-400">{order.customer.companyName}</p>
          )}
        </Link>
        <span
          style={{ backgroundColor: `${activeStageObj.color}20`, color: activeStageObj.color }}
          className="rounded-full px-3 py-1 text-xs font-bold shrink-0 ml-2"
        >
          {activeStageObj.label[lang]}
        </span>
      </div>

      {/* Swipeable Touch Stage Pills */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase text-slate-400">
          {lang === 'ta' ? 'பணி நிலை (Tap to Update Stage)' : 'Production Stage (Tap to Update)'}
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {stages.map((st) => {
            const isSelected = st.id === currentStage;
            return (
              <button
                key={st.id}
                type="button"
                disabled={!canUpdateStage}
                onClick={() => handleStageChange(st.id)}
                className={`min-h-[40px] shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  isSelected
                    ? 'bg-[#167D79] text-white shadow-sm'
                    : 'bg-[#F6F8F7] text-[#243B40] border border-slate-200'
                }`}
              >
                {st.label[lang]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Financials Summary Bar */}
      <div className="grid grid-cols-3 rounded-xl bg-[#F6F8F7] p-3 text-center border border-slate-200">
        <div>
          <span className="block text-[11px] text-slate-500">
            {lang === 'ta' ? 'மொத்தம்' : 'Total'}
          </span>
          <span className="text-sm font-bold text-[#243B40]">
            {order.totalAmount != null ? `₹${order.totalAmount}` : '—'}
          </span>
        </div>
        <div>
          <span className="block text-[11px] text-slate-500">
            {lang === 'ta' ? 'அட்வான்ஸ்' : 'Received'}
          </span>
          <span className="text-sm font-bold text-emerald-600">
            {order.advanceReceived != null ? `₹${order.advanceReceived}` : '—'}
          </span>
        </div>
        <div>
          <span className="block text-[11px] text-slate-500">
            {lang === 'ta' ? 'பாக்கி' : 'Balance'}
          </span>
          <span className="text-sm font-bold text-rose-600">
            {order.balanceDue != null ? `₹${order.balanceDue}` : '—'}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        <Link
          href={`/orders/${order.id}`}
          className="flex min-h-[44px] items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#243B40] transition-colors text-center"
        >
          {lang === 'ta' ? 'ஜாப் கார்டு' : 'Job Card'}
        </Link>
        <a
          href={buildWhatsAppStatusUrl()}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#25D366]/15 hover:bg-[#25D366]/25 text-xs font-bold text-[#128C7E] transition-colors text-center"
        >
          {lang === 'ta' ? 'வாட்ஸ்அப்' : 'WhatsApp'}
        </a>
        {canRecordPayment && order.balanceDue != null && parseFloat(order.balanceDue) > 0 ? (
          <button
            type="button"
            onClick={() => setShowPayModal(!showPayModal)}
            className="min-h-[44px] rounded-xl bg-[#F4B860] hover:bg-[#F4B860]/90 text-xs font-bold text-[#243B40] transition-colors text-center"
          >
            + {lang === 'ta' ? 'வரவு' : 'Payment'}
          </button>
        ) : (
          <Link
            href={`/orders/${order.id}`}
            className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#167D79]/10 text-xs font-bold text-[#167D79] text-center"
          >
            {lang === 'ta' ? 'விவரம்' : 'Details'}
          </Link>
        )}
      </div>

      {/* Inline Quick Payment Drawer */}
      {showPayModal && (
        <form onSubmit={handleRecordPayment} className="space-y-3 rounded-xl bg-slate-50 p-3 border">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              required
              max={ parseFloat(order.balanceDue) }
              placeholder={`₹ Max ${order.balanceDue}`}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              className="min-h-[42px] rounded-lg border px-3 text-sm"
            />
            <select
              value={payMode}
              onChange={(e) => setPayMode(e.target.value as any)}
              className="min-h-[42px] rounded-lg border px-2 text-sm bg-white"
            >
              <option value="UPI">UPI / GPay</option>
              <option value="CASH">Cash (ரொக்கம்)</option>
              <option value="BANK_TRANSFER">NEFT / IMPS</option>
            </select>
          </div>
          <button
            type="submit"
            className="min-h-[42px] w-full rounded-lg bg-[#167D79] text-xs font-bold text-white"
          >
            {lang === 'ta' ? 'ரசீது சேமி (Save Receipt)' : 'Confirm & Generate Receipt'}
          </button>
        </form>
      )}
    </div>
  );
}