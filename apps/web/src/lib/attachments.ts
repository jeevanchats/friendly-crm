import { apiFetch } from './session';

export interface AttachmentInfo {
  id: string;
  leadId: string;
  kind: 'VOICE' | 'FILE';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  createdAt: string;
  leadTitle?: string;
}

async function errorText(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const m = body?.message;
  return (Array.isArray(m) ? m.join(' ') : m) || `${fallback} (${res.status}).`;
}

/** Upload one voice note or file to an enquiry. Never throws: the caller shows `error` next to the item. */
export async function uploadAttachment(
  leadId: string,
  file: Blob,
  fileName: string,
  durationSeconds?: number
): Promise<{ ok: true; attachment: AttachmentInfo } | { ok: false; error: string }> {
  try {
    const form = new FormData();
    form.append('file', file, fileName);
    if (durationSeconds !== undefined) form.append('durationSeconds', String(durationSeconds));
    const res = await apiFetch(`/api/crm/leads/${leadId}/attachments`, { method: 'POST', body: form });
    if (!res.ok) return { ok: false, error: await errorText(res, 'Could not upload') };
    return { ok: true, attachment: await res.json() };
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}

export async function listAttachments(scope: { leadId?: string; customerId?: string }): Promise<AttachmentInfo[]> {
  const q = scope.leadId ? `leadId=${encodeURIComponent(scope.leadId)}` : `customerId=${encodeURIComponent(scope.customerId ?? '')}`;
  const res = await apiFetch(`/api/crm/attachments?${q}`);
  if (!res.ok) throw new Error(await errorText(res, 'Could not load the attachments'));
  return res.json();
}

/** The file arrives through the signed-in session, so it comes back as a Blob rather than a plain link. */
export async function fetchAttachmentBlob(id: string): Promise<Blob> {
  const res = await apiFetch(`/api/crm/attachments/${id}/file`);
  if (!res.ok) throw new Error(await errorText(res, 'Could not open the file'));
  return res.blob();
}

export async function deleteAttachment(id: string): Promise<void> {
  const res = await apiFetch(`/api/crm/attachments/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await errorText(res, 'Could not remove the file'));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
