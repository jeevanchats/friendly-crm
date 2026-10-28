'use client';

import React from 'react';
import { Check, Clock, AlertTriangle, ArrowRight } from 'lucide-react';
import { DEFAULT_ORDER_STAGES } from '@friendly-crm/shared';

interface OrderStageTrackerProps {
  currentStage?: string;
  orderNumber?: string;
  onAdvanceStage?: (newStage: string) => void;
}

export function OrderStageTracker({
  currentStage = 'IN_PRODUCTION',
  orderNumber = 'ORD-2026-042',
  onAdvanceStage,
}: OrderStageTrackerProps) {
  const currentIndex = DEFAULT_ORDER_STAGES.findIndex((s) => s.key === currentStage);

  return (
    <div className="bg-surface rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
            Order Status
          </span>
          <h3 className="text-sm font-bold text-slate-800">{orderNumber}</h3>
        </div>
        <span className="px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
          {DEFAULT_ORDER_STAGES[currentIndex]?.label || currentStage}
        </span>
      </div>

      {/* Mobile-friendly horizontal stage scroll */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-none">
        {DEFAULT_ORDER_STAGES.map((stage, idx) => {
          const isPassed = idx < currentIndex;
          const isCurrent = idx === currentIndex;

          return (
            <div key={stage.key} className="flex items-center space-x-2 shrink-0">
              <div
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isCurrent
                    ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-300'
                    : isPassed
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {isPassed && <Check className="w-3.5 h-3.5" />}
                {isCurrent && <Clock className="w-3.5 h-3.5 animate-pulse" />}
                <span>{stage.label}</span>
              </div>
              {idx < DEFAULT_ORDER_STAGES.length - 1 && (
                <ArrowRight className="w-3 h-3 text-slate-300 shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {currentIndex < DEFAULT_ORDER_STAGES.length - 1 && (
        <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
          <button
            onClick={() => onAdvanceStage?.(DEFAULT_ORDER_STAGES[currentIndex + 1].key)}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
          >
            <span>Advance to {DEFAULT_ORDER_STAGES[currentIndex + 1].label}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
