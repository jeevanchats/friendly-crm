'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Upload } from 'lucide-react';
import { CUSTOMER_FIELDS, customerTemplateCsv, hasPermission, parseCustomerSheet, parseDelimited } from '@friendly-crm/shared';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';

interface RowResult {
  row: number;
  name: string;
  phone: string;
  status: 'create' | 'update' | 'skip' | 'error';
  messages: string[];
}

interface Summary {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  openingBalanceTotal: number;
  rows: RowResult[];
}

const CHUNK = 500;
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_LABEL: Record<RowResult['status'], string> = { create: 'Will add', update: 'Will update', skip: 'Skipped', error: 'Problem' };
const STATUS_STYLE: Record<RowResult['status'], string> = {
  create: 'bg-emerald-50 text-emerald-800',
  update: 'bg-sky-50 text-sky-800',
  skip: 'bg-slate-100 text-slate-600',
  error: 'bg-rose-50 text-rose-800',
};

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ImportCustomersPage() {
  const { active } = useAuth();
  const tenantId = active!.tenantId;
  const canImport = hasPermission(active!.role, 'customer:create');
  const canBalance = hasPermission(active!.role, 'payment:create');

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip');
  const [preview, setPreview] = useState<Summary | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sheet = useMemo(() => parseCustomerSheet(text), [text]);
  const headerRow = useMemo(() => (text.trim() ? parseDelimited(text)[0] ?? [] : []), [text]);
  const hasBalanceColumn = sheet.mapping.openingBalance !== undefined;
  const missing = (['name', 'phone'] as const).filter((f) => sheet.mapping[f] === undefined);

  const reset = () => {
    setPreview(null);
    setDone(null);
    setError(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    const content = await file.text();
    setFileName(file.name);
    setText(content);
  };

  /** Sends the rows in batches (the server takes up to 1000 at a time) and joins the answers. */
  const run = async (dryRun: boolean): Promise<Summary | null> => {
    const total: Summary = { dryRun, created: 0, updated: 0, skipped: 0, errors: 0, openingBalanceTotal: 0, rows: [] };
    for (let i = 0; i < sheet.rows.length; i += CHUNK) {
      const res = await apiFetch('/api/crm/customers/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: sheet.rows.slice(i, i + CHUNK), dryRun, onDuplicate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          i > 0 && !dryRun
            ? `Stopped after ${i} rows: ${body.message || res.status}. Rows before that were imported; fix the problem and import the file again (existing customers are skipped).`
            : Array.isArray(body.message) ? body.message.join(' ') : body.message || `The server refused the file (${res.status}).`
        );
        return null;
      }
      total.created += body.created;
      total.updated += body.updated;
      total.skipped += body.skipped;
      total.errors += body.errors;
      total.openingBalanceTotal += Number(body.openingBalanceTotal);
      total.rows.push(...body.rows.map((r: RowResult) => ({ ...r, row: r.row + i })));
    }
    return total;
  };

  const check = async () => {
    reset();
    setBusy('check');
    try {
      setPreview(await run(true));
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    setError(null);
    setBusy('import');
    try {
      const r = await run(false);
      if (r) {
        setDone(r);
        setPreview(null);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  const problemsCsv = (r: Summary) => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const bad = r.rows.filter((x) => x.status === 'error');
    return ['No.,Name,Phone,Problem', ...bad.map((x) => [x.row, q(x.name), q(x.phone), q(x.messages.join('; '))].join(','))].join('\r\n');
  };

  if (!canImport) {
    return (
      <p role="alert" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
        Your role cannot add customers.
      </p>
    );
  }

  const shown = (r: Summary) => (onlyProblems ? r.rows.filter((x) => x.status === 'error') : r.rows);
  const resultTable = (r: Summary) => (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
        <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems
      </label>
      <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2">No.</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown(r).map((x) => (
              <tr key={x.row} className="align-top">
                <td className="px-3 py-2 text-slate-400">{x.row}</td>
                <td className="px-3 py-2 font-semibold text-[#243B40]">{x.name || '—'}</td>
                <td className="px-3 py-2">{x.phone || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[x.status]}`}>{STATUS_LABEL[x.status]}</span>
                  {x.messages.map((m) => (
                    <div key={m} className="mt-0.5 text-[11px] text-slate-500">{m}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl space-y-5 pb-20">
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <ArrowLeft className="h-4 w-4" /> Customers
      </Link>
      <div>
        <h1 className="text-xl font-extrabold text-[#243B40]">Import customers</h1>
        <p className="text-xs text-slate-500">
          Bring your existing customer list into <strong>{active!.tenantName}</strong>. Nothing is saved until you check the list and press Import.
        </p>
      </div>

      {done ? (
        <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" aria-label="Import finished">
          <h2 className="text-base font-extrabold text-emerald-900">Import finished</h2>
          <ul className="text-sm text-emerald-900">
            <li><strong>{done.created}</strong> customers added{done.openingBalanceTotal > 0 && <> with {rupees(done.openingBalanceTotal)} of opening balances</>}</li>
            {done.updated > 0 && <li><strong>{done.updated}</strong> existing customers updated</li>}
            {done.skipped > 0 && <li><strong>{done.skipped}</strong> skipped (already customers)</li>}
            {done.errors > 0 && <li><strong>{done.errors}</strong> rows had problems and were not imported</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href="/customers" className="rounded-lg bg-[#167D79] px-4 py-2 text-xs font-bold text-white">View customers</Link>
            {done.openingBalanceTotal > 0 && <Link href="/dues" className="rounded-lg border border-[#167D79] px-4 py-2 text-xs font-bold text-[#167D79]">See who owes you</Link>}
            {done.errors > 0 && (
              <button type="button" onClick={() => download('customers-with-problems.csv', problemsCsv(done))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">
                <Download className="h-3.5 w-3.5" /> Download rows with problems
              </button>
            )}
            <button type="button" onClick={() => { setText(''); setFileName(null); reset(); }} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">Import another file</button>
          </div>
          {done.errors > 0 && resultTable({ ...done, rows: done.rows.filter((r) => r.status === 'error') })}
        </section>
      ) : (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-extrabold text-[#243B40]">1. Choose your file</h2>
            <p className="text-xs text-slate-500">
              A CSV file (in Excel: <em>Save As → CSV UTF-8</em>), or copy the rows from Excel and paste them below. The first row must be the column names.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#243B40] px-3 py-2 text-xs font-bold text-white">
                <Upload className="h-3.5 w-3.5" /> Choose CSV file
                <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <button type="button" onClick={() => download('customers-template.csv', customerTemplateCsv())} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
                <Download className="h-3.5 w-3.5" /> Download template
              </button>
              {fileName && <span className="text-xs font-semibold text-slate-500">{fileName}</span>}
            </div>
            <textarea
              aria-label="Or paste rows copied from Excel"
              className="h-32 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              placeholder={'Name\tPhone\tState\tOpening balance\nAnand Traders\t9840011111\tTamil Nadu\t12500'}
              value={text}
              onChange={(e) => { setText(e.target.value); setFileName(null); reset(); }}
            />
            {text.includes('�') && (
              <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                Some characters could not be read (this file is not UTF-8). In Excel use <em>Save As → CSV UTF-8 (Comma delimited)</em> so Tamil names import correctly.
              </p>
            )}
          </section>

          {text.trim() && (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-extrabold text-[#243B40]">2. Check the columns</h2>
              {missing.length > 0 ? (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                  We could not find a <strong>{missing.map((m) => (m === 'name' ? 'Name' : 'Phone')).join(' and ')}</strong> column. Rename the column in your file (for example “Name”, “Mobile”) or use the template.
                </p>
              ) : (
                <p className="text-xs text-slate-600"><strong>{sheet.rows.length}</strong> customers found.</p>
              )}
              <ul className="grid gap-1 text-xs sm:grid-cols-2">
                {CUSTOMER_FIELDS.map((f) => {
                  const idx = sheet.mapping[f.field];
                  return (
                    <li key={f.field} className={idx === undefined ? 'text-slate-400' : 'font-semibold text-[#243B40]'}>
                      {idx === undefined ? '○' : '✓'} {f.label}
                      {idx !== undefined && <span className="font-normal text-slate-500"> ← “{headerRow[idx]}”</span>}
                    </li>
                  );
                })}
              </ul>
              {sheet.ignoredHeaders.length > 0 && <p className="text-[11px] text-slate-400">Ignored columns: {sheet.ignoredHeaders.join(', ')}</p>}
              {hasBalanceColumn && !canBalance && (
                <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                  Your role cannot import opening balances. Remove that column, or ask the owner or accounts to import this file.
                </p>
              )}

              <fieldset className="space-y-1 pt-1 text-xs">
                <legend className="font-bold text-slate-500">If a phone number is already a customer</legend>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === 'skip'} onChange={() => { setOnDuplicate('skip'); setPreview(null); }} /> Leave them as they are (recommended)</label>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === 'update'} onChange={() => { setOnDuplicate('update'); setPreview(null); }} /> Fill in their blank details (never changes names or balances)</label>
              </fieldset>

              <button
                type="button"
                disabled={missing.length > 0 || sheet.rows.length === 0 || busy !== null}
                onClick={check}
                className="rounded-lg bg-[#167D79] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'check' ? 'Checking…' : 'Check the list'}
              </button>
            </section>
          )}

          {error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}

          {preview && (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5" aria-label="Check results">
              <h2 className="text-sm font-extrabold text-[#243B40]">3. Review and import</h2>
              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">{preview.created} to add</span>
                {preview.updated > 0 && <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-800">{preview.updated} to update</span>}
                {preview.skipped > 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{preview.skipped} already customers</span>}
                {preview.errors > 0 && <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-800">{preview.errors} with problems</span>}
                {preview.openingBalanceTotal > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-900">{rupees(preview.openingBalanceTotal)} opening balances</span>}
              </div>
              {preview.errors > 0 && <p className="text-xs text-slate-500">Rows with problems are left out. Fix them in your file and import it again; customers already added are skipped.</p>}
              {resultTable(preview)}
              <button
                type="button"
                disabled={busy !== null || preview.created + preview.updated === 0}
                onClick={doImport}
                className="rounded-lg bg-[#243B40] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'import' ? 'Importing…' : `Import ${preview.created + preview.updated} customers`}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
