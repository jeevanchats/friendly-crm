'use client';

import React, { useState } from 'react';

interface HomeDashboardProps {
  userName: string;
  lang: 'en' | 'ta';
  data: {
    summaryCards: {
      dueFollowUps: number;
      openQuotations: number;
      openQuotationsValue: string;
      activeOrders: number;
      totalReceivables: string | null;
    };
    priorityTasks: Array<{
      id: string;
      type: string;
      title: string;
      dueAt: string;
      customerId: string;
      customerName: string;
      customerPhone: string;
    }>;
  };
  onRefresh?: () => void;
}

export function HomeDashboard({ userName, lang, data, onRefresh }: HomeDashboardProps) {
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [outcomeNote, setOutcomeNote] = useState('');

  const handleCompleteTask = async (taskId: string) => {
    try {
      await fetch(`/api/crm/tasks/${taskId}/complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': 't-demo-printing',
        },
        body: JSON.stringify({ outcomeNote: outcomeNote || 'Spoke with customer' }),
      });
      setCompletingTaskId(null);
      setOutcomeNote('');
      onRefresh?.();
    } catch (err) {
      console.error('Failed to complete task', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Greeting Banner */}
      <div>
        <h1 className="text-xl font-bold text-[#243B40]">
          {lang === 'ta' ? `வணக்கம், ${userName} 👋` : `Welcome back, ${userName} 👋`}
        </h1>
        <p className="text-xs text-slate-500">
          {lang === 'ta'
            ? 'இன்றைய முக்கிய பணிகள் மற்றும் ஆர்டர்களின் சுருக்கம்'
            : "Here is today's business summary and follow-up queue."}
        </p>
      </div>

      {/* 4 KPI Summary Cards (Section 4 Spec) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm border-l-4 border-[#F4B860]">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'இன்றைய பின்தொடர்தல்' : 'Follow-Ups Due'}
          </span>
          <p className="mt-1 text-2xl font-extrabold text-[#243B40]">
            {data.summaryCards.dueFollowUps}
          </p>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm border-l-4 border-[#167D79]">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'திறந்த கொட்டேஷன்கள்' : 'Open Quotations'}
          </span>
          <p className="mt-1 text-2xl font-extrabold text-[#243B40]">
            {data.summaryCards.openQuotations}
          </p>
          <span className="text-[11px] font-semibold text-[#167D79]">
            ₹{data.summaryCards.openQuotationsValue}
          </span>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm border-l-4 border-indigo-500">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'நடப்பு ஆர்டர்கள்' : 'Active Orders'}
          </span>
          <p className="mt-1 text-2xl font-extrabold text-[#243B40]">
            {data.summaryCards.activeOrders}
          </p>
        </div>

        {data.summaryCards.totalReceivables !== null && (
          <div className="rounded-2xl bg-white p-4 shadow-sm border-l-4 border-rose-500">
            <span className="text-xs font-semibold text-slate-500">
              {lang === 'ta' ? 'வரவேண்டிய பாக்கி' : 'Receivables'}
            </span>
            <p className="mt-1 text-xl font-extrabold text-rose-600">
              ₹{data.summaryCards.totalReceivables}
            </p>
          </div>
        )}
      </div>

      {/* Priority Follow-Up Queue (Overdue + Today) */}
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[#243B40]">
            {lang === 'ta'
              ? 'முக்கிய பின்தொடர்தல் பட்டியல் (Priority Follow-ups)'
              : 'Priority Follow-Up Queue'}
          </h2>
          <span className="rounded-full bg-[#F4B860]/25 px-3 py-1 text-xs font-bold text-[#243B40]">
            {data.priorityTasks.length} {lang === 'ta' ? 'பணிகள்' : 'Pending'}
          </span>
        </div>

        {data.priorityTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            {lang === 'ta'
              ? 'இன்றைய பின்தொடர்தல் அனைத்தும் முடிந்தது! 🎉'
              : 'All caught up! No overdue or pending follow-ups for today. 🎉'}
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.priorityTasks.map((task) => {
              const isOverdue = new Date(task.dueAt).getTime() < Date.now();
              const cleanPhone = task.customerPhone.replace(/\D/g, '');

              return (
                <div key={task.id} className="py-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                            isOverdue
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isOverdue
                            ? lang === 'ta' ? 'தாமதம் (Overdue)' : 'Overdue'
                            : lang === 'ta' ? 'இன்று (Today)' : 'Due Today'}
                        </span>
                        <span className="text-xs font-bold text-[#167D79]">
                          {task.customerName}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-[#243B40]">{task.title}</p>
                    </div>

                    {/* 1-Tap Action Buttons: Call, WhatsApp, Done */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={`tel:${task.customerPhone}`}
                        className="flex min-h-[40px] items-center rounded-lg bg-[#F6F8F7] px-3 text-xs font-bold text-[#243B40] border border-slate-200"
                      >
                        📞 {lang === 'ta' ? 'அழை' : 'Call'}
                      </a>
                      <a
                        href={`https://wa.me/${cleanPhone}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-[40px] items-center rounded-lg bg-[#25D366]/15 px-3 text-xs font-bold text-[#128C7E]"
                      >
                        💬 WA
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          setCompletingTaskId(completingTaskId === task.id ? null : task.id)
                        }
                        className="min-h-[40px] rounded-lg bg-[#167D79] px-3 text-xs font-bold text-white"
                      >
                        ✓ {lang === 'ta' ? 'முடி' : 'Done'}
                      </button>
                    </div>
                  </div>

                  {/* Quick Outcome Note Box */}
                  {completingTaskId === task.id && (
                    <div className="flex gap-2 pt-2">
                      <input
                        type="text"
                        placeholder={
                          lang === 'ta'
                            ? 'வாடிக்கையாளர் என்ன சொன்னார்? (Note)'
                            : 'Outcome note (e.g., Asked for revised quote tomorrow)'
                        }
                        value={outcomeNote}
                        onChange={(e) => setOutcomeNote(e.target.value)}
                        className="min-h-[40px] flex-1 rounded-lg border border-slate-300 px-3 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleCompleteTask(task.id)}
                        className="min-h-[40px] rounded-lg bg-[#F4B860] px-4 text-xs font-bold text-[#243B40]"
                      >
                        {lang === 'ta' ? 'சேமி' : 'Confirm'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}