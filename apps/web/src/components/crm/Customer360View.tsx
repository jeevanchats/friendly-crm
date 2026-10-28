'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface Customer360Props {
  data: any;
  defaultLang?: 'en' | 'ta';
}

export function Customer360View({ data, defaultLang = 'en' }: Customer360Props) {
  const [lang, setLang] = useState<'en' | 'ta'>(defaultLang);
  const [activeTab, setActiveTab] = useState<'ORDERS' | 'QUOTES' | 'PAYMENTS'>('ORDERS');
  const { customer, financialSummary, orders, quotations, payments, pendingTasks } = data;
  const cleanPhone = customer.phone.replace(/\D/g, '');

  return (
    <div className="space-y-5 pb-20 text-foreground">
      {/* 1. Customer Profile Header Card */}
      <div className="rounded-2xl bg-surface p-5 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">{customer.name}</h1>
            {customer.companyName && (
              <p className="text-sm font-semibold text-brand-ink">{customer.companyName}</p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {customer.phone} {customer.gstin ? `• GSTIN: ${customer.gstin}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}
            className="rounded-lg bg-action/25 px-3 py-1.5 text-xs font-bold"
          >
            {lang === 'en' ? 'தமிழ்' : 'English'}
          </button>
        </div>

        {/* 1-Tap Quick Actions: Call, WhatsApp, New Quote */}
        <div className="grid grid-cols-3 gap-2.5 pt-1">
          <a
            href={`tel:${customer.phone}`}
            className="flex min-h-[44px] items-center justify-center rounded-xl bg-surface text-xs font-bold border border-slate-200"
          >
            📞 {lang === 'ta' ? 'அழைக்க' : 'Call'}
          </a>
          <a
            href={`https://wa.me/${cleanPhone}`}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[44px] items-center justify-center rounded-xl bg-[#25D366]/15 text-xs font-bold text-[#128C7E]"
          >
            💬 WhatsApp
          </a>
          <Link
            href={`/quotations/new?customerId=${customer.id}`}
            className="flex min-h-[44px] items-center justify-center rounded-xl bg-action text-xs font-bold text-on-action shadow-sm"
          >
            + {lang === 'ta' ? 'கொட்டேஷன்' : 'New Quote'}
          </Link>
        </div>
      </div>

      {/* 2. Role-Gated Financial Summary Bar */}
      {financialSummary && (
        <div className="grid grid-cols-3 gap-3 rounded-2xl bg-surface border border-slate-200 p-4 text-brand-ink">
          <div>
            <span className="block text-[11px] text-slate-600">
              {lang === 'ta' ? 'மொத்த வர்த்தகம்' : 'Lifetime Orders'}
            </span>
            <span className="text-base font-bold">₹{financialSummary.lifetimeOrderValue}</span>
          </div>
          <div>
            <span className="block text-[11px] text-slate-600">
              {lang === 'ta' ? 'கடன் வரம்பு' : 'Credit Limit'}
            </span>
            <span className="text-base font-bold text-slate-700">
              ₹{financialSummary.creditLimit}
            </span>
          </div>
          <div>
            <span className="block text-[11px] text-slate-600">
              {lang === 'ta' ? 'மொத்த பாக்கி' : 'Net Balance Due'}
            </span>
            <span className="text-base font-extrabold text-brand-ink">
              ₹{financialSummary.totalPendingBalance}
            </span>
          </div>
        </div>
      )}

      {/* 3. Pending Follow-ups Banner */}
      {pendingTasks?.length > 0 && (
        <div className="rounded-xl bg-action/20 p-3.5 border border-brand-ink">
          <p className="text-xs font-bold text-foreground">
            ⏰ {lang === 'ta' ? 'அடுத்த பின்தொடர்தல்:' : 'Upcoming Follow-Up:'}{' '}
            {pendingTasks[0].title} ({new Date(pendingTasks[0].dueAt).toLocaleDateString()})
          </p>
        </div>
      )}

      {/* 4. History Tabs: Orders | Quotations | Payments */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {[
          { id: 'ORDERS', en: `Orders (${orders.length})`, ta: `ஆர்டர்கள் (${orders.length})` },
          { id: 'QUOTES', en: `Quotes (${quotations.length})`, ta: `கொட்டேஷன் (${quotations.length})` },
          ...(financialSummary
            ? [{ id: 'PAYMENTS', en: `Receipts (${payments.length})`, ta: `ரசீதுகள் (${payments.length})` }]
            : []),
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`min-h-[44px] rounded-xl px-4 text-xs font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-action text-on-action'
                : 'bg-surface text-slate-600 border border-slate-200'
            }`}
          >
            {(tab as any)[lang]}
          </button>
        ))}
      </div>

      {/* Tab Content: Orders */}
      {activeTab === 'ORDERS' && (
        <div className="space-y-3">
          {orders.map((ord: any) => (
            <Link
              key={ord.id}
              href={`/orders/${ord.id}`}
              className="flex items-center justify-between rounded-xl bg-surface p-4 shadow-sm border border-slate-200 hover:border-brand-ink"
            >
              <div>
                <span className="text-xs font-bold text-brand-ink">{ord.orderNumber}</span>
                <p className="text-sm font-bold text-foreground">{ord.productionStage}</p>
                <span className="text-[11px] text-slate-600">
                  {new Date(ord.createdAt).toLocaleDateString()}
                </span>
              </div>
              {ord.totalAmount && (
                <div className="text-right">
                  <p className="text-sm font-bold">₹{ord.totalAmount}</p>
                  <p className="text-xs font-semibold text-rose-600">
                    {lang === 'ta' ? 'பாக்கி' : 'Due'}: ₹{ord.balanceDue}
                  </p>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Tab Content: Quotations */}
      {activeTab === 'QUOTES' && (
        <div className="space-y-3">
          {quotations.map((qt: any) => (
            <div
              key={qt.id}
              className="flex items-center justify-between rounded-xl bg-surface p-4 shadow-sm border border-slate-200"
            >
              <div>
                <span className="text-xs font-bold text-brand-ink">
                  {qt.quoteNumber} (v{qt.version})
                </span>
                <p className="text-xs font-semibold text-slate-500">{qt.status}</p>
              </div>
              <div className="text-right">
                {qt.grandTotal != null && (
                  <p className="text-sm font-bold">₹{qt.grandTotal}</p>
                )}
                <Link
                  href={`/q/${qt.id}/pdf`}
                  className="text-xs font-bold text-brand-ink underline"
                >
                  {lang === 'ta' ? 'PDF பார்க்க' : 'View PDF'}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab Content: Payment Receipts */}
      {activeTab === 'PAYMENTS' && (
        <div className="space-y-2.5">
          {payments.map((p: any) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl bg-surface p-3.5 border border-slate-200"
            >
              <div>
                <span className="text-xs font-bold text-foreground">{p.receiptNumber}</span>
                <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold">
                  {p.mode}
                </span>
                <p className="text-[11px] text-slate-600">
                  {new Date(p.paidAt).toLocaleDateString()}
                </p>
              </div>
              <span className="text-sm font-extrabold text-emerald-600">+₹{p.amount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}