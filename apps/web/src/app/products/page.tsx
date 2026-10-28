'use client';
import { useLocale } from '../../components/shared/LocaleProvider';

import React, { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Package, Plus, RefreshCw, Search } from 'lucide-react';
import { hasPermission } from '@friendly-crm/shared';
import { useAuth } from '../../components/auth/AuthProvider';
import { ProductForm, ProductRow } from '../../components/products/ProductForm';
import { apiFetch } from '../../lib/session';

const rupees = (v: string) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ProductsPage() {
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const canManage = hasPermission(active!.role, 'product:manage');
  const [lang, setLang] = useLocale();
  const ta = lang === 'ta';

  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [rows, setRows] = useState<ProductRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const mine = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ limit: '200' });
      if (search.trim()) q.set('search', search.trim());
      if (showArchived) q.set('archived', 'true');
      const res = await apiFetch(`/api/products?${q}`, { signal: controller.signal });
      if (controller.signal.aborted || mine !== sequence.current) return;
      if (res.ok) {
        const body = await res.json();
        if (controller.signal.aborted || mine !== sequence.current) return;
        setRows(body.data);
        setTruncated(body.total > body.data.length);
      } else {
        setRows(null);
        setError(res.status === 403 ? 'Your role cannot view products.' : `Could not load products (${res.status}).`);
      }
    } catch {
      if (controller.signal.aborted || mine !== sequence.current) return;
      setRows(null);
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      if (!controller.signal.aborted && mine === sequence.current) setLoading(false);
    }
  }, [search, showArchived]);

  // Reload when the search changes (after a short pause), the archived switch flips, or the business changes.
  useEffect(() => {
    request.current?.abort();
    ++sequence.current;
    setRows(null);
    setLoading(true);
    const t = setTimeout(load, search ? 250 : 0);
    return () => { clearTimeout(t); request.current?.abort(); ++sequence.current; };
  }, [tenantId, load]);

  const toggleArchive = async (p: ProductRow) => {
    const res = await apiFetch(`/api/products/${p.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    if (res.ok) load();
    else setError(`Could not ${p.isActive ? 'archive' : 'restore'} the product (${res.status}).`);
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-foreground">
            <Package className="h-5 w-5 text-brand-ink" />
            {ta ? 'பொருட்கள் / சேவைகள்' : 'Products & services'}
          </h1>
          <p className="text-xs text-slate-500">
            {ta ? 'கொட்டேஷனில் விலை, GST, HSN தானாக நிரம்பும்.' : 'Pick these when making a quote: rate, GST and HSN fill in automatically.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setLang(ta ? 'en' : 'ta')} className="rounded-lg border border-slate-200 bg-surface px-2.5 py-1 text-xs font-bold text-slate-600">
            {ta ? 'EN' : 'தமிழ்'}
          </button>
          {canManage && (
            <>
              <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1.5 rounded-lg bg-action px-3 py-1.5 text-xs font-bold text-on-action">
                <Plus className="h-3.5 w-3.5" /> {ta ? 'பொருள் சேர்' : 'Add product'}
              </button>
              <Link href="/products/import" className="inline-flex items-center rounded-lg border border-brand-ink px-3 py-1.5 text-xs font-bold text-brand-ink">
                {ta ? 'Excel / CSV இறக்குமதி' : 'Import from Excel / CSV'}
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <input
            aria-label={ta ? 'தேடு' : 'Search products'}
            className="w-full rounded-xl border border-slate-200 bg-surface py-2 pl-9 pr-3 text-sm"
            placeholder={ta ? 'பெயர், குறியீடு அல்லது HSN' : 'Search by name, code or HSN'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {ta ? 'காப்பகத்தையும் காட்டு' : 'Show archived'}
        </label>
        <button type="button" onClick={load} aria-label={ta ? 'புதுப்பி' : 'Refresh'} className="rounded-lg border border-slate-200 bg-surface p-1.5 text-slate-600">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">{error}</div>}
      {!error && loading && !rows && <div className="rounded-2xl bg-surface p-10 text-center text-sm text-slate-600">{ta ? 'ஏற்றுகிறது…' : 'Loading…'}</div>}

      {rows && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-surface p-8 text-center text-sm text-slate-500">
          {search || showArchived ? (ta ? 'பொருந்தும் பொருள் இல்லை.' : 'No products match.') : ta ? 'இன்னும் பொருட்கள் இல்லை.' : 'No products yet.'}
          {canManage && !search && (
            <p className="mt-1 text-xs">
              {ta ? 'ஒன்றைச் சேர்க்கவும், அல்லது ' : 'Add one, or '}
              <Link href="/products/import" className="font-bold text-brand-ink underline">{ta ? 'பட்டியலை இறக்குமதி செய்யவும்' : 'import your product list'}</Link>.
            </p>
          )}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-surface">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">{ta ? 'பெயர்' : 'Name'}</th>
                <th className="px-3 py-2">{ta ? 'குறியீடு' : 'Code'}</th>
                <th className="px-3 py-2">HSN/SAC</th>
                <th className="px-3 py-2">{ta ? 'அலகு' : 'Unit'}</th>
                <th className="px-3 py-2 text-right">{ta ? 'விலை' : 'Rate'}</th>
                <th className="px-3 py-2 text-right">GST</th>
                {canManage && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id} className={p.isActive ? '' : 'bg-slate-50 text-slate-600'}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-foreground">{p.name}{!p.isActive && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">{ta ? 'காப்பகம்' : 'Archived'}</span>}</div>
                    {p.description && <div className="max-w-xs truncate text-[11px] text-slate-600">{p.description}</div>}
                  </td>
                  <td className="px-3 py-2">{p.code ?? '—'}</td>
                  <td className="px-3 py-2">{p.hsnCode ?? '—'}</td>
                  <td className="px-3 py-2">{p.unit}</td>
                  <td className="px-3 py-2 text-right font-semibold">{rupees(p.unitPrice)}</td>
                  <td className="px-3 py-2 text-right">{Number(p.taxPercent)}%</td>
                  {canManage && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" onClick={() => setEditing(p)} className="mr-3 font-bold text-brand-ink">{ta ? 'திருத்து' : 'Edit'}</button>
                      <button type="button" onClick={() => toggleArchive(p)} className="font-bold text-slate-500">{p.isActive ? (ta ? 'காப்பகப்படுத்து' : 'Archive') : ta ? 'மீட்டெடு' : 'Restore'}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {truncated && <p className="text-xs text-slate-600">{ta ? 'முதல் 200 மட்டும். தேடலைப் பயன்படுத்தவும்.' : 'Showing the first 200. Use search to narrow down.'}</p>}

      {editing && (
        <ProductForm
          lang={lang}
          industry={active!.industryKey}
          product={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
