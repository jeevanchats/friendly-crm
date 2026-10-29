'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Upload } from 'lucide-react';
import { PRODUCT_FIELDS, getIndustryExamples, hasPermission, parseDelimited, parseProductSheet, productTemplateCsv } from '@friendly-crm/shared';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';
import { useLocale } from '../../../components/shared/LocaleProvider';

interface RowResult {
  row: number;
  name: string;
  status: 'create' | 'update' | 'skip' | 'error';
  messages: string[];
  check?: boolean;
}

interface Summary {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  toCheck: number;
  nameCheck?: 'similar' | 'identical-only';
  rows: RowResult[];
}

const CHUNK = 500;
const STATUS_LABEL: Record<RowResult['status'], { en: string; ta: string }> = {
  create: { en: 'Will add', ta: 'சேர்க்கப்படும்' },
  update: { en: 'Will update', ta: 'புதுப்பிக்கப்படும்' },
  skip: { en: 'Skipped', ta: 'தவிர்க்கப்பட்டது' },
  error: { en: 'Problem', ta: 'சிக்கல்' },
};
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
  const [lang] = useLocale();
  const ta = lang === 'ta';
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
    const total: Summary = { dryRun, created: 0, updated: 0, skipped: 0, errors: 0, toCheck: 0, rows: [] };
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
            ? ta
              ? `${i} வரிசைகளுக்குப் பிறகு நிறுத்தப்பட்டது: ${body.message || res.status}. அதற்கு முந்தைய வரிசைகள் இறக்குமதி செய்யப்பட்டன; சிக்கலைச் சரிசெய்து கோப்பை மீண்டும் இறக்குமதி செய்யவும் (ஏற்கனவே உள்ள பொருட்கள் தவிர்க்கப்படும்).`
              : `Stopped after ${i} rows: ${body.message || res.status}. Rows before that were imported; fix the problem and import the file again (existing products are skipped).`
            : Array.isArray(body.message) ? body.message.join(' ') : body.message || (ta ? `சர்வர் கோப்பை ஏற்கவில்லை (${res.status}).` : `The server refused the file (${res.status}).`)
        );
        return null;
      }
      total.created += body.created;
      total.updated += body.updated;
      total.skipped += body.skipped;
      total.errors += body.errors;
      total.toCheck += body.toCheck ?? 0;
      if (body.nameCheck === 'identical-only') total.nameCheck = 'identical-only';
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
      setError(ta ? 'சர்வரை அடைய முடியவில்லை. இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.' : 'Could not reach the server. Check your connection and try again.');
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
      setError(ta ? 'சர்வரை அடைய முடியவில்லை. இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.' : 'Could not reach the server. Check your connection and try again.');
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
        {ta ? 'உங்கள் பொறுப்புக்கு பொருட்கள் பட்டியலை மாற்ற அனுமதி இல்லை.' : 'Your role cannot change the product list.'}
      </p>
    );
  }

  const shown = (r: Summary) => (onlyProblems ? r.rows.filter((x) => x.status === 'error' || x.check) : r.rows);
  const resultTable = (r: Summary, rows = shown(r)) => (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
        <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> {ta ? 'சிக்கல் அல்லது சரிபார்க்க வேண்டிய வரிசைகளை மட்டும் காட்டு' : 'Show only rows with problems or to check'}
      </label>
      <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2">{ta ? 'எண்' : 'No.'}</th>
              <th className="px-3 py-2">{ta ? 'பெயர்' : 'Name'}</th>
              <th className="px-3 py-2">{ta ? 'முடிவு' : 'Result'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((x) => (
              <tr key={x.row} className="align-top">
                <td className="px-3 py-2 text-slate-600">{x.row}</td>
                <td className="px-3 py-2 font-semibold text-foreground">{x.name || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[x.status]}`}>{STATUS_LABEL[x.status][ta ? 'ta' : 'en']}</span>
                  {x.check && <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">{ta ? 'சரிபார்' : 'Check'}</span>}
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
        <ArrowLeft className="h-4 w-4" /> {ta ? 'பொருட்கள்' : 'Products'}
      </Link>
      <div>
        <h1 className="text-xl font-extrabold text-foreground">{ta ? 'பொருட்களை இறக்குமதி செய்' : 'Import products'}</h1>
        <p className="text-xs text-slate-500">
          {ta ? (
            <>உங்கள் பொருட்கள் மற்றும் சேவைகள் பட்டியலை <strong>{active!.tenantName}</strong>-க்குள் கொண்டுவாருங்கள். பட்டியலைச் சரிபார்த்து “இறக்குமதி” அழுத்தும் வரை எதுவும் சேமிக்கப்படாது.</>
          ) : (
            <>Bring your product and service list into <strong>{active!.tenantName}</strong>. Nothing is saved until you check the list and press Import.</>
          )}
        </p>
      </div>

      {done ? (
        <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" aria-label={ta ? 'இறக்குமதி முடிந்தது' : 'Import finished'}>
          <h2 className="text-base font-extrabold text-emerald-900">{ta ? 'இறக்குமதி முடிந்தது' : 'Import finished'}</h2>
          <ul className="text-sm text-emerald-900">
            <li><strong>{done.created}</strong> {ta ? 'பொருட்கள் சேர்க்கப்பட்டன' : 'products added'}</li>
            {done.updated > 0 && <li><strong>{done.updated}</strong> {ta ? 'ஏற்கனவே உள்ள பொருட்கள் புதுப்பிக்கப்பட்டன' : 'existing products updated'}</li>}
            {done.skipped > 0 && <li><strong>{done.skipped}</strong> {ta ? 'தவிர்க்கப்பட்டன (ஏற்கனவே உள்ள பொருட்கள்)' : 'skipped (already products)'}</li>}
            {done.errors > 0 && <li><strong>{done.errors}</strong> {ta ? 'வரிசைகளில் சிக்கல் இருந்ததால் இறக்குமதி செய்யப்படவில்லை' : 'rows had problems and were not imported'}</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href="/products" className="rounded-lg bg-action px-4 py-2 text-xs font-bold text-on-action">{ta ? 'பொருட்களைப் பார்' : 'View products'}</Link>
            {done.errors > 0 && (
              <button type="button" onClick={() => download('products-with-problems.csv', problemsCsv(done))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">
                <Download className="h-3.5 w-3.5" /> {ta ? 'சிக்கல் உள்ள வரிசைகளைப் பதிவிறக்கு' : 'Download rows with problems'}
              </button>
            )}
            <button type="button" onClick={() => { setText(''); setFileName(null); reset(); }} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">{ta ? 'மற்றொரு கோப்பை இறக்குமதி செய்' : 'Import another file'}</button>
          </div>
          {done.errors > 0 && resultTable(done, done.rows.filter((r) => r.status === 'error'))}
        </section>
      ) : (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-surface p-5">
            <h2 className="text-sm font-extrabold text-foreground">{ta ? '1. உங்கள் கோப்பைத் தேர்ந்தெடுங்கள்' : '1. Choose your file'}</h2>
            <p className="text-xs text-slate-500">
              {ta ? (
                <>CSV கோப்பு (Excel-இல்: <em>Save As → CSV UTF-8</em>), அல்லது Excel-இலிருந்து வரிசைகளை நகலெடுத்து கீழே ஒட்டவும். முதல் வரிசை நெடுவரிசைப் பெயர்களாக இருக்க வேண்டும்.</>
              ) : (
                <>A CSV file (in Excel: <em>Save As → CSV UTF-8</em>), or copy the rows from Excel and paste them below. The first row must be the column names.</>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-surface border border-slate-200 px-3 py-2 text-xs font-bold text-brand-ink">
                <Upload className="h-3.5 w-3.5" /> {ta ? 'CSV கோப்பைத் தேர்ந்தெடு' : 'Choose CSV file'}
                <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <button type="button" onClick={() => download('products-template.csv', productTemplateCsv(active!.industryKey))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
                <Download className="h-3.5 w-3.5" /> {ta ? 'மாதிரிக் கோப்பைப் பதிவிறக்கு' : 'Download template'}
              </button>
              {fileName && <span className="text-xs font-semibold text-slate-500">{fileName}</span>}
            </div>
            <textarea
              aria-label={ta ? 'அல்லது Excel-இல் நகலெடுத்த வரிசைகளை ஒட்டவும்' : 'Or paste rows copied from Excel'}
              className="h-32 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              placeholder={`Name\tHSN\tUnit\tRate\tGST %\n${example.name}\t${example.hsnCode}\t${example.unit}\t${example.unitPrice}\t${example.taxPercent}`}
              value={text}
              onChange={(e) => { setText(e.target.value); setFileName(null); reset(); }}
            />
            {text.includes('�') && (
              <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                {ta ? (
                  <>சில எழுத்துகளைப் படிக்க முடியவில்லை (கோப்பு UTF-8 அல்ல). தமிழ்ப் பெயர்கள் சரியாக வர Excel-இல் <em>Save As → CSV UTF-8 (Comma delimited)</em> பயன்படுத்தவும்.</>
                ) : (
                  <>Some characters could not be read (this file is not UTF-8). In Excel use <em>Save As → CSV UTF-8 (Comma delimited)</em> so Tamil names import correctly.</>
                )}
              </p>
            )}
          </section>

          {text.trim() && (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-surface p-5">
              <h2 className="text-sm font-extrabold text-foreground">{ta ? '2. நெடுவரிசைகளைச் சரிபார்க்கவும்' : '2. Check the columns'}</h2>
              {missingName ? (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                  {ta ? (
                    <><strong>பெயர்</strong> நெடுவரிசை கிடைக்கவில்லை. உங்கள் கோப்பில் நெடுவரிசைப் பெயரை மாற்றவும் (எ.கா. “Name” அல்லது “Item”) அல்லது மாதிரிக் கோப்பைப் பயன்படுத்தவும்.</>
                  ) : (
                    <>We could not find a <strong>Name</strong> column. Rename the column in your file (for example “Name” or “Item”) or use the template.</>
                  )}
                </p>
              ) : (
                <p className="text-xs text-slate-600"><strong>{sheet.rows.length}</strong> {ta ? 'பொருட்கள் கிடைத்தன.' : 'products found.'}</p>
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
              {sheet.ignoredHeaders.length > 0 && <p className="text-[11px] text-slate-600">{ta ? 'புறக்கணிக்கப்பட்ட நெடுவரிசைகள்' : 'Ignored columns'}: {sheet.ignoredHeaders.join(', ')}</p>}
              <p className="text-[11px] text-slate-600">{ta ? 'விலை இல்லையெனில் ₹0; GST % இல்லையெனில் 18%. அப்படி நடக்கும் ஒவ்வொரு வரிசையையும் கீழே உள்ள சரிபார்ப்பு காட்டும்.' : 'Missing rate means ₹0; missing GST % means 18%. The check below lists every row where that happens.'}</p>

              <fieldset className="space-y-1 pt-1 text-xs">
                <legend className="font-bold text-slate-500">{ta ? 'அதே பெயர் அல்லது குறியீட்டுடன் பொருள் ஏற்கனவே இருந்தால்' : 'If a product with the same name or code already exists'}</legend>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === 'skip'} onChange={() => { setOnDuplicate('skip'); setPreview(null); }} /> {ta ? 'அப்படியே விடு (பரிந்துரைக்கப்படுகிறது)' : 'Leave it as it is (recommended)'}</label>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === 'update'} onChange={() => { setOnDuplicate('update'); setPreview(null); }} /> {ta ? 'நான் நிரப்பிய நெடுவரிசைகளைப் புதுப்பி (காலி கட்டங்கள் ஏற்கனவே உள்ள மதிப்புகளை மாற்றாது)' : 'Update the columns I filled in (blank cells leave existing values alone)'}</label>
              </fieldset>

              <button
                type="button"
                disabled={missingName || sheet.rows.length === 0 || busy !== null}
                onClick={check}
                className="rounded-lg bg-action px-4 py-2 text-sm font-bold text-on-action disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'check' ? (ta ? 'சரிபார்க்கிறது…' : 'Checking…') : ta ? 'பட்டியலைச் சரிபார்' : 'Check the list'}
              </button>
            </section>
          )}

          {error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}

          {preview && (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-surface p-5" aria-label={ta ? 'சரிபார்ப்பு முடிவுகள்' : 'Check results'}>
              <h2 className="text-sm font-extrabold text-foreground">{ta ? '3. சரிபார்த்து இறக்குமதி செய்' : '3. Review and import'}</h2>
              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">{preview.created} {ta ? 'சேர்க்க' : 'to add'}</span>
                {preview.updated > 0 && <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-800">{preview.updated} {ta ? 'புதுப்பிக்க' : 'to update'}</span>}
                {preview.skipped > 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{preview.skipped} {ta ? 'ஏற்கனவே உள்ள பொருட்கள்' : 'already products'}</span>}
                {preview.toCheck > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">{preview.toCheck} {ta ? 'சரிபார்க்க' : 'to check'}</span>}
                {preview.errors > 0 && <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-800">{preview.errors} {ta ? 'வரிசைகளில் சிக்கல்' : 'with problems'}</span>}
              </div>
              {preview.toCheck > 0 && <p className="text-xs text-slate-500">{ta ? '“சரிபார்” எனக் குறிக்கப்பட்ட வரிசைகள் இறக்குமதியாகும்; ஏற்கனவே உள்ளதுடன் ஒன்றா என்று பார்த்து, ஒன்றென்றால் அந்த வரிசையை நீக்கவும்.' : 'Rows marked Check will be imported. See whether each is the same as one already there, and take it out of the file if so.'}</p>}
              {preview.nameCheck === 'identical-only' && <p className="text-xs text-slate-500">{ta ? 'பெரிய கோப்பு: உங்கள் தற்போதைய பட்டியலுடன் ஒரே மாதிரியான பெயர்கள் மட்டுமே ஒப்பிடப்பட்டன.' : 'Large file: only identical names were compared with your existing list.'}</p>}
              {preview.errors > 0 && <p className="text-xs text-slate-500">{ta ? 'சிக்கல் உள்ள வரிசைகள் சேர்க்கப்படாது. உங்கள் கோப்பில் அவற்றைத் திருத்தி மீண்டும் இறக்குமதி செய்யவும்; ஏற்கனவே சேர்த்த பொருட்கள் தவிர்க்கப்படும்.' : 'Rows with problems are left out. Fix them in your file and import it again; products already added are skipped.'}</p>}
              {resultTable(preview)}
              <button
                type="button"
                disabled={busy !== null || preview.created + preview.updated === 0}
                onClick={doImport}
                className="rounded-lg bg-surface border border-slate-200 px-4 py-2 text-sm font-bold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'import' ? (ta ? 'இறக்குமதி செய்கிறது…' : 'Importing…') : ta ? `${preview.created + preview.updated} பொருட்களை இறக்குமதி செய்` : `Import ${preview.created + preview.updated} products`}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
