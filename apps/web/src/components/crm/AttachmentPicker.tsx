'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Paperclip, Trash2, RotateCcw } from 'lucide-react';
import { MAX_ATTACHMENTS_PER_LEAD, MAX_VOICE_SECONDS, validateAttachment } from '@friendly-crm/shared';
import { formatClock, formatSize } from '../../lib/attachments';

export interface VoiceClip {
  blob: Blob;
  seconds: number;
}

export interface PickerValue {
  voice: VoiceClip | null;
  files: File[];
}

const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** Browsers differ on what they can record; take the first one this browser supports. */
function pickRecorderType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

export function voiceFileName(mime: string): string {
  const base = mime.split(';')[0];
  const ext = base === 'audio/mp4' ? 'm4a' : base === 'audio/ogg' ? 'ogg' : base === 'audio/mpeg' ? 'mp3' : 'webm';
  return `voice-note.${ext}`;
}

const T = {
  voice: { en: 'Voice note of the requirement', ta: 'தேவையின் குரல் பதிவு' },
  record: { en: 'Record', ta: 'பதிவு செய்' },
  stop: { en: 'Stop', ta: 'நிறுத்து' },
  again: { en: 'Record again', ta: 'மீண்டும் பதிவு' },
  recording: { en: 'Recording…', ta: 'பதிவாகிறது…' },
  files: { en: 'Photos & files (design, sketch, PDF)', ta: 'படங்கள் / கோப்புகள் (டிசைன், PDF)' },
  attach: { en: 'Attach', ta: 'இணை' },
  noMic: { en: 'Voice recording is not available in this browser. You can attach an audio file instead.', ta: 'இந்த உலாவியில் குரல் பதிவு இல்லை. ஆடியோ கோப்பை இணைக்கவும்.' },
  denied: { en: 'The microphone is blocked. Allow it in the browser address bar, then try again.', ta: 'மைக்ரோஃபோன் தடுக்கப்பட்டுள்ளது. உலாவியில் அனுமதித்து மீண்டும் முயற்சிக்கவும்.' },
  tooMany: { en: `At most ${MAX_ATTACHMENTS_PER_LEAD} attachments.`, ta: `அதிகபட்சம் ${MAX_ATTACHMENTS_PER_LEAD} இணைப்புகள்.` },
};

/**
 * Record a voice note and/or choose files for an enquiry. Nothing is uploaded here: the parent uploads once the
 * enquiry itself has been saved.
 */
export function AttachmentPicker({
  value,
  onChange,
  lang = 'en',
  disabled = false,
}: {
  value: PickerValue;
  onChange: (next: PickerValue) => void;
  lang?: 'en' | 'ta';
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const canRecord = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!pickRecorderType();

  const release = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Leaving the screen mid-recording must not leave the microphone on.
  useEffect(() => {
    return () => {
      const r = recorderRef.current;
      if (r && r.state !== 'inactive') {
        r.onstop = null;
        r.stop();
      }
      release();
    };
  }, []);

  useEffect(() => {
    if (!value.voice) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value.voice.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value.voice]);

  const start = async () => {
    setNotice(null);
    try {
      const type = pickRecorderType();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const seconds = Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - startedRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || type || 'audio/webm' });
        release();
        setRecording(false);
        if (blob.size === 0) return;
        const check = validateAttachment({ mimeType: blob.type, size: blob.size });
        if (!check.ok) {
          setNotice(check.reason ?? null);
          return;
        }
        onChange({ ...valueRef.current, voice: { blob, seconds } });
      };
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setElapsed(0);
      recorder.start();
      setRecording(true);
      timerRef.current = setInterval(() => {
        const s = Math.round((Date.now() - startedRef.current) / 1000);
        setElapsed(s);
        if (s >= MAX_VOICE_SECONDS && recorder.state !== 'inactive') recorder.stop();
      }, 500);
    } catch (err: any) {
      release();
      setRecording(false);
      setNotice(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? T.denied[lang] : err?.message || T.noMic[lang]);
    }
  };

  const stop = () => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  };

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    setNotice(null);
    const next = [...value.files];
    const problems: string[] = [];
    for (const f of Array.from(picked)) {
      const check = validateAttachment({ name: f.name, mimeType: f.type, size: f.size });
      if (!check.ok) problems.push(`${f.name}: ${check.reason}`);
      else if (next.length + (value.voice ? 1 : 0) >= MAX_ATTACHMENTS_PER_LEAD) problems.push(T.tooMany[lang]);
      else next.push(f);
    }
    onChange({ ...value, files: next });
    if (problems.length) setNotice(problems.join(' '));
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-[#F6F8F7] p-3">
      {/* Voice note */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase text-slate-500">{T.voice[lang]}</p>
        {recording ? (
          <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
              {T.recording[lang]} {formatClock(elapsed)}
            </span>
            <button type="button" onClick={stop} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-bold text-white">
              <Square className="h-3.5 w-3.5" /> {T.stop[lang]}
            </button>
          </div>
        ) : value.voice ? (
          <div className="flex items-center gap-2">
            {previewUrl && <audio controls src={previewUrl} className="h-10 min-w-0 flex-1" />}
            <span className="text-xs font-semibold text-slate-500">{formatClock(value.voice.seconds)}</span>
            <button
              type="button"
              onClick={() => onChange({ ...value, voice: null })}
              disabled={disabled}
              aria-label={T.again[lang]}
              title={T.again[lang]}
              className="rounded-lg p-2 text-slate-500 hover:bg-white"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={disabled || !canRecord}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-[#243B40] disabled:opacity-50"
          >
            <Mic className="h-4 w-4 text-[#167D79]" /> {T.record[lang]}
          </button>
        )}
        {!canRecord && !value.voice && <p className="mt-1 text-[11px] text-slate-500">{T.noMic[lang]}</p>}
      </div>

      {/* Files */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase text-slate-500">{T.files[lang]}</p>
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-[#243B40]">
          <Paperclip className="h-4 w-4 text-[#167D79]" /> {T.attach[lang]}
          <input
            type="file"
            multiple
            disabled={disabled}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,audio/*"
            className="sr-only"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {value.files.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {value.files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs">
                <span className="min-w-0 truncate font-medium text-[#243B40]">
                  {f.name} <span className="text-slate-400">· {formatSize(f.size)}</span>
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, files: value.files.filter((_, j) => j !== i) })}
                  aria-label={`Remove ${f.name}`}
                  className="ml-2 rounded p-1 text-slate-400 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {notice && (
        <p role="alert" className="rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">
          {notice}
        </p>
      )}
    </div>
  );
}
