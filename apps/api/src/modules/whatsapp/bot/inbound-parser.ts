/**
 * Normalises inbound WhatsApp webhook payloads into a flat list of text-like messages.
 * Supports: Meta WhatsApp Cloud API, WAHA / Evolution style, and a simple flat test shape.
 */
export interface InboundMessage {
  /** Provider message id (used for de-duplication). */
  id: string;
  /** Sender as E.164 with leading '+', e.g. +919876543210 */
  from: string;
  type: 'text' | 'media' | 'unsupported';
  /** Text, or the id/title of a tapped button / list row. Empty for media. */
  text: string;
}

function toE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.split('@')[0].replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

function fromMeta(body: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        const from = toE164(m?.from);
        if (!from || !m?.id) continue;
        if (m.type === 'text') {
          out.push({ id: m.id, from, type: 'text', text: String(m.text?.body ?? '') });
        } else if (m.type === 'interactive') {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
          out.push({ id: m.id, from, type: 'text', text: String(r?.id ?? r?.title ?? '') });
        } else if (m.type === 'button') {
          out.push({ id: m.id, from, type: 'text', text: String(m.button?.payload ?? m.button?.text ?? '') });
        } else if (['image', 'audio', 'video', 'document', 'sticker'].includes(m.type)) {
          out.push({ id: m.id, from, type: 'media', text: '' });
        } else {
          out.push({ id: m.id, from, type: 'unsupported', text: '' });
        }
      }
    }
  }
  return out;
}

function fromWaha(body: any): InboundMessage[] {
  const p = body?.payload;
  if (body?.event !== 'message' || !p || p.fromMe) return [];
  const rawFrom: string = String(p.from ?? '');
  if (rawFrom.endsWith('@g.us') || rawFrom.includes('status@broadcast')) return []; // groups / status
  const from = toE164(rawFrom);
  const id = p.id?._serialized ?? (typeof p.id === 'string' ? p.id : undefined);
  if (!from || !id) return [];
  if (p.hasMedia) return [{ id, from, type: 'media', text: '' }];
  return [{ id, from, type: 'text', text: String(p.body ?? '') }];
}

function fromFlat(body: any): InboundMessage[] {
  // { messageId|id, from, text|body } — used by tests and simple gateways
  const from = toE164(body?.from);
  const id = body?.messageId ?? body?.id;
  const text = body?.text ?? body?.body;
  if (!from || !id || typeof text !== 'string' || body?.status) return [];
  return [{ id: String(id), from, type: 'text', text }];
}

export function parseInboundMessages(body: any): InboundMessage[] {
  if (!body || typeof body !== 'object') return [];
  if (body.object === 'whatsapp_business_account' || Array.isArray(body.entry)) return fromMeta(body);
  if (body.event === 'message') return fromWaha(body);
  return fromFlat(body);
}

/**
 * Stable de-duplication keys for a webhook body. Meta's `entry[0].id` is the business
 * account id (identical on every event) so it must NOT be used as an event id.
 */
export function webhookEventKeys(body: any): string[] {
  const keys: string[] = [];
  if (body?.id && typeof body.id === 'string') keys.push(body.id);
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) if (m?.id) keys.push(`msg:${m.id}`);
      for (const s of change?.value?.statuses ?? []) if (s?.id) keys.push(`status:${s.id}:${s.status}`);
    }
  }
  if (body?.statuses?.[0]?.id) keys.push(`status:${body.statuses[0].id}:${body.statuses[0].status}`);
  if (body?.messageId && !body?.id) keys.push(`msg:${body.messageId}${body.status ? ':' + body.status : ''}`);
  const wahaId = body?.payload?.id?._serialized ?? body?.payload?.id;
  if (typeof wahaId === 'string') keys.push(`msg:${wahaId}`);
  return keys;
}

export interface StatusUpdate {
  id: string;
  status: 'DELIVERED' | 'READ' | 'FAILED';
}

/** Delivery-status callbacks (Meta `statuses[]`, legacy `statuses[]`, or flat `{messageId, status}`). */
export function parseStatusUpdates(body: any): StatusUpdate[] {
  const raw: Array<{ id?: string; status?: string }> = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) raw.push(...(change?.value?.statuses ?? []));
  }
  if (Array.isArray(body?.statuses)) raw.push(...body.statuses);
  if (body?.status && body?.messageId) raw.push({ id: body.messageId, status: body.status });

  const out: StatusUpdate[] = [];
  for (const r of raw) {
    const status = String(r?.status ?? '').toUpperCase();
    if (r?.id && ['DELIVERED', 'READ', 'FAILED'].includes(status)) {
      out.push({ id: String(r.id), status: status as StatusUpdate['status'] });
    }
  }
  return out;
}
