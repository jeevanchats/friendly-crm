'use client';

import React, { useState } from 'react';

interface ReportsProps {
  data: any;
  defaultLang?: 'en' | 'ta';
}

export function ReportsDashboard({ data, defaultLang = 'en' }: ReportsProps) {
  const [lang, setLang] = useState<'en' | 'ta'>(defaultLang);
  const { funnel, financials, topDebtors, repeatOpportunities } = data;

  return (
    <div className="space-y-6 pb-20 text-[#243B40]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">
            {lang === 'ta' ? 'விற்பனை மற்றும் பாக்கி அறிக்கை' : 'Sales, Collections & Repeat Insights'}
          </h1>
          <p className="text-xs text-slate-500">
            {lang === 'ta'
              ? 'உங்கள் நிறுவனத்தின் முழு வர்த்தக பகுப்பாய்வு'
              : 'Conversion performance, pending collections, and repeat-order radar'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'ta' : 'en')}
          className="rounded-lg bg-[#F4B860]/25 px-3 py-1.5 text-xs font-bold"
        >
          {lang === 'en' ? 'தமிழ்' : 'English'}
        </button>
      </div>

      {/* 1. Conversion & Revenue KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'வெற்றி விகிதம் (Conversion)' : 'Lead Conversion'}
          </span>
          <p className="mt-1 text-2xl font-extrabold text-[#167D79]">
            {funnel.conversionRatePercent}%
          </p>
          <span className="text-[11px] text-slate-400">
            {funnel.wonLeads} / {funnel.totalLeads} {lang === 'ta' ? 'ஆர்டர்கள்' : 'Leads Won'}
          </span>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'மொத்த ஆர்டர் மதிப்பு' : 'Total Sales Booked'}
          </span>
          <p className="mt-1 text-xl font-extrabold text-[#243B40]">
            ₹{financials.totalSalesBooked}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'வசூலான தொகை' : 'Total Collected'}
          </span>
          <p className="mt-1 text-xl font-extrabold text-emerald-600">
            ₹{financials.totalCollected}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'மொத்த பாக்கி (Receivables)' : 'Pending Receivables'}
          </span>
          <p className="mt-1 text-xl font-extrabold text-rose-600">
            ₹{financials.totalPendingReceivables}
          </p>
        </div>
      </div>

      {/* 2. Top Pending Collections List with 1-Tap WhatsApp Payment Reminder */}
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 space-y-3">
        <h2 className="text-sm font-bold text-[#243B40]">
          💳 {lang === 'ta' ? 'வரவேண்டிய பாக்கி பட்டியல் (Top Receivables)' : 'Pending Collections Recovery'}
        </h2>
        <div className="divide-y divide-slate-100">
          {topDebtors?.map((d: any) => {
            const cleanPhone = d.customerPhone.replace(/\D/g, '');
            const reminderMsg =
              lang === 'ta'
                ? `வணக்கம் ${d.customerName}, உங்கள் ஆர்டரின் நிலுவைத் தொகை *₹${d.totalDue}* செலுத்தும்படி அன்புடன் கேட்டுக்கொள்கிறோம்.`
                : `Hello ${d.customerName}, gentle reminder regarding your pending balance of *₹${d.totalDue}*. Kindly share the payment confirmation once completed.`;

            return (
              <div key={d.customerId} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-bold text-[#243B40]">{d.customerName}</p>
                  <span className="text-xs text-slate-400">
                    {d.unpaidOrdersCount} {lang === 'ta' ? 'ஆர்டர்கள் நிலுவை' : 'Unpaid Orders'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-extrabold text-rose-600">₹{d.totalDue}</span>
                  <a
                    href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(reminderMsg)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-[#25D366]/15 px-3 py-2 text-xs font-bold text-[#128C7E]"
                  >
                    {lang === 'ta' ? 'வாட்ஸ்அப் நினைவூட்டல்' : 'Send Reminder'}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Section 8 Business Insight: Repeat-Order Radar (Inactive > 45 Days) */}
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 space-y-3">
        <h2 className="text-sm font-bold text-[#167D79]">
          🔁 {lang === 'ta' ? 'மறு ஆர்டர் வாய்ப்புகள் (Repeat-Order Radar)' : 'Repeat-Order Opportunities (45+ Days Inactive)'}
        </h2>
        <div className="divide-y divide-slate-100">
          {repeatOpportunities?.map((opp: any) => {
            const cleanPhone = opp.customerPhone.replace(/\D/g, '');
            const checkinMsg =
              lang === 'ta'
                ? `வணக்கம் ${opp.customerName}, புதிய சீசன் ஆர்டர்கள் மற்றும் சலுகைகள் தயாராக உள்ளன. உங்களுக்கு ஏதேனும் தேவை உள்ளதா?`
                : `Hello ${opp.customerName}, checking in from our team! Let us know if you have any upcoming requirements or repeat orders this month.`;

            return (
              <div key={opp.customerId} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-bold text-[#243B40]">{opp.customerName}</p>
                  <span className="text-xs text-slate-500">
                    {lang === 'ta' ? 'கடந்த வர்த்தகம்:' : 'Lifetime:'} ₹{opp.lifetimeSpent} ({opp.pastOrdersCount} orders)
                  </span>
                </div>
                <a
                  href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(checkinMsg)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-[#F4B860] px-3 py-2 text-xs font-bold text-[#243B40]"
                >
                  {lang === 'ta' ? 'மறு ஆர்டர் கேள்' : 'Ask Repeat Order'}
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}