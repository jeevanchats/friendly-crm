'use client';

import React, { useState, useEffect } from 'react';
import { CustomFieldRenderer } from '../dynamic/CustomFieldRenderer';
import {
  INDUSTRY_TEMPLATES,
  IndustryKey,
  getIndustryTemplate,
  hasPermission,
  TenantRole,
} from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';

interface OrderDetailProps {
  initialOrder: any;
  industry: IndustryKey;
  userRole: TenantRole;
  defaultLang?: 'en' | 'ta';
}

export function OrderDetailView({
  initialOrder,
  industry,
  userRole,
  defaultLang = 'en',
}: OrderDetailProps) {
  const [lang, setLang] = useState<'en' | 'ta'>(defaultLang);
  const [order, setOrder] = useState(initialOrder);
  const [customData, setCustomData] = useState<Record<string, any>>(initialOrder.customData || {});
  const [savingSpecs, setSavingSpecs] = useState(false);

  useEffect(() => {
    setOrder(initialOrder);
    setCustomData(initialOrder.customData || {});
  }, [initialOrder]);

  const template = getIndustryTemplate(industry);
  const stages = template.orderStages;
  const currentStageIdx = stages.findIndex((s: any) => s.id === order.productionStage);
  const activeStage = stages[currentStageIdx] || stages[0];

  const canUpdateStage = hasPermission(userRole, 'order:update_stage');
  const canViewPayments = hasPermission(userRole, 'payment:view');
  const canCreatePayment = hasPermission(userRole, 'payment:create');

  // Update Production Stage
  const handleStageSelect = async (nextStageId: string) => {
    if (!canUpdateStage) return;
    try {
      const res = await apiFetch(`/api/orders/${order.id}/stage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nextStageId, customDataUpdates: customData }),
      });
      if (res.ok) {
        setOrder((prev: any) => ({ ...prev, productionStage: nextStageId }));
      }
    } catch (err) {
      console.error('Failed to update stage', err);
    }
  };

  // Save updated Job Card Custom Fields (e.g., Artwork Approved, Transport LR No)
  const handleSaveJobSpecs = async () => {
    setSavingSpecs(true);
    try {
      const res = await apiFetch(`/api/orders/${order.id}/stage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nextStageId: order.productionStage,
          customDataUpdates: customData,
        }),
      });
      if (res.ok) {
        setOrder((prev: any) => ({ ...prev, customData: { ...customData } }));
        alert(lang === 'ta' ? 'ஜாப் கார்டு விவரங்கள் சேமிக்கப்பட்டன!' : 'Job card specifications updated successfully!');
      }
    } catch (err) {
      console.error('Failed to save specs', err);
    } finally {
      setSavingSpecs(false);
    }
  };

  // Schedule Repeat-Order Follow-Up (Section 5 Final Step)
  const handleScheduleRepeatFollowUp = async (daysFromNow: number) => {
    const dueAt = new Date(Date.now() + daysFromNow * 86400000).toISOString();
    await apiFetch('/api/crm/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: order.customer.id,
        type: 'FOLLOW_UP_CALL',
        title: `Repeat Order Check-in for ${order.customer.name} (Ref: ${order.orderNumber})`,
        dueAt,
      }),
    });
    alert(lang === 'ta' ? 'மறு ஆர்டர் நினைவூட்டல் சேமிக்கப்பட்டது!' : 'Repeat order follow-up scheduled!');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-24 text-foreground">
      {/* 1. TOP HEADER BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-5 shadow-sm border border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-ink">
              {order.orderNumber}
            </span>
            <span
              style={{ backgroundColor: `${activeStage.color}20`, color: activeStage.color }}
              className="rounded-full px-3 py-0.5 text-xs font-bold"
            >
              {activeStage.label[lang]}
            </span>
          </div>
          <h1 className="mt-1 text-xl font-bold">{order.customer.name}</h1>
          <p className="text-xs text-slate-500">
            {order.customer.phone} {order.customer.gstin ? `• GSTIN: ${order.customer.gstin}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}
            className="min-h-[42px] rounded-xl bg-action/25 px-3.5 text-xs font-bold text-foreground"
          >
            {lang === 'en' ? 'தமிழ்' : 'English'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[42px] rounded-xl border border-slate-300 bg-surface px-3.5 text-xs font-semibold hover:bg-slate-50"
          >
            {lang === 'ta' ? 'ஜாப் கார்டு பிரிண்ட் (Print Job Card)' : 'Print Job Card'}
          </button>
        </div>
      </div>

      {/* 2. VISUAL PRODUCTION PIPELINE STEPPER */}
      <div className="rounded-2xl bg-surface p-5 shadow-sm border border-slate-200">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-600">
          {lang === 'ta' ? 'உற்பத்தி மற்றும் டெலிவரி நிலை' : 'Production & Delivery Pipeline'}
        </h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
          {stages.map((stage: any, idx: number) => {
            const isCompleted = idx < currentStageIdx;
            const isCurrent = idx === currentStageIdx;
            return (
              <button
                key={stage.id}
                type="button"
                disabled={!canUpdateStage}
                onClick={() => handleStageSelect(stage.id)}
                className={`flex min-h-[54px] flex-col justify-center rounded-xl p-2.5 text-left transition-all border ${
                  isCurrent
                    ? 'border-brand-ink bg-action text-on-action shadow-md'
                    : isCompleted
                    ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
                    : 'border-slate-200 bg-surface text-slate-600'
                }`}
              >
                <span className="text-[10px] font-bold uppercase opacity-75">
                  {lang === 'ta' ? `நிலை ${idx + 1}` : `Step ${idx + 1}`}
                </span>
                <span className="text-xs font-bold leading-tight">{stage.label[lang]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. TWO-COLUMN MAIN WORKSPACE: JOB CARD SPECS + LINE ITEMS */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Industry Job Card Specifications (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-2xl bg-surface p-5 shadow-sm border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">
                {lang === 'ta' ? 'ஜாப் கார்டு விவரங்கள் (Job Card Specs)' : 'Job Card & Work Specifications'}
              </h2>
              {canUpdateStage && (
                <button
                  type="button"
                  onClick={handleSaveJobSpecs}
                  disabled={savingSpecs}
                  className="rounded-lg bg-action px-3 py-1.5 text-xs font-semibold text-on-action print:hidden"
                >
                  {savingSpecs
                    ? lang === 'ta' ? 'சேமிக்கிறது...' : 'Saving...'
                    : lang === 'ta' ? 'மாற்றங்களை சேமி' : 'Save Specs'}
                </button>
              )}
            </div>

            <CustomFieldRenderer
              industry={industry}
              entity="ORDER"
              lang={lang}
              values={customData}
              onChange={(k, v) => setCustomData((prev) => ({ ...prev, [k]: v }))}
            />
          </div>

          {/* Order Line Items Table */}
          <div className="rounded-2xl bg-surface p-5 shadow-sm border border-slate-200">
            <h2 className="mb-3 text-sm font-bold text-foreground">
              {lang === 'ta' ? 'ஆர்டர் பொருட்கள் (Order Items)' : 'Order Line Items'}
            </h2>
            <div className="divide-y divide-slate-100">
              {order.items?.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-semibold text-foreground">{item.itemName}</p>
                    {item.description && (
                      <p className="text-xs text-slate-500">{item.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="rounded-md bg-surface px-2.5 py-1 text-xs font-bold text-brand-ink">
                      {item.quantity} {item.unit}
                    </span>
                    {canViewPayments && (
                      <p className="mt-1 text-xs font-semibold text-slate-600">₹{item.lineTotal}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Collections Ledger + Activity Audit Trail (5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          {/* Role-Gated Financial & Payment Receipts Box */}
          {canViewPayments && (
            <div className="rounded-2xl bg-surface p-5 shadow-sm border border-slate-200 space-y-4">
              <h2 className="text-sm font-bold text-foreground">
                {lang === 'ta' ? 'பணம் மற்றும் பாக்கி விவரம்' : 'Collections & Payment History'}
              </h2>

              <div className="grid grid-cols-3 rounded-xl bg-surface border border-slate-200 p-3.5 text-center text-brand-ink">
                <div>
                  <span className="block text-[10px] uppercase text-slate-600">
                    {lang === 'ta' ? 'மொத்தம்' : 'Order Total'}
                  </span>
                  <span className="text-sm font-bold">₹{order.totalAmount ?? '—'}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-600">
                    {lang === 'ta' ? 'வரவு' : 'Paid'}
                  </span>
                  <span className="text-sm font-bold text-emerald-400">
                    ₹{order.advanceReceived ?? '—'}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-600">
                    {lang === 'ta' ? 'பாக்கி' : 'Balance Due'}
                  </span>
                  <span className="text-sm font-bold text-brand-ink">₹{order.balanceDue ?? '—'}</span>
                </div>
              </div>

              {/* Payment Receipts List */}
              <div className="space-y-2">
                {order.payments?.length === 0 ? (
                  <p className="text-xs text-slate-600">
                    {lang === 'ta' ? 'இதுவரை பணம் பதிவு செய்யப்படவில்லை' : 'No payments recorded yet.'}
                  </p>
                ) : (
                  order.payments?.map((p: any) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-bold text-foreground">{p.receiptNumber}</span>
                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold">
                          {p.mode}
                        </span>
                      </div>
                      <span className="font-bold text-emerald-700">+₹{p.amount}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Repeat-Order & Relationship Follow-up Card (Section 5 Final Workflow Step) */}
          <div className="rounded-2xl bg-surface p-5 shadow-sm border border-slate-200 print:hidden">
            <h2 className="text-sm font-bold text-foreground">
              {lang === 'ta' ? 'மறு ஆர்டர் நினைவூட்டல் (Repeat Order)' : 'Schedule Repeat-Order Follow-Up'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {lang === 'ta'
                ? 'டெலிவரிக்குப் பிறகு அடுத்த ஆர்டருக்கு எப்போது அழைக்க வேண்டும்?'
                : 'Automatically remind sales team to check in for repeat business:'}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { days: 15, en: 'In 15 Days', ta: '15 நாட்களில்' },
                { days: 30, en: 'In 30 Days', ta: '1 மாதத்தில்' },
                { days: 90, en: 'In 3 Months', ta: '3 மாதங்களில்' },
              ].map((btn) => (
                <button
                  key={btn.days}
                  type="button"
                  onClick={() => handleScheduleRepeatFollowUp(btn.days)}
                  className="min-h-[44px] rounded-lg border border-brand-ink/30 bg-surface text-xs font-semibold text-brand-ink hover:bg-action hover:text-brand-ink"
                >
                  {btn[lang]}
                </button>
              ))}
            </div>
          </div>

          {/* Immutable Activity Audit Log (Section 5 & 6 Requirement) */}
          <div className="rounded-2xl bg-surface p-5 shadow-sm border border-slate-200 print:hidden">
            <h2 className="mb-3 text-sm font-bold text-foreground">
              {lang === 'ta' ? 'ஆர்டர் வரலாறு (Activity Trail)' : 'Audit Trail & History'}
            </h2>
            <div className="space-y-3 border-l-2 border-brand-ink/30 pl-3">
              {order.timeline?.map((log: any) => (
                <div key={log.id} className="text-xs">
                  <p className="font-semibold text-foreground">{log.action.replace(/_/g, ' ')}</p>
                  <p className="text-[11px] text-slate-600">
                    {log.actorName || 'System'} • {new Date(log.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}