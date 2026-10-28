'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Upload } from 'lucide-react';
import { PRODUCT_FIELDS, getIndustryExamples, hasPermission, parseDelimited, parseProductSheet, productTemplateCsv } from '@friendly-crm/shared';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';

interface RowResult {
  row: number;
  name: string;
  status: 'create' | 'update' | 'skip' | 'error';
  messages: string[];
}

interface Summary {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: RowResult[];
}

const CHUNK = 500;
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

export default function ImportProductsPage() {
  const { active } = useAuth();
  const canManage = hasPermission(active!.role, 'product:manage');
  const example = getIndustryExamples(active!.industryKey).product;

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip');
  const [preview, setPreview] = useState<Summary | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sheet = useMemo(() => parseProductSheet(text), [text]);
  const headerRow = useMemo(() => (text.trim() ? parseDelimited(text)[0] ?? [] : []), [text]);
  const missingName = sheet.mapping.name === undefined;

  const reset = () => {
    setPreview(null);
    setDone(null);
    setError(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    setText(await file.text());
  };

  /** Sends the rows in batches (the server takes up to 1000 at a time) and joins the answers. */
  const run = async (dryRun: boolean): Promise<Summary | null> => {
    const total: Summary = { dryRun, created: 0, updated: 0, skipped: 0, errors: 0, rows: [] };
    for (let i = 0; i < sheet.rows.length; i += CHUNK) {
      const res = await apiFetch('/api/products/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: sheet.rows.slice(i, i + CHUNK), dryRun, onDuplicate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          i > 0 && !dryRun
            ? `Stopped after ${i} rows: ${body.message || res.status}. Rows before that were imported; fix the problem and import the file again (existing products are skipped).`
            : Array.isArray(body.message) ? body.message.join(' ') : body.message || `The server refused the file (${res.status}).`
        );
        return null;
      }
      total.created += body.created;
      total.updated += body.updated;
      total.skipped += body.skipped;
      total.errors += body.errors;
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
    return ['No.,Name,Problem', ...r.rows.filter((x) => x.status === 'error').map((x) => [x.row, q(x.name), q(x.messages.join('; '))].join(','))].join('\r\n');
  };

  if (!canManage) {
    return (
      <p role="alert" className="rounded-2xl border border-slate-200 bg-surface p-8 text-center text-sm font-semibold text-slate-500">
        Your role cannot change the product list.
      </p>
    );
  }

  const shown = (r: Summary) => (onlyProblems ? r.rows.filter((x) => x.status === 'error') : r.rows);
  const resultTable = (r: Summary, rows = shown(r)) => (
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
              <th className="px-3 py-2">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((x) => (
              <tr key={x.row} className="align-top">
                <td className="px-3 py-2 text-slate-600">{x.row}</td>
                <td className="px-3 py-2 font-semibold text-foreground">{x.name || '—'}</td>
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
      <Link href="/products" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <ArrowLeft className="h-4 w-4" /> Products
      </Link>
      <div>
        <h1 className="text-xl font-extrabold text-foreground">Import products</h1>
        <p className="text-xs text-slate-500">
          Bring your product and service list into <strong>{active!.tenantName}</strong>. Nothing is saved until you check the list and press Import.
        </p>
      </div>

      {done ? (
        <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" aria-label="Import finished">
          <h2 className="text-base font-extrabold text-emerald-900">Import finished</h2>
          <ul className="text-sm text-emerald-900">
            <li><strong>{done.created}</strong> products added</li>
            {done.updated > 0 && <li><strong>{done.updated}</strong> existing products updated</li>}
            {done.skipped > 0 && <li><strong>{done.skipped}</strong> skipped (already products)</li>}
            {done.errors > 0 && <li><strong>{done.errors}</strong> rows had problems and were not imported</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href="/products" className="rounded-lg bg-action px-4 py-2 text-xs font-bold text-on-action">View products</Link>
            {done.errors > 0 && (
              <button type="button" onClick={() => download('products-with-problems.csv', problemsCsv(done))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">
                <Download className="h-3.5 w-3.5" /> Download rows with problems
              </button>
            )}
            <button type="button" onClick={() => { setText(''); setFileName(null); reset(); }} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">Import another file</button>
          </div>
          {done.errors > 0 && resultTable(done, done.rows.filter((r) => r.status === 'error'))}
        </section>
      ) : (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-surface p-5">
            <h2 className="text-sm font-extrabold text-foreground">1. Choose your file</h2>
            <p className="text-xs text-slate-500">
              A CSV file (in Excel: <em>Save As → CSV UTF-8</em>), or copy the rows from Excel and paste them below. The first row must be the column names.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-surface border border-slate-200 px-3 py-2 text-xs font-bold text-brand-ink">
                <Upload className="h-3.5 w-3.5" /> Choose CSV file
                <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <button type="button" onClick={() => download('products-template.csv', productTemplateCsv(active!.industryKey))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
                <Download className="h-3.5 w-3.5" /> Download template
              </button>
              {fileName && <span className="text-xs font-semibold text-slate-500">{fileName}</span>}
            </div>
            <textarea
              aria-label="Or paste rows copied from Excel"
              className="h-32 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              placeholder={`Name\tHSN\tUnit\tRate\tGST %\n${example.name}\t${example.hsnCode}\t${example.unit}\t${example.unitPrice}\t${example.taxPercent}`}
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
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-surface p-5">
              <h2 className="text-sm font-extrabold text-foreground">2. Check the columns</h2>
              {missingName ? (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                  We could not find a <strong>Name</strong> column. Rename the column in your file (for example “Name” or “Item”) or use the template.
                </p>
              ) : (
                <p className="text-xs text-slate-600"><strong>{sheet.rows.length}</strong> products found.</p>
              )}
              <ul className="grid gap-1 text-xs sm:grid-cols-2">
                {PRODUCT_FIELDS.map((f) => {
                  const idx = sheet.mapping[f.field];
                  return (
                    <li key={f.field} className={idx === undefined ? 'text-slate-600' : 'font-semibold text-foreground'}>
                      {idx === undefined ? '○' : '✓'} {f.label}
                      {idx !== undefined && <span className="font-normal text-slate-500"> ← “{headerRow[idx]}”</span>}
                    </li>
                  );
                })}
              </ul>
              {sheet.ignoredHeaders.length > 0 && <p className="text-[11px] text-slate-600">Ignored columns: {sheet.ignoredHeaders.join(', ')}</p>}
              <p className="text-[11px] text-slate-600">Missing rate means ₹0; missing GST % means 18%. The check below lists every row where that happens.</p>

              <fieldset className="space-y-1 pt-1 text-xs">
                <legend className="font-bold text-slate-500">If a product with the same name or code already exists</legend>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === 'skip'} onChange={() => { setOnDuplicate('skip'); setPreview(null); }} /> Leave it as it is (recommended)</label>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === 'update'} onChange={() => { setOnDuplicate('update'); setPreview(null); }} /> Update the columns I filled in (blank cells leave existing values alone)</label>
              </fieldset>

              <button
                type="button"
                disabled={missingName || sheet.rows.length === 0 || busy !== null}
                onClick={check}
                className="rounded-lg bg-action px-4 py-2 text-sm font-bold text-on-action disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'check' ? 'Checking…' : 'Check the list'}
              </button>
            </section>
          )}

          {error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}

          {preview && (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-surface p-5" aria-label="Check results">
              <h2 className="text-sm font-extrabold text-foreground">3. Review and import</h2>
              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">{preview.created} to add</span>
                {preview.updated > 0 && <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-800">{preview.updated} to update</span>}
                {preview.skipped > 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{preview.skipped} already products</span>}
                {preview.errors > 0 && <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-800">{preview.errors} with problems</span>}
              </div>
              {preview.errors > 0 && <p className="text-xs text-slate-500">Rows with problems are left out. Fix them in your file and import it again; products already added are skipped.</p>}
              {resultTable(preview)}
              <button
                type="button"
                disabled={busy !== null || preview.created + preview.updated === 0}
                onClick={doImport}
                className="rounded-lg bg-surface border border-slate-200 px-4 py-2 text-sm font-bold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'import' ? 'Importing…' : `Import ${preview.created + preview.updated} products`}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
