'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/session';

interface HomeDashboardProps {
  userName: string;
  lang: 'en' | 'ta';
  data: {
    summaryCards: {
      /** Enquiries still waiting for a quote. */
      quotesToSend?: number;
      dueFollowUps: number;
      openQuotations: number;
      openQuotationsValue: string;
      activeOrders: number;
      totalReceivables: string | null;
    };
    /** Enquiries waiting for a quote, oldest first. */
    pendingQuotes?: Array<{
      leadId: string;
      title: string;
      priority: string;
      createdAt: string;
      dueAt: string | null;
      customerId: string;
      customerName: string;
      customerPhone: string;
    }>;
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

/** "2 h ago", "3 days ago": how long the customer has been waiting. */
function waiting(iso: string, lang: 'en' | 'ta'): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const n = mins < 60 ? mins : mins < 1440 ? Math.round(mins / 60) : Math.round(mins / 1440);
  const unit = mins < 60 ? (lang === 'ta' ? 'நிமி' : 'min') : mins < 1440 ? (lang === 'ta' ? 'மணி' : 'h') : lang === 'ta' ? 'நாள்' : n === 1 ? 'day' : 'days';
  return lang === 'ta' ? `${n} ${unit} முன்` : `${n} ${unit} ago`;
}

export function HomeDashboard({ userName, lang, data, onRefresh }: HomeDashboardProps) {
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [outcomeNote, setOutcomeNote] = useState('');
  const [closing, setClosing] = useState<string | null>(null);
  const pendingQuotes = data.pendingQuotes ?? [];

  /** The customer is not going ahead (or it was sorted out elsewhere): take the enquiry off the list. */
  const closeEnquiry = async (leadId: string) => {
    if (!window.confirm(lang === 'ta' ? 'இந்த விசாரணையை மூடலாமா? இனி கொட்டேஷன் நினைவூட்டல் வராது.' : 'Close this enquiry? You will no longer be reminded to send it a quote.')) return;
    setClosing(leadId);
    try {
      await apiFetch(`/api/crm/leads/${leadId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'LOST', notes: 'Closed from the Quotes to send list' }),
      });
      onRefresh?.();
    } finally {
      setClosing(null);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      await apiFetch(`/api/crm/tasks/${taskId}/complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
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
        <h1 className="text-xl font-bold text-foreground">
          {lang === 'ta' ? `வணக்கம், ${userName} 👋` : `Welcome back, ${userName} 👋`}
        </h1>
        <p className="text-xs text-slate-500">
          {lang === 'ta'
            ? 'இன்றைய முக்கிய பணிகள் மற்றும் ஆர்டர்களின் சுருக்கம்'
            : "Here is today's business summary and follow-up queue."}
        </p>
      </div>

      {/* 4 KPI Summary Cards (Section 4 Spec) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-2xl bg-surface p-4 shadow-sm border-l border-red-500">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'அனுப்ப வேண்டிய கொட்டேஷன்' : 'Quotes to Send'}
          </span>
          <p className="mt-1 text-2xl font-extrabold text-foreground">{data.summaryCards.quotesToSend ?? 0}</p>
        </div>

        <div className="rounded-2xl bg-surface p-4 shadow-sm border-l border-brand-ink">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'இன்றைய பின்தொடர்தல்' : 'Follow-Ups Due'}
          </span>
          <p className="mt-1 text-2xl font-extrabold text-foreground">
            {data.summaryCards.dueFollowUps}
          </p>
        </div>

        <div className="rounded-2xl bg-surface p-4 shadow-sm border-l border-brand-ink">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'திறந்த கொட்டேஷன்கள்' : 'Open Quotations'}
          </span>
          <p className="mt-1 text-2xl font-extrabold text-foreground">
            {data.summaryCards.openQuotations}
          </p>
          <span className="text-[11px] font-semibold text-brand-ink">
            ₹{data.summaryCards.openQuotationsValue}
          </span>
        </div>

        <div className="rounded-2xl bg-surface p-4 shadow-sm border-l border-indigo-500">
          <span className="text-xs font-semibold text-slate-500">
            {lang === 'ta' ? 'நடப்பு ஆர்டர்கள்' : 'Active Orders'}
          </span>
          <p className="mt-1 text-2xl font-extrabold text-foreground">
            {data.summaryCards.activeOrders}
          </p>
        </div>

        {data.summaryCards.totalReceivables !== null && (
          <div className="rounded-2xl bg-surface p-4 shadow-sm border-l border-rose-500">
            <span className="text-xs font-semibold text-slate-500">
              {lang === 'ta' ? 'வரவேண்டிய பாக்கி' : 'Receivables'}
            </span>
            <p className="mt-1 text-xl font-extrabold text-rose-600">
              ₹{data.summaryCards.totalReceivables}
            </p>
          </div>
        )}
      </div>

      {/* Quotes to send: every enquiry still waiting for its quote. This comes before ordinary follow-ups, because
          until the customer has a quote there is nothing to follow up on. */}
      <section aria-labelledby="quotes-to-send" className="rounded-2xl border-2 border-brand-ink/30 bg-surface p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="quotes-to-send" className="text-base font-bold text-foreground">
            {lang === 'ta' ? 'கொட்டேஷன் அனுப்ப வேண்டியவை' : 'Quotes to Send'}
          </h2>
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
            {data.summaryCards.quotesToSend ?? pendingQuotes.length} {lang === 'ta' ? 'காத்திருக்கின்றன' : 'waiting'}
          </span>
        </div>

        {pendingQuotes.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-600">
            {lang === 'ta' ? 'அனைத்து விசாரணைகளுக்கும் கொட்டேஷன் அனுப்பப்பட்டது! 🎉' : 'Every enquiry has its quote. 🎉'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {pendingQuotes.map((q) => {
              const due = q.dueAt ? new Date(q.dueAt).getTime() : null;
              const late = due !== null && due < Date.now();
              const phone = q.customerPhone.replace(/\D/g, '');
              return (
                <li key={q.leadId} className="space-y-2 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {late && (
                          <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                            {lang === 'ta' ? 'தாமதம்' : 'Overdue'}
                          </span>
                        )}
                        {q.priority === 'HIGH' && (
                          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                            {lang === 'ta' ? 'அவசரம்' : 'High'}
                          </span>
                        )}
                        <span className="text-xs font-bold text-brand-ink">{q.customerName}</span>
                        <span className="text-[11px] text-slate-600">· {waiting(q.createdAt, lang)}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-foreground">{q.title}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Link
                        href={`/quotations/new?customerId=${q.customerId}&leadId=${q.leadId}`}
                        className="flex min-h-[44px] items-center rounded-lg bg-action px-3 text-xs font-bold text-on-action"
                      >
                        {lang === 'ta' ? '＋ கொட்டேஷன் தயார் செய்' : '＋ Prepare quote'}
                      </Link>
                      <a href={`tel:${q.customerPhone}`} className="flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-surface px-3 text-xs font-bold text-foreground">
                        📞
                      </a>
                      <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center rounded-lg bg-[#25D366]/15 px-3 text-xs font-bold text-[#128C7E]">
                        💬
                      </a>
                      <button
                        type="button"
                        disabled={closing === q.leadId}
                        onClick={() => closeEnquiry(q.leadId)}
                        className="min-h-[44px] rounded-lg px-2 text-xs font-semibold text-slate-600 hover:text-slate-600 disabled:opacity-50"
                      >
                        {lang === 'ta' ? 'மூடு' : 'Close'}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Priority Follow-Up Queue (Overdue + Today) */}
      <div className="rounded-2xl bg-surface p-5 shadow-sm border border-slate-200 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">
            {lang === 'ta'
              ? 'முக்கிய பின்தொடர்தல் பட்டியல் (Priority Follow-ups)'
              : 'Priority Follow-Up Queue'}
          </h2>
          <span className="rounded-full bg-action/25 px-3 py-1 text-xs font-bold text-foreground">
            {data.priorityTasks.length} {lang === 'ta' ? 'பணிகள்' : 'Pending'}
          </span>
        </div>

        {data.priorityTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-600">
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
                        <span className="text-xs font-bold text-brand-ink">
                          {task.customerName}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-foreground">{task.title}</p>
                    </div>

                    {/* 1-Tap Action Buttons: Call, WhatsApp, Done */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={`tel:${task.customerPhone}`}
                        className="flex min-h-[44px] items-center rounded-lg bg-surface px-3 text-xs font-bold text-foreground border border-slate-200"
                      >
                        📞 {lang === 'ta' ? 'அழை' : 'Call'}
                      </a>
                      <a
                        href={`https://wa.me/${cleanPhone}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-[44px] items-center rounded-lg bg-[#25D366]/15 px-3 text-xs font-bold text-[#128C7E]"
                      >
                        💬 WA
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          setCompletingTaskId(completingTaskId === task.id ? null : task.id)
                        }
                        className="min-h-[44px] rounded-lg bg-action px-3 text-xs font-bold text-on-action"
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
                        className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => handleCompleteTask(task.id)}
                        className="min-h-[44px] rounded-lg bg-action px-4 text-xs font-bold text-on-action"
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