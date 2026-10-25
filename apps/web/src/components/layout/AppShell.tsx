'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { QuickAddLeadDrawer } from '../crm/QuickAddLeadDrawer';
import { ChevronDown, Check, Building2, Layers, LogOut } from 'lucide-react';
import { IndustryKey, INDUSTRY_TEMPLATES, hasPermission } from '@friendly-crm/shared';
import { useAuth } from '../auth/AuthProvider';
import { apiFetch } from '../../lib/session';

export interface AppShellProps {
  children: React.ReactNode;
  tenantName?: string;
  industry?: IndustryKey;
  lang?: 'en' | 'ta';
  onToggleLang?: () => void;
}

export function AppShell({
  children,
  tenantName: propTenantName,
  industry: propIndustry,
  lang: controlledLang,
  onToggleLang: controlledOnToggleLang,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  const { active, memberships, user, switchBusiness, logout } = useAuth();

  // AuthProvider only renders the app once a business is active.
  const activeTenant = {
    id: active!.tenantId,
    name: active!.tenantName,
    nameTa: active!.tenantName,
    industryKey: active!.industryKey,
  };
  const userRole = active!.role;
  const switchOptions = memberships.map((m) => ({
    id: m.tenantId,
    name: m.tenantName,
    nameTa: m.tenantName,
    industryKey: m.industryKey,
  }));

  const [internalLang, setInternalLang] = useState<'en' | 'ta'>('en');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  const lang = controlledLang || internalLang;
  const onToggleLang =
    controlledOnToggleLang || (() => setInternalLang((l) => (l === 'en' ? 'ta' : 'en')));

  const handleSelectTenant = (tenant: { id: string }) => {
    setIsSwitcherOpen(false);
    switchBusiness(tenant.id);
  };

  // Don't render shell chrome for print PDF routes
  if (pathname?.includes('/pdf') || pathname?.startsWith('/q/')) {
    return <>{children}</>;
  }

  const canViewReports = hasPermission(userRole, 'report:view');

  const navItems = [
    { href: '/', labelEn: 'Home', labelTa: 'முகப்பு', icon: '🏠' },
    { href: '/customers', labelEn: 'Customers', labelTa: 'வாடிக்கையாளர்', icon: '👥' },
    { href: '/orders', labelEn: 'Orders', labelTa: 'ஆர்டர்கள்', icon: '📦' },
    ...(canViewReports
      ? [{ href: '/reports', labelEn: 'Reports', labelTa: 'அறிக்கைகள்', icon: '📊' }]
      : []),
  ];

  const currentTemplate = INDUSTRY_TEMPLATES[activeTenant.industryKey] || INDUSTRY_TEMPLATES.printing;

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#243B40] flex">
      {/* DESKTOP SIDEBAR (Hidden on Mobile) */}
      <aside className="hidden md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 bg-[#243B40] text-white p-5 z-30">
        <div className="border-b border-slate-700/80 pb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#F4B860]">
              Friendly CRM
            </span>
          </div>

          {/* Desktop Business Switcher Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
              className="w-full flex items-center justify-between rounded-xl bg-slate-800/90 px-3.5 py-2.5 text-left text-xs font-semibold hover:bg-slate-800 transition-colors border border-slate-700"
            >
              <div className="truncate pr-2">
                <div className="font-bold text-white truncate text-sm">
                  {lang === 'ta' ? activeTenant.nameTa : activeTenant.name}
                </div>
                <div className="text-[11px] text-[#F4B860] capitalize mt-0.5">
                  {currentTemplate.name[lang]}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            {isSwitcherOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsSwitcherOpen(false)} />
                <div className="absolute left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 py-1 text-[#243B40] animate-slide-up">
                  <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 flex items-center justify-between">
                    <span>{lang === 'ta' ? 'நிறுவனம் தேர்வு செய்க' : 'Switch business'}</span>
                    <Layers className="w-3.5 h-3.5 text-[#167D79]" />
                  </div>
                  {switchOptions.map((t) => {
                    const isSelected = t.id === activeTenant.id;
                    const tmpl = INDUSTRY_TEMPLATES[t.industryKey];
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSelectTenant(t)}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-[#167D79]/10 text-[#167D79] font-bold'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-[13px]">
                            {lang === 'ta' ? t.nameTa : t.name}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {tmpl.name[lang]}
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-[#167D79]" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <nav className="mt-6 flex-1 space-y-2">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                  active ? 'bg-[#167D79] text-white shadow-md' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{lang === 'ta' ? item.labelTa : item.labelEn}</span>
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setShowQuickAdd(true)}
          className="mt-auto min-h-[48px] w-full rounded-xl bg-[#F4B860] font-bold text-[#243B40] shadow-md hover:bg-[#F4B860]/90 transition-colors"
        >
          + {lang === 'ta' ? 'புதிய விசாரணை (Add)' : 'Quick Add Enquiry'}
        </button>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-700/80 pt-3 text-xs text-slate-300">
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">{user?.name || user?.phone}</div>
            <div className="truncate text-[11px] text-[#F4B860]">{userRole}</div>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 font-semibold hover:bg-slate-800 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {lang === 'ta' ? 'வெளியேறு' : 'Sign out'}
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 md:pl-72 pb-24 md:pb-8 flex flex-col min-w-0">
        {/* Top Header with Business Switcher & Language Toggle */}
        <header className="sticky top-0 z-20 flex items-center justify-between bg-white/95 backdrop-blur px-4 py-3 border-b border-slate-200 shadow-2xs">
          {/* Top Left: Business Switcher Dropdown (Touch-friendly for Mobile + Desktop) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
              className="flex items-center gap-2 rounded-xl bg-[#F6F8F7] border border-slate-200 px-3 py-1.5 text-left text-xs hover:border-[#167D79] transition-all"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-[#167D79] animate-pulse" />
              <div className="truncate max-w-[150px] sm:max-w-[280px]">
                <span className="font-bold text-[#243B40] block truncate leading-tight text-xs sm:text-sm">
                  {lang === 'ta' ? activeTenant.nameTa : activeTenant.name}
                </span>
                <span className="text-[10px] text-[#167D79] font-semibold leading-none">
                  {currentTemplate.name[lang]}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>

            {isSwitcherOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsSwitcherOpen(false)} />
                <div className="absolute left-0 mt-2 w-72 sm:w-80 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 py-1.5 text-[#243B40] animate-slide-up">
                  <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 flex items-center justify-between">
                    <span>{lang === 'ta' ? 'தொழில் துறை & நிறுவனம்' : 'Switch business'}</span>
                    <Building2 className="w-3.5 h-3.5 text-[#167D79]" />
                  </div>
                  {switchOptions.map((t) => {
                    const isSelected = t.id === activeTenant.id;
                    const tmpl = INDUSTRY_TEMPLATES[t.industryKey];
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSelectTenant(t)}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-[#167D79]/10 text-[#167D79] font-bold'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-[13px]">
                            {lang === 'ta' ? t.nameTa : t.name}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {tmpl.name[lang]}
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-[#167D79]" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={onToggleLang}
            className="min-h-[36px] rounded-lg bg-[#F4B860]/25 px-3 text-xs font-bold text-[#243B40] hover:bg-[#F4B860]/40 transition-colors"
          >
            {lang === 'en' ? 'தமிழ்' : 'English'}
          </button>
          <button
            type="button"
            onClick={() => logout()}
            aria-label={lang === 'ta' ? 'வெளியேறு' : 'Sign out'}
            className="md:hidden ml-2 flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </header>

        <main className="p-4 md:p-6 max-w-5xl mx-auto w-full flex-1">{children}</main>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR (Home, Customers, Orders, Reports?, + Add) */}
      <nav className={`fixed bottom-0 inset-x-0 z-30 grid ${canViewReports ? 'grid-cols-5' : 'grid-cols-4'} bg-white border-t border-slate-200 py-1.5 px-2 md:hidden shadow-lg`}>
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center min-h-[48px] rounded-xl text-xs font-semibold ${
                active ? 'text-[#167D79] font-bold' : 'text-slate-500'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="text-[10px] mt-0.5">{lang === 'ta' ? item.labelTa : item.labelEn}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setShowQuickAdd(true)}
          className="flex flex-col items-center justify-center min-h-[48px] rounded-xl bg-[#167D79] text-white font-bold shadow-sm"
        >
          <span className="text-base">＋</span>
          <span className="text-[10px]">{lang === 'ta' ? 'புதியது' : 'Quick Add'}</span>
        </button>
      </nav>

      {/* QUICK ADD MODAL */}
      {showQuickAdd && (
        <QuickAddLeadDrawer
          isOpen={showQuickAdd}
          onClose={() => setShowQuickAdd(false)}
          industry={activeTenant.industryKey}
          locale={lang}
          onSubmit={async (lead) => {
            try {
              await apiFetch('/api/crm/intake-lead', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(lead),
              });
              setShowQuickAdd(false);
              window.location.reload();
            } catch {
              setShowQuickAdd(false);
            }
          }}
        />
      )}
    </div>
  );
}
