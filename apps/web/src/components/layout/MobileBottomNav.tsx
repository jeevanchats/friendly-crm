'use client';

import React from 'react';
import { Home, Users, FileText, ShoppingBag, Plus, CalendarCheck } from 'lucide-react';

interface MobileBottomNavProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  onQuickAction: () => void;
  pendingTasksCount?: number;
  locale?: 'en' | 'ta';
  messages?: any;
}

export function MobileBottomNav({
  currentTab,
  onTabChange,
  onQuickAction,
  pendingTasksCount = 2,
  locale = 'en',
  messages,
}: MobileBottomNavProps) {
  const t = messages?.nav || {
    home: 'Home',
    leads: 'Leads',
    quotes: 'Quotes',
    orders: 'Orders',
    tasks: 'Follow-ups',
    quickAdd: 'Add',
  };

  const navItems = [
    { id: 'leads', label: t.leads, icon: Users },
    { id: 'quotes', label: t.quotes, icon: FileText },
    { id: 'quick_action', label: t.quickAdd, icon: Plus, isAction: true },
    { id: 'orders', label: t.orders, icon: ShoppingBag },
    { id: 'tasks', label: t.tasks, icon: CalendarCheck, badge: pendingTasksCount },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-slate-200/80 px-2 pt-1 pb-safe shadow-lg">
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;

          if (item.isAction) {
            return (
              <button
                key={item.id}
                onClick={onQuickAction}
                aria-label="Quick Add Lead"
                className="group relative flex items-center justify-center w-13 h-13 -mt-6 bg-brand-teal text-brand-ink rounded-full shadow-soft-teal hover:bg-brand-teal-light active:scale-95 transition-all ring-4 ring-white"
              >
                <Icon className="w-6 h-6 stroke-[2.5]" />
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-brand-gold rounded-full ring-2 ring-white" />
              </button>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex flex-col items-center justify-center w-16 py-1.5 text-[11px] font-medium transition-colors ${
                isActive
                  ? 'text-brand-ink font-bold'
                  : 'text-brand-slate-light hover:text-brand-slate'
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5 stroke-[2]" />
                {item.badge && item.badge > 0 ? (
                  <span className="absolute -top-1 -right-2 px-1.5 py-0.2 text-[9px] font-extrabold text-white bg-brand-gold-dark rounded-full leading-tight">
                    {item.badge}
                  </span>
                ) : null}
              </div>
              <span className="mt-1 truncate max-w-[64px]">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
