'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Upload } from 'lucide-react';
import { CUSTOMER_FIELDS, customerTemplateCsv, hasPermission, parseCustomerSheet, parseDelimited } from '@friendly-crm/shared';
import { useAuth } from '../../../components/auth/AuthProvider';
import { apiFetch } from '../../../lib/session';
import { useLocale } from '../../../components/shared/LocaleProvider';
import { ImportFileError, readImportFile } from '../../../lib/import-file';

interface RowResult {
  row: number;
  name: string;
  phone: string;
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
  openingBalanceTotal: number;
  openingCreditTotal: number;
  rows: RowResult[];
}

const CHUNK = 500;
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export default function ImportCustomersPage() {
  const { active } = useAuth();
  const [lang] = useLocale();
  const ta = lang === 'ta';
  const tenantId = active!.tenantId;
  const canImport = hasPermission(active!.role, 'customer:create');
  const canBalance = hasPermission(active!.role, 'payment:create');

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheetNote, setSheetNote] = useState<{ name: string; others: number } | null>(null);
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
    setSheetNote(null);
    try {
      const read = await readImportFile(file);
      setFileName(file.name);
      setText(read.text);
      setSheetNote(read.sheet ?? null);
    } catch (err) {
      setFileName(null);
      setText('');
      setError(err instanceof ImportFileError ? (ta ? err.ta : err.en) : ta ? 'கோப்பைப் படிக்க முடியவில்லை.' : 'The file could not be read.');
    }
  };

  /** Sends the rows in batches (the server takes up to 1000 at a time) and joins the answers. */
  const run = async (dryRun: boolean): Promise<Summary | null> => {
    const total: Summary = { dryRun, created: 0, updated: 0, skipped: 0, errors: 0, toCheck: 0, openingBalanceTotal: 0, openingCreditTotal: 0, rows: [] };
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
            ? ta
              ? `${i} வரிசைகளுக்குப் பிறகு நிறுத்தப்பட்டது: ${body.message || res.status}. அதற்கு முந்தைய வரிசைகள் இறக்குமதி செய்யப்பட்டன; சிக்கலைச் சரிசெய்து கோப்பை மீண்டும் இறக்குமதி செய்யவும் (ஏற்கனவே உள்ள வாடிக்கையாளர்கள் தவிர்க்கப்படுவர்).`
              : `Stopped after ${i} rows: ${body.message || res.status}. Rows before that were imported; fix the problem and import the file again (existing customers are skipped).`
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
      total.openingBalanceTotal += Number(body.openingBalanceTotal);
      total.openingCreditTotal += Number(body.openingCreditTotal ?? 0);
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
    const bad = r.rows.filter((x) => x.status === 'error');
    return ['No.,Name,Phone,Problem', ...bad.map((x) => [x.row, q(x.name), q(x.phone), q(x.messages.join('; '))].join(','))].join('\r\n');
  };

  if (!canImport) {
    return (
      <p role="alert" className="rounded-2xl border border-slate-200 bg-surface p-8 text-center text-sm font-semibold text-slate-500">
        {ta ? 'உங்கள் பொறுப்புக்கு வாடிக்கையாளர்களைச் சேர்க்க அனுமதி இல்லை.' : 'Your role cannot add customers.'}
      </p>
    );
  }

  const shown = (r: Summary) => (onlyProblems ? r.rows.filter((x) => x.status === 'error' || x.check) : r.rows);
  const resultTable = (r: Summary) => (
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
              <th className="px-3 py-2">{ta ? 'தொலைபேசி' : 'Phone'}</th>
              <th className="px-3 py-2">{ta ? 'முடிவு' : 'Result'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown(r).map((x) => (
              <tr key={x.row} className="align-top">
                <td className="px-3 py-2 text-slate-600">{x.row}</td>
                <td className="px-3 py-2 font-semibold text-foreground">{x.name || '—'}</td>
                <td className="px-3 py-2">{x.phone || '—'}</td>
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
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        <ArrowLeft className="h-4 w-4" /> {ta ? 'வாடிக்கையாளர்கள்' : 'Customers'}
      </Link>
      <div>
        <h1 className="text-xl font-extrabold text-foreground">{ta ? 'வாடிக்கையாளர்களை இறக்குமதி செய்' : 'Import customers'}</h1>
        <p className="text-xs text-slate-500">
          {ta ? (
            <>உங்கள் தற்போதைய வாடிக்கையாளர் பட்டியலை <strong>{active!.tenantName}</strong>-க்குள் கொண்டுவாருங்கள். பட்டியலைச் சரிபார்த்து “இறக்குமதி” அழுத்தும் வரை எதுவும் சேமிக்கப்படாது.</>
          ) : (
            <>Bring your existing customer list into <strong>{active!.tenantName}</strong>. Nothing is saved until you check the list and press Import.</>
          )}
        </p>
      </div>

      {done ? (
        <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5" aria-label={ta ? 'இறக்குமதி முடிந்தது' : 'Import finished'}>
          <h2 className="text-base font-extrabold text-emerald-900">{ta ? 'இறக்குமதி முடிந்தது' : 'Import finished'}</h2>
          <ul className="text-sm text-emerald-900">
            <li><strong>{done.created}</strong> {ta ? 'வாடிக்கையாளர்கள் சேர்க்கப்பட்டனர்' : 'customers added'}{done.openingBalanceTotal > 0 && <> {ta ? `(${rupees(done.openingBalanceTotal)} தொடக்க நிலுவையுடன்)` : `with ${rupees(done.openingBalanceTotal)} of opening balances`}</>}{done.openingCreditTotal > 0 && <> {ta ? `(${rupees(done.openingCreditTotal)} முன்பணத்துடன்)` : `and ${rupees(done.openingCreditTotal)} paid in advance`}</>}</li>
            {done.updated > 0 && <li><strong>{done.updated}</strong> {ta ? 'ஏற்கனவே உள்ள வாடிக்கையாளர்கள் புதுப்பிக்கப்பட்டனர்' : 'existing customers updated'}</li>}
            {done.skipped > 0 && <li><strong>{done.skipped}</strong> {ta ? 'தவிர்க்கப்பட்டனர் (ஏற்கனவே வாடிக்கையாளர்கள்)' : 'skipped (already customers)'}</li>}
            {done.errors > 0 && <li><strong>{done.errors}</strong> {ta ? 'வரிசைகளில் சிக்கல் இருந்ததால் இறக்குமதி செய்யப்படவில்லை' : 'rows had problems and were not imported'}</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href="/customers" className="rounded-lg bg-action px-4 py-2 text-xs font-bold text-on-action">{ta ? 'வாடிக்கையாளர்களைப் பார்' : 'View customers'}</Link>
            {done.openingBalanceTotal > 0 && <Link href="/dues" className="rounded-lg border border-brand-ink px-4 py-2 text-xs font-bold text-brand-ink">{ta ? 'யார் பாக்கி தர வேண்டும் எனப் பார்' : 'See who owes you'}</Link>}
            {done.errors > 0 && (
              <button type="button" onClick={() => download('customers-with-problems.csv', problemsCsv(done))} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">
                <Download className="h-3.5 w-3.5" /> {ta ? 'சிக்கல் உள்ள வரிசைகளைப் பதிவிறக்கு' : 'Download rows with problems'}
              </button>
            )}
            <button type="button" onClick={() => { setText(''); setFileName(null); setSheetNote(null); reset(); }} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700">{ta ? 'மற்றொரு கோப்பை இறக்குமதி செய்' : 'Import another file'}</button>
          </div>
          {done.errors > 0 && resultTable({ ...done, rows: done.rows.filter((r) => r.status === 'error') })}
        </section>
      ) : (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-surface p-5">
            <h2 className="text-sm font-extrabold text-foreground">{ta ? '1. உங்கள் கோப்பைத் தேர்ந்தெடுங்கள்' : '1. Choose your file'}</h2>
            <p className="text-xs text-slate-500">
              {ta ? (
                <>Excel கோப்பு (.xlsx) அல்லது CSV கோப்பு, அல்லது Excel-இலிருந்து வரிசைகளை நகலெடுத்து கீழே ஒட்டவும். முதல் வரிசை நெடுவரிசைப் பெயர்களாக இருக்க வேண்டும். தரவுள்ள முதல் தாள் மட்டும் படிக்கப்படும்.</>
              ) : (
                <>An Excel file (.xlsx) or a CSV file, or copy the rows from Excel and paste them below. The first row must be the column names. Only the first sheet with data is read.</>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-surface border border-slate-200 px-3 py-2 text-xs font-bold text-brand-ink">
                <Upload className="h-3.5 w-3.5" /> {ta ? 'Excel / CSV கோப்பைத் தேர்ந்தெடு' : 'Choose Excel or CSV file'}
                <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <button type="button" onClick={() => download('customers-template.csv', customerTemplateCsv())} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
                <Download className="h-3.5 w-3.5" /> {ta ? 'மாதிரிக் கோப்பைப் பதிவிறக்கு' : 'Download template'}
              </button>
              {fileName && <span className="text-xs font-semibold text-slate-500">{fileName}</span>}
              {sheetNote && (
                <p className="w-full text-xs font-semibold text-slate-500">
                  {ta ? `Excel தாள் “${sheetNote.name}” படிக்கப்பட்டது` : `Read the Excel sheet “${sheetNote.name}”`}
                  {sheetNote.others > 0 ? (ta ? ` (தரவுள்ள மற்ற ${sheetNote.others} தாள்கள் படிக்கப்படவில்லை)` : ` (${sheetNote.others} other sheet${sheetNote.others === 1 ? '' : 's'} with data not read)`) : ''}
                </p>
              )}
            </div>
            <textarea
              aria-label={ta ? 'அல்லது Excel-இல் நகலெடுத்த வரிசைகளை ஒட்டவும்' : 'Or paste rows copied from Excel'}
              className="h-32 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              placeholder={'Name\tPhone\tState\tOpening balance\nAnand Traders\t9840011111\tTamil Nadu\t12500'}
              value={text}
              onChange={(e) => { setText(e.target.value); setFileName(null); setSheetNote(null); reset(); }}
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
              {missing.length > 0 ? (
                <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                  {ta ? (
                    <><strong>{missing.map((m) => (m === 'name' ? 'பெயர்' : 'தொலைபேசி')).join(' மற்றும் ')}</strong> நெடுவரிசை கிடைக்கவில்லை. உங்கள் கோப்பில் நெடுவரிசைப் பெயரை மாற்றவும் (எ.கா. “Name”, “Mobile”) அல்லது மாதிரிக் கோப்பைப் பயன்படுத்தவும்.</>
                  ) : (
                    <>We could not find a <strong>{missing.map((m) => (m === 'name' ? 'Name' : 'Phone')).join(' and ')}</strong> column. Rename the column in your file (for example “Name”, “Mobile”) or use the template.</>
                  )}
                </p>
              ) : (
                <p className="text-xs text-slate-600"><strong>{sheet.rows.length}</strong> {ta ? 'வாடிக்கையாளர்கள் கிடைத்தனர்.' : 'customers found.'}</p>
              )}
              <ul className="grid gap-1 text-xs sm:grid-cols-2">
                {CUSTOMER_FIELDS.map((f) => {
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
              {hasBalanceColumn && !canBalance && (
                <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                  {ta ? 'உங்கள் பொறுப்புக்கு தொடக்க நிலுவையை இறக்குமதி செய்ய அனுமதி இல்லை. அந்த நெடுவரிசையை நீக்கவும், அல்லது உரிமையாளர் / கணக்காளரிடம் இந்தக் கோப்பை இறக்குமதி செய்யக் கேளுங்கள்.' : 'Your role cannot import opening balances. Remove that column, or ask the owner or accounts to import this file.'}
                </p>
              )}

              <fieldset className="space-y-1 pt-1 text-xs">
                <legend className="font-bold text-slate-500">{ta ? 'ஒரு தொலைபேசி எண் ஏற்கனவே வாடிக்கையாளராக இருந்தால்' : 'If a phone number is already a customer'}</legend>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === 'skip'} onChange={() => { setOnDuplicate('skip'); setPreview(null); }} /> {ta ? 'அப்படியே விடு (பரிந்துரைக்கப்படுகிறது)' : 'Leave them as they are (recommended)'}</label>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === 'update'} onChange={() => { setOnDuplicate('update'); setPreview(null); }} /> {ta ? 'அவர்களின் காலியான விவரங்களை நிரப்பு (பெயர் அல்லது நிலுவையை மாற்றாது)' : 'Fill in their blank details (never changes names or balances)'}</label>
              </fieldset>

              <button
                type="button"
                disabled={missing.length > 0 || sheet.rows.length === 0 || busy !== null}
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
                {preview.skipped > 0 && <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{preview.skipped} {ta ? 'ஏற்கனவே வாடிக்கையாளர்கள்' : 'already customers'}</span>}
                {preview.toCheck > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">{preview.toCheck} {ta ? 'சரிபார்க்க' : 'to check'}</span>}
                {preview.errors > 0 && <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-800">{preview.errors} {ta ? 'வரிசைகளில் சிக்கல்' : 'with problems'}</span>}
                {preview.openingBalanceTotal > 0 && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-900">{rupees(preview.openingBalanceTotal)} {ta ? 'தொடக்க நிலுவை' : 'opening balances'}</span>}
                {preview.openingCreditTotal > 0 && <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-900">{rupees(preview.openingCreditTotal)} {ta ? 'முன்பணம் (கிரெடிட்)' : 'advances (credit)'}</span>}
              </div>
              {preview.toCheck > 0 && <p className="text-xs text-slate-500">{ta ? '“சரிபார்” எனக் குறிக்கப்பட்ட வரிசைகள் இறக்குமதியாகும்; ஏற்கனவே உள்ளதுடன் ஒன்றா என்று பார்த்து, ஒன்றென்றால் அந்த வரிசையை நீக்கவும்.' : 'Rows marked Check will be imported. See whether each is the same as one already there, and take it out of the file if so.'}</p>}
              {preview.nameCheck === 'identical-only' && <p className="text-xs text-slate-500">{ta ? 'பெரிய கோப்பு: உங்கள் தற்போதைய பட்டியலுடன் ஒரே மாதிரியான பெயர்கள் மட்டுமே ஒப்பிடப்பட்டன.' : 'Large file: only identical names were compared with your existing list.'}</p>}
              {preview.errors > 0 && <p className="text-xs text-slate-500">{ta ? 'சிக்கல் உள்ள வரிசைகள் சேர்க்கப்படாது. உங்கள் கோப்பில் அவற்றைத் திருத்தி மீண்டும் இறக்குமதி செய்யவும்; ஏற்கனவே சேர்த்த வாடிக்கையாளர்கள் தவிர்க்கப்படுவர்.' : 'Rows with problems are left out. Fix them in your file and import it again; customers already added are skipped.'}</p>}
              {resultTable(preview)}
              <button
                type="button"
                disabled={busy !== null || preview.created + preview.updated === 0}
                onClick={doImport}
                className="rounded-lg bg-surface border border-slate-200 px-4 py-2 text-sm font-bold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'import' ? (ta ? 'இறக்குமதி செய்கிறது…' : 'Importing…') : ta ? `${preview.created + preview.updated} வாடிக்கையாளர்களை இறக்குமதி செய்` : `Import ${preview.created + preview.updated} customers`}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
