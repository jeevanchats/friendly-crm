'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { IndustryKey, TenantRole } from '@friendly-crm/shared';
import { useLocale } from '../shared/LocaleProvider';
import { AUTH_EXPIRED_EVENT, apiFetch, clearSession, getActiveTenantId, getSession, setSession } from '../../lib/session';

export interface Membership {
  tenantId: string;
  tenantName: string;
  industryKey: IndustryKey;
  role: TenantRole;
  isActive: boolean;
}

export interface AuthUser {
  id: string;
  phone: string;
  name: string | null;
}

export interface ActiveBusiness {
  tenantId: string;
  tenantName: string;
  industryKey: IndustryKey;
  role: TenantRole;
}

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  memberships: Membership[];
  /** The business the user is working in, with the role the SERVER derived from their membership. */
  active: ActiveBusiness | null;
  /** Resolves to the code itself only in local development (the API's dev SMS gateway); otherwise undefined. */
  requestOtp: (phone: string) => Promise<string | undefined>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  switchBusiness: (tenantId: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PATHS = ['/login'];

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    return typeof msg === 'string' && msg ? msg : fallback;
  } catch {
    return fallback;
  }
}

function persistTenant(tenantId: string | null) {
  try {
    if (tenantId) window.localStorage.setItem('friendly_tenant_id', tenantId);
    else window.localStorage.removeItem('friendly_tenant_id');
  } catch {
    // storage blocked
  }
}

/** Keeps the pre-existing localStorage keys / window events in step, for components that still listen to them. */
function publishActive(active: ActiveBusiness | null) {
  try {
    if (!active) {
      window.localStorage.removeItem('friendly_tenant_id');
      window.localStorage.removeItem('friendly_user_role');
      window.localStorage.removeItem('friendly_industry');
      return;
    }
    window.localStorage.setItem('friendly_tenant_id', active.tenantId);
    window.localStorage.setItem('friendly_user_role', active.role);
    window.localStorage.setItem('friendly_industry', active.industryKey);
  } catch {
    // storage blocked
  }
  if (active) {
    window.dispatchEvent(new CustomEvent('tenant-changed', { detail: { id: active.tenantId, industryKey: active.industryKey } }));
    window.dispatchEvent(new CustomEvent('role-changed', { detail: active.role }));
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);

  const loadProfile = useCallback(async (): Promise<boolean> => {
    const res = await apiFetch('/api/auth/me');
    if (!res.ok) return false;
    const body = await res.json();
    const list: Membership[] = (body.memberships ?? []).filter((m: Membership) => m.isActive);
    setUser({ id: body.user.id, phone: body.user.phone, name: body.user.name ?? body.user.fullName ?? null });
    setMemberships(list);
    const saved = getActiveTenantId();
    const chosen = list.find((m) => m.tenantId === saved) ?? list[0] ?? null;
    // Persist synchronously: child components fire their first API call before this provider's effects run.
    persistTenant(chosen?.tenantId ?? null);
    setActiveTenantId(chosen?.tenantId ?? null);
    return true;
  }, []);

  // Restore the session on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getSession()) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      try {
        const ok = await loadProfile();
        if (cancelled) return;
        if (ok) setStatus('authenticated');
        else {
          clearSession();
          setStatus('anonymous');
        }
      } catch {
        // API unreachable: keep the stored token but do not pretend we are signed in
        if (!cancelled) setStatus('anonymous');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  // The server said the token is no longer valid.
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setMemberships([]);
      setActiveTenantId(null);
      publishActive(null);
      setStatus('anonymous');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const active: ActiveBusiness | null = useMemo(() => {
    const m = memberships.find((x) => x.tenantId === activeTenantId);
    return m ? { tenantId: m.tenantId, tenantName: m.tenantName, industryKey: m.industryKey, role: m.role } : null;
  }, [memberships, activeTenantId]);

  // Publish the active business (token header + legacy keys/events) whenever it changes.
  useEffect(() => {
    if (status === 'authenticated') publishActive(active);
  }, [status, active]);

  // Route guard.
  useEffect(() => {
    if (status === 'loading') return;
    const isPublic = PUBLIC_PATHS.includes(pathname ?? '');
    if (status === 'anonymous' && !isPublic) router.replace('/login');
    if (status === 'authenticated' && isPublic) router.replace('/');
  }, [status, pathname, router]);

  const requestOtp = useCallback(async (phone: string) => {
    const res = await fetch('/api/auth/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, countryCode: '+91' }),
    });
    if (!res.ok) throw new Error(await readError(res, 'Could not send the code. Please try again.'));
    const body = await res.json().catch(() => null);
    return typeof body?.devCode === 'string' ? body.devCode : undefined;
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, code: string) => {
      const res = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      if (!res.ok) throw new Error(await readError(res, 'That code did not work. Please try again.'));
      const session = await res.json();
      setSession({ token: session.token, expiresAt: session.expiresAt });
      const ok = await loadProfile();
      if (!ok) {
        clearSession();
        throw new Error('Signed in, but your profile could not be loaded. Please try again.');
      }
      setStatus('authenticated');
    },
    [loadProfile]
  );

  const switchBusiness = useCallback(
    (tenantId: string) => {
      if (memberships.some((m) => m.tenantId === tenantId)) {
        persistTenant(tenantId);
        setActiveTenantId(tenantId);
      }
    },
    [memberships]
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // the token is dropped locally either way
    }
    clearSession();
    setUser(null);
    setMemberships([]);
    setActiveTenantId(null);
    publishActive(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, memberships, active, requestOtp, verifyOtp, switchBusiness, logout }),
    [status, user, memberships, active, requestOtp, verifyOtp, switchBusiness, logout]
  );

  const [lang] = useLocale();
  const ta = lang === 'ta';

  // Nothing behind the login renders (and so nothing calls the API) until the user is signed in.
  const isPublic = PUBLIC_PATHS.includes(pathname ?? '');
  const waiting = status === 'loading' || (status === 'anonymous' && !isPublic) || (status === 'authenticated' && isPublic);
  const noBusiness = status === 'authenticated' && !isPublic && !active;

  return (
    <AuthContext.Provider value={value}>
      {waiting ? (
        <div className="min-h-screen flex items-center justify-center bg-surface text-sm font-semibold text-slate-500" role="status">
          {ta ? 'ஏற்றப்படுகிறது…' : 'Loading…'}
        </div>
      ) : noBusiness ? (
        <main className="min-h-screen flex items-center justify-center bg-surface px-4 text-foreground">
          <div className="max-w-sm rounded-2xl bg-surface border border-slate-200 shadow-sm p-5 text-center">
            <h1 className="text-lg font-black">{ta ? 'எந்த வணிகமும் இணைக்கப்படவில்லை' : 'No business linked'}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {ta
                ? `இந்த மொபைல் எண் (${user?.phone}) இன்னும் எந்த வணிகத்திலும் உறுப்பினர் இல்லை. வணிக உரிமையாளரிடம் உங்களைச் சேர்க்கச் சொல்லி, மீண்டும் உள்நுழையவும்.`
                : `This mobile number (${user?.phone}) isn't a member of any business yet. Ask the business owner to add you, then sign in again.`}
            </p>
            <button
              type="button"
              onClick={() => logout()}
              className="mt-4 min-h-[48px] w-full rounded-xl bg-action font-bold text-on-action hover:bg-action/85 transition-colors"
            >
              {ta ? 'வெளியேறு' : 'Sign out'}
            </button>
          </div>
        </main>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
