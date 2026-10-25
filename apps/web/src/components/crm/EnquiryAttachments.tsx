'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Mic, FileText, Image as ImageIcon, Download, Trash2, Play } from 'lucide-react';
import { hasPermission, SuggestedLine } from '@friendly-crm/shared';
import { apiFetch } from '../../lib/session';
import { useAuth } from '../auth/AuthProvider';
import { AttachmentPicker, PickerValue, voiceFileName } from './AttachmentPicker';
import {
  AttachmentInfo,
  deleteAttachment,
  fetchAttachmentBlob,
  formatClock,
  formatSize,
  listAttachments,
  saveBlob,
  uploadAttachment,
} from '../../lib/attachments';

function Row({ item, canRemove, onRemoved }: { item: AttachmentInfo; canRemove: boolean; onRemoved: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isImage = item.mimeType.startsWith('image/');

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const load = async (): Promise<Blob | null> => {
    setBusy(true);
    setError(null);
    try {
      return await fetchAttachmentBlob(item.id);
    } catch (e: any) {
      setError(e?.message || 'Could not open the file.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const show = async () => {
    const blob = await load();
    if (blob) setUrl(URL.createObjectURL(blob));
  };
  const download = async () => {
    const blob = await load();
    if (blob) saveBlob(blob, item.fileName);
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${item.fileName}?`)) return;
    try {
      await deleteAttachment(item.id);
      onRemoved();
    } catch (e: any) {
      setError(e?.message || 'Could not remove the file.');
    }
  };

  const Icon = item.kind === 'VOICE' ? Mic : isImage ? ImageIcon : FileText;
  return (
    <li className="rounded-xl bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-[#167D79]" />
          <span className="min-w-0 truncate font-medium text-[#243B40]">
            {item.kind === 'VOICE' ? 'Voice note' : item.fileName}
            <span className="ml-1.5 text-xs font-normal text-slate-400">
              {item.kind === 'VOICE' && item.durationSeconds != null ? `${formatClock(item.durationSeconds)} · ` : ''}
              {formatSize(item.sizeBytes)}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {(item.kind === 'VOICE' || isImage) && !url && (
            <button type="button" onClick={show} disabled={busy} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#167D79] px-3 text-xs font-bold text-white disabled:opacity-50">
              <Play className="h-3.5 w-3.5" /> {busy ? '…' : item.kind === 'VOICE' ? 'Play' : 'View'}
            </button>
          )}
          <button type="button" onClick={download} disabled={busy} aria-label={`Download ${item.fileName}`} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            <Download className="h-4 w-4" />
          </button>
          {canRemove && (
            <button type="button" onClick={remove} aria-label={`Remove ${item.fileName}`} className="rounded-lg p-2 text-slate-400 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>
      {item.kind === 'VOICE' && item.transcript && <p className="mt-1.5 text-xs italic text-slate-600">“{item.transcript}”</p>}
      {url && item.kind === 'VOICE' && <audio controls autoPlay src={url} className="mt-2 h-10 w-full" />}
      {url && isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={item.fileName} className="mt-2 max-h-72 rounded-lg border border-slate-200 object-contain" />
      )}
      {error && <p role="alert" className="mt-1.5 text-xs font-semibold text-red-700">{error}</p>}
    </li>
  );
}

/**
 * The voice note and files that came with an enquiry, shown while its quote is being prepared.
 * Give it the enquiry (leadId) when known, otherwise the customer: it then lists those of their live enquiries.
 */
export function EnquiryAttachments({
  leadId,
  customerId,
  onSuggest,
}: {
  leadId?: string;
  customerId?: string;
  /** Called with the lines read from the enquiry, to be added to the quotation form. */
  onSuggest?: (lines: SuggestedLine[]) => void;
}) {
  const { active } = useAuth();
  const [items, setItems] = useState<AttachmentInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PickerValue>({ voice: null, files: [] });
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<{ summary: string; skipped: string[]; count: number; message?: string } | null>(null);

  const allowed = !!active && hasPermission(active.role, 'lead:view');
  const canAdd = !!active && hasPermission(active.role, 'lead:create');
  const canRemove = !!active && hasPermission(active.role, 'lead:update');

  const reload = useCallback(async () => {
    try {
      setItems(await listAttachments(leadId ? { leadId } : { customerId }));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load the attachments.');
    }
  }, [leadId, customerId]);

  useEffect(() => {
    if (allowed && (leadId || customerId)) void reload();
  }, [allowed, leadId, customerId, active?.tenantId, reload]);

  if (!allowed || (!leadId && !customerId)) return null;
  // An enquiry the customer sent nothing with, and no way to add: nothing to show
  const targetLead = leadId ?? (items && items.length && items.every((i) => i.leadId === items[0].leadId) ? items[0].leadId : undefined);
  if (items && items.length === 0 && !error && !(canAdd && targetLead)) return null;

  const upload = async () => {
    if (!targetLead) return;
    setSaving(true);
    setError(null);
    const failures: string[] = [];
    let voice = draft.voice;
    if (voice) {
      const r = await uploadAttachment(targetLead, voice.blob, voiceFileName(voice.blob.type), voice.seconds, voice.transcript);
      if (r.ok) voice = null;
      else failures.push(`Voice note: ${r.error}`);
    }
    const left: File[] = [];
    for (const f of draft.files) {
      const r = await uploadAttachment(targetLead, f, f.name);
      if (!r.ok) {
        left.push(f);
        failures.push(`${f.name}: ${r.error}`);
      }
    }
    setDraft({ voice, files: left });
    setSaving(false);
    await reload();
    if (failures.length) setError(failures.join(' '));
    else setAdding(false);
  };

  const readEnquiry = async () => {
    setReading(true);
    setError(null);
    setReadNote(null);
    try {
      const res = await apiFetch('/api/sales/quotations/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadId ? { leadId } : { customerId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((Array.isArray(body.message) ? body.message.join(' ') : body.message) || `Could not read the enquiry (${res.status}).`);
        return;
      }
      setReadNote({ summary: body.summary ?? '', skipped: body.skipped ?? [], count: body.lines?.length ?? 0, message: body.enabled === false ? body.message : undefined });
      if (body.lines?.length) onSuggest?.(body.lines as SuggestedLine[]);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setReading(false);
    }
  };
  const canRead = !!onSuggest && !!active && hasPermission(active.role, 'quote:create');

  const titles = new Set((items ?? []).map((i) => i.leadTitle).filter(Boolean));

  return (
    <section className="space-y-2 rounded-2xl border border-[#167D79]/30 bg-[#F6F8F7] p-4" aria-label="Enquiry attachments">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#243B40]">Customer’s requirement{titles.size === 1 ? `: ${[...titles][0]}` : ''}</h2>
        {canAdd && targetLead && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-xs font-bold text-[#167D79]">
            ＋ Add
          </button>
        )}
      </div>
      {items === null && !error && <p className="text-xs text-slate-400">Loading…</p>}
      {canRead && (
        <button
          type="button"
          onClick={readEnquiry}
          disabled={reading}
          className="w-full min-h-[44px] rounded-xl bg-[#243B40] text-sm font-bold text-white disabled:opacity-50"
        >
          {reading ? 'Reading the notes, files and voice note…' : '✨ Read enquiry and fill the quote'}
        </button>
      )}
      {readNote && (
        <div className="rounded-lg bg-white p-3 text-xs text-[#243B40]">
          {readNote.message ? (
            <p className="font-semibold text-amber-800">{readNote.message}</p>
          ) : (
            <p className="font-semibold">
              {readNote.count > 0
                ? `${readNote.count} line${readNote.count === 1 ? '' : 's'} added to the quote below. Check each one and fill what is marked missing.`
                : 'Nothing could be filled in automatically. Add the lines by hand.'}
            </p>
          )}
          {readNote.summary && <p className="mt-1 text-slate-600">{readNote.summary}</p>}
          {readNote.skipped.map((n, i) => (
            <p key={i} className="mt-1 text-amber-800">{n}</p>
          ))}
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <Row key={it.id} item={it} canRemove={canRemove} onRemoved={reload} />
          ))}
        </ul>
      )}
      {adding && (
        <div className="space-y-2">
          <AttachmentPicker value={draft} onChange={setDraft} disabled={saving} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={upload}
              disabled={saving || (!draft.voice && draft.files.length === 0)}
              className="min-h-[42px] flex-1 rounded-xl bg-[#167D79] text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? 'Uploading…' : 'Upload'}
            </button>
            <button type="button" onClick={() => { setAdding(false); setDraft({ voice: null, files: [] }); }} disabled={saving} className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-[#243B40]">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs font-semibold text-red-700">{error}</p>}
    </section>
  );
}
