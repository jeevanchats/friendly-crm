/**
 * Voice notes and files attached to an enquiry. Shared so the browser can refuse a bad file before uploading it
 * and the API applies exactly the same rules when it arrives.
 */

export type AttachmentKind = 'VOICE' | 'FILE';

export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_LEAD = 10;
/** A voice note longer than this is probably left recording by mistake. */
export const MAX_VOICE_SECONDS = 300;
export const MAX_TRANSCRIPT_CHARS = 5000;

const VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'];

const FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
];

/** Types a browser may show or play in place. Everything else is only ever offered as a download. */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', ...VOICE_TYPES]);

/** "audio/webm;codecs=opus" -> "audio/webm" */
export function baseMimeType(mime: string | undefined | null): string {
  return String(mime ?? '').split(';')[0].trim().toLowerCase();
}

export function attachmentKindFor(mime: string | undefined | null): AttachmentKind | null {
  const base = baseMimeType(mime);
  if (VOICE_TYPES.includes(base)) return 'VOICE';
  if (FILE_TYPES.includes(base)) return 'FILE';
  return null;
}

export function isInlineViewable(mime: string | undefined | null): boolean {
  return INLINE_TYPES.has(baseMimeType(mime));
}

/** Keep the readable part of a file name; drop any folder, control characters and odd symbols. */
export function sanitizeFileName(name: string | undefined | null, fallback = 'attachment'): string {
  const leaf = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = leaf
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return (cleaned || fallback).slice(0, 120);
}

export interface AttachmentCheck {
  ok: boolean;
  /** Why it was refused, in words the person at the counter can act on. */
  reason?: string;
  kind?: AttachmentKind;
}

export function validateAttachment(file: { name?: string; mimeType?: string; size: number }): AttachmentCheck {
  const kind = attachmentKindFor(file.mimeType);
  if (!kind) {
    return { ok: false, reason: 'This kind of file is not accepted. Use a voice note, photo, PDF, Word, Excel, CSV or text file.' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, reason: 'The file is empty.' };
  }
  const max = kind === 'VOICE' ? MAX_VOICE_BYTES : MAX_FILE_BYTES;
  if (file.size > max) {
    return { ok: false, reason: `Too large. A ${kind === 'VOICE' ? 'voice note' : 'file'} can be at most ${Math.round(max / 1024 / 1024)} MB.` };
  }
  return { ok: true, kind };
}
