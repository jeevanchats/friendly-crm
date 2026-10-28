/**
 * Browser-side session for the back office.
 *
 * The API issues an opaque bearer token at OTP verification and derives the user's role from their
 * membership on every request, so nothing here is trusted by the server: we only store the token and
 * which business (tenant) the user is currently working in.
 */

const SESSION_KEY = 'friendly_session';
const TENANT_KEY = 'friendly_tenant_id';

export interface StoredSession {
  token: string;
  expiresAt: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function getSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  const s = read<StoredSession>(SESSION_KEY);
  if (!s?.token || !s.expiresAt) return null;
  if (new Date(s.expiresAt).getTime() <= Date.now()) {
    clearSession();
    return null;
  }
  return s;
}

export function setSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // storage blocked (private mode): the session lasts until reload
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function getActiveTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

/** Fired when the server rejects the token, so the app can send the user back to the login screen. */
export const AUTH_EXPIRED_EVENT = 'auth-expired';

/**
 * fetch() for the Friendly CRM API: adds the bearer token and the active business, and signs the user out
 * if the API says the session is no longer valid.
 *
 * Any caller-supplied x-tenant-id / x-user-role / x-industry-key is discarded: the business comes from the
 * signed-in user's own selection, and the role and industry are decided by the server from their membership.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.delete('x-user-role');
  headers.delete('x-industry-key');
  headers.delete('x-tenant-id');

  const session = getSession();
  if (session) headers.set('Authorization', `Bearer ${session.token}`);
  const tenantId = getActiveTenantId();
  if (tenantId) headers.set('x-tenant-id', tenantId);

  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && session) {
    clearSession();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  return res;
}
