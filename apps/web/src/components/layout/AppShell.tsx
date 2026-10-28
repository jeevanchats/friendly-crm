'use client';
import { ThemeToggle } from '../shared/ThemeProvider';
import { useLocale } from '../shared/LocaleProvider';

import { useDialog } from '../shared/useDialog';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { QuickAddLeadDrawer } from '../crm/QuickAddLeadDrawer';
import { ChevronDown, Check, Building2, Layers, LogOut, Home, Users, ShoppingBag, Wallet, Package, Inbox, FileText, BarChart3, Settings, MoreHorizontal, Plus } from 'lucide-react';
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

  const [internalLang, setInternalLang] = useLocale();
  const [showMore, setShowMore] = useState(false);
  const moreRef = useDialog(showMore, () => setShowMore(false));
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  const lang = controlledLang || internalLang;
  const onToggleLang =
    controlledOnToggleLang || (() => setInternalLang((l) => (l === 'en' ? 'ta' : 'en')));

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const onResize = () => { if (media.matches) setShowMore(false); };
    media.addEventListener('change', onResize);
    return () => media.removeEventListener('change', onResize);
  }, []);
  useEffect(() => {
    if (!isSwitcherOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsSwitcherOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSwitcherOpen]);

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
    { href: '/', labelEn: 'Home', labelTa: 'முகப்பு', icon: Home },
    { href: '/customers', labelEn: 'Customers', labelTa: 'வாடிக்கையாளர்', icon: Users },
    { href: '/orders', labelEn: 'Orders', labelTa: 'ஆர்டர்கள்', icon: ShoppingBag },
    ...(hasPermission(userRole, 'payment:view')
      ? [{ href: '/dues', labelEn: 'Dues', labelTa: 'நிலுவை', icon: Wallet }]
      : []),
    ...(hasPermission(userRole, 'product:view')
      ? [{ href: '/products', labelEn: 'Products', labelTa: 'பொருட்கள்', icon: Package }]
      : []),
    ...(hasPermission(userRole, 'quote:view')
      ? [{ href: '/inbox', labelEn: 'Inbox', labelTa: 'செய்திகள்', icon: Inbox }]
      : []),
    ...(hasPermission(userRole, 'invoice:view')
      ? [{ href: '/invoices', labelEn: 'Invoices', labelTa: 'விலைப்பட்டியல்', icon: FileText }]
      : []),
    ...(canViewReports
      ? [{ href: '/reports', labelEn: 'Reports', labelTa: 'அறிக்கைகள்', icon: BarChart3 }]
      : []),
    ...(hasPermission(userRole, 'settings:manage')
      ? [{ href: '/settings', labelEn: 'Settings', labelTa: 'அமைப்புகள்', icon: Settings }]
      : []),
  ];

  const currentTemplate = INDUSTRY_TEMPLATES[activeTenant.industryKey] || INDUSTRY_TEMPLATES.printing;

  return (
    <div className="min-h-screen bg-surface text-foreground flex">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:p-3">Skip to content</a>
      {/* DESKTOP SIDEBAR (Hidden on Mobile) */}
      <aside className="hidden md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 bg-surface border border-slate-200 text-brand-ink p-5 z-30">
        <div className="border-b border-slate-200 pb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-accent-text">
              Friendly CRM
            </span>
          </div>

          {/* Desktop Business Switcher Dropdown */}
          <div className="relative">
            <button
              type="button"
              aria-expanded={isSwitcherOpen}
              onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
              className="w-full flex items-center justify-between rounded-xl bg-surface px-3.5 py-2.5 text-left text-xs font-semibold hover:bg-slate-50 transition-colors border border-slate-200"
            >
              <div className="truncate pr-2">
                <div className="font-bold text-brand-ink truncate text-sm">
                  {lang === 'ta' ? activeTenant.nameTa : activeTenant.name}
                </div>
                <div className="text-[11px] text-accent-text capitalize mt-0.5">
                  {currentTemplate.name[lang]}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-600 shrink-0" />
            </button>

            {isSwitcherOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsSwitcherOpen(false)} />
                <div className="hidden md:block absolute left-0 right-0 mt-2 bg-surface rounded-2xl shadow-2xl border border-slate-200 z-50 py-1 text-foreground animate-slide-up">
                  <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 border-b border-slate-100 flex items-center justify-between">
                    <span>{lang === 'ta' ? 'நிறுவனம் தேர்வு செய்க' : 'Switch business'}</span>
                    <Layers className="w-3.5 h-3.5 text-brand-ink" />
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
                            ? 'bg-action/10 text-brand-ink font-bold'
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
                        {isSelected && <Check className="w-4 h-4 text-brand-ink" />}
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
                aria-current={active ? 'page' : undefined}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                  active ? 'bg-accent-soft text-accent-text ring-1 ring-action/25' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                <span>{lang === 'ta' ? item.labelTa : item.labelEn}</span>
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setShowQuickAdd(true)}
          className="mt-auto min-h-[48px] w-full rounded-xl bg-action font-bold text-on-action shadow-md hover:bg-action/90 transition-colors"
        >
          + {lang === 'ta' ? 'புதிய விசாரணை (Add)' : 'Quick Add Enquiry'}
        </button>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs text-slate-700">
          <div className="min-w-0">
            <div className="truncate font-semibold text-brand-ink">{user?.name || user?.phone}</div>
            <div className="truncate text-[11px] text-accent-text">{userRole}</div>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 font-semibold hover:bg-slate-50 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {lang === 'ta' ? 'வெளியேறு' : 'Sign out'}
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 md:pl-72 pb-24 md:pb-8 flex flex-col min-w-0">
        {/* Top Header with Business Switcher & Language Toggle */}
        <header className="sticky top-0 z-20 flex items-center justify-between bg-surface/95 backdrop-blur px-4 py-3 border-b border-slate-200 shadow-2xs">
          {/* Top Left: Business Switcher Dropdown (Touch-friendly for Mobile + Desktop) */}
          <div className="relative">
            <button
              type="button"
              aria-expanded={isSwitcherOpen}
              onClick={() => setIsSwitcherOpen(!isSwitcherOpen)}
              className="flex items-center gap-2 rounded-xl bg-surface border border-slate-200 px-3 py-1.5 text-left text-xs hover:border-brand-ink transition-all"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-action animate-pulse" />
              <div className="truncate max-w-[95px] sm:max-w-[280px]">
                <span className="font-bold text-foreground block truncate leading-tight text-xs sm:text-sm">
                  {lang === 'ta' ? activeTenant.nameTa : activeTenant.name}
                </span>
                <span className="text-[10px] text-brand-ink font-semibold leading-none">
                  {currentTemplate.name[lang]}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            </button>

            {isSwitcherOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsSwitcherOpen(false)} />
                <div className="md:hidden absolute left-0 mt-2 w-72 sm:w-80 bg-surface rounded-2xl shadow-xl border border-slate-200 z-50 py-1.5 text-foreground animate-slide-up">
                  <div className="px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 border-b border-slate-100 flex items-center justify-between">
                    <span>{lang === 'ta' ? 'தொழில் துறை & நிறுவனம்' : 'Switch business'}</span>
                    <Building2 className="w-3.5 h-3.5 text-brand-ink" />
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
                            ? 'bg-action/10 text-brand-ink font-bold'
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
                        {isSelected && <Check className="w-4 h-4 text-brand-ink" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="ml-auto"><ThemeToggle locale={lang} /></div>
          <button
            type="button"
            onClick={onToggleLang}
            className="min-h-[44px] rounded-lg bg-action/25 px-3 text-xs font-bold text-foreground hover:bg-action/40 transition-colors"
          >
            {lang === 'en' ? 'தமிழ்' : 'English'}
          </button>
          <button
            type="button"
            onClick={() => logout()}
            aria-label={lang === 'ta' ? 'வெளியேறு' : 'Sign out'}
            className="md:hidden ml-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </header>

        <main id="main-content" tabIndex={-1} className="p-4 md:p-6 max-w-5xl mx-auto w-full flex-1">{children}</main>
      </div>

      <nav aria-label="Primary navigation" className="fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-surface px-1 pt-2 pb-safe md:hidden">
        {navItems.slice(0, 3).map(item => (
          <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined}
            className={`flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-xs font-semibold ${pathname === item.href ? 'bg-accent-soft text-accent-text' : 'text-slate-600'}`}>
            <item.icon className="h-5 w-5" aria-hidden="true" />
            <span className="max-w-full break-words text-center">{lang === 'ta' ? item.labelTa : item.labelEn}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setShowMore(true)} aria-haspopup="dialog" aria-expanded={showMore}
          className="flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-lg text-xs font-semibold text-brand-ink">
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />{lang === 'ta' ? 'மேலும்' : 'More'}
        </button>
        <button type="button" onClick={() => setShowQuickAdd(true)} className="flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-lg bg-action text-xs font-bold text-on-action">
          <Plus className="h-5 w-5" aria-hidden="true" />{lang === 'ta' ? 'சேர்' : 'Add'}
        </button>
      </nav>
      {showMore && (
        <div ref={moreRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={lang === 'ta' ? 'மேலும்' : 'More navigation'} className="fixed inset-0 z-40 flex items-end bg-black/40 md:hidden">
          <section className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-5 pb-safe">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">{lang === 'ta' ? 'மேலும்' : 'More'}</h2>
              <button type="button" onClick={() => setShowMore(false)} className="min-h-[44px] px-3">{lang === 'ta' ? 'மூடு' : 'Close'}</button></div>
            {navItems.slice(3).map(item => <Link key={item.href} href={item.href} onClick={() => setShowMore(false)} aria-current={pathname === item.href ? 'page' : undefined} className="flex min-h-[48px] items-center gap-3 rounded-lg px-3 font-semibold hover:bg-slate-100"><item.icon className="h-5 w-5" aria-hidden="true" />{lang === 'ta' ? item.labelTa : item.labelEn}</Link>)}
          </section>
        </div>
      )}

      {/* QUICK ADD MODAL */}
      {showQuickAdd && (
        <QuickAddLeadDrawer
          isOpen={showQuickAdd}
          onClose={() => setShowQuickAdd(false)}
          industry={activeTenant.industryKey}
          locale={lang}
          onSubmit={async (lead) => {
            // A failed save must stay visible in the form (and the form must stay open), never vanish silently.
            const res = await apiFetch('/api/crm/intake-lead', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(lead),
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(Array.isArray(body.message) ? body.message.join(' ') : body.message || `Could not save the enquiry (${res.status}).`);
            }
            // The drawer attaches any voice note / files to this enquiry, then calls onSuccess below
            return res.json().catch(() => ({}));
          }}
          onSuccess={() => {
            setShowQuickAdd(false);
            // The new enquiry now waits under "Quotes to send" on the Home screen: take the person straight there
            window.location.assign('/');
          }}
        />
      )}
    </div>
  );
}
