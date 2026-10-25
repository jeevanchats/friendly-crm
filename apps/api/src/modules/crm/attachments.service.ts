import { Injectable, BadRequestException, NotFoundException, HttpException, Logger } from '@nestjs/common';
import { sql, eq, and, desc, ne, inArray } from 'drizzle-orm';
import { db, leads, leadAttachments } from '@friendly-crm/db';
import {
  validateAttachment,
  sanitizeFileName,
  baseMimeType,
  MAX_ATTACHMENTS_PER_LEAD,
  MAX_VOICE_SECONDS,
  MAX_TRANSCRIPT_CHARS,
  AttachmentKind,
} from '@friendly-crm/shared';
import { randomUUID } from 'crypto';
import { tenantContextStorage } from '../../common/interceptors/tenant-rls.interceptor';
import { globalMemoryLeads } from './memory-store';

export interface UploadedFile {
  originalname?: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

export interface AttachmentInfo {
  id: string;
  leadId: string;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  /** What was said in a voice note, as written down by the browser and checked by staff. */
  transcript: string | null;
  createdAt: Date;
}

interface StoredAttachment extends AttachmentInfo {
  tenantId: string;
  data: Buffer;
}

// Used only when Postgres is unreachable (local offline development and tests), like the rest of the CRM module.
const memoryAttachments: StoredAttachment[] = [];

const infoOf = (a: any): AttachmentInfo => ({
  id: a.id,
  leadId: a.leadId,
  kind: a.kind,
  fileName: a.fileName,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  durationSeconds: a.durationSeconds ?? null,
  transcript: a.transcript ?? null,
  createdAt: a.createdAt,
});

const INFO_COLUMNS = {
  id: leadAttachments.id,
  leadId: leadAttachments.leadId,
  kind: leadAttachments.kind,
  fileName: leadAttachments.fileName,
  mimeType: leadAttachments.mimeType,
  sizeBytes: leadAttachments.sizeBytes,
  durationSeconds: leadAttachments.durationSeconds,
  transcript: leadAttachments.transcript,
  createdAt: leadAttachments.createdAt,
};

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  private getDb() {
    return tenantContextStorage.getStore()?.tx || db;
  }

  /** Run in a transaction pinned to this business so row-level security applies even outside a request. */
  private async inTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return this.getDb().transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
  }

  /** Real validation errors reach the caller; only a database that cannot be reached falls back to memory. */
  private rethrowUnlessOffline(err: any): void {
    if (err instanceof HttpException) throw err;
    this.logger.warn(`Postgres offline; using memory for attachments: ${err?.message}`);
  }

  async add(
    tenantId: string,
    userId: string | null,
    leadId: string,
    file: UploadedFile | undefined,
    durationSeconds?: unknown,
    transcript?: unknown
  ): Promise<AttachmentInfo> {
    if (!file || !file.buffer) throw new BadRequestException('Choose a file or record a voice note first.');
    const mimeType = baseMimeType(file.mimetype);
    const check = validateAttachment({ name: file.originalname, mimeType, size: file.size });
    if (!check.ok || !check.kind) throw new BadRequestException(check.reason);
    const kind = check.kind;

    let duration: number | null = null;
    if (kind === 'VOICE' && durationSeconds !== undefined && durationSeconds !== '') {
      const n = Math.round(Number(durationSeconds));
      if (Number.isFinite(n) && n >= 0) duration = Math.min(n, MAX_VOICE_SECONDS);
    }
    const text = kind === 'VOICE' && typeof transcript === 'string' && transcript.trim() ? transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS) : null;
    const fileName = sanitizeFileName(file.originalname, kind === 'VOICE' ? 'voice-note' : 'attachment');

    try {
      const saved = await this.inTenant(tenantId, async (tx) => {
        const [lead] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId))).limit(1);
        if (!lead) return null; // maybe a memory-only enquiry (offline development); the fallback below decides
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(leadAttachments)
          .where(and(eq(leadAttachments.tenantId, tenantId), eq(leadAttachments.leadId, leadId)));
        if (n >= MAX_ATTACHMENTS_PER_LEAD) {
          throw new BadRequestException(`An enquiry can have at most ${MAX_ATTACHMENTS_PER_LEAD} attachments. Remove one first.`);
        }
        const [row] = await tx
          .insert(leadAttachments)
          .values({ tenantId, leadId, kind, fileName, mimeType, sizeBytes: file.size, durationSeconds: duration, transcript: text, data: file.buffer, createdById: userId })
          .returning(INFO_COLUMNS);
        return infoOf(row);
      });
      if (saved) return saved;
    } catch (err: any) {
      this.rethrowUnlessOffline(err);
    }

    // Memory fallback
    if (!globalMemoryLeads.some((l: any) => l.tenantId === tenantId && l.id === leadId)) throw new NotFoundException('Enquiry not found.');
    if (memoryAttachments.filter((a) => a.tenantId === tenantId && a.leadId === leadId).length >= MAX_ATTACHMENTS_PER_LEAD) {
      throw new BadRequestException(`An enquiry can have at most ${MAX_ATTACHMENTS_PER_LEAD} attachments. Remove one first.`);
    }
    const stored: StoredAttachment = {
      id: randomUUID(), tenantId, leadId, kind, fileName, mimeType, sizeBytes: file.size, durationSeconds: duration, transcript: text, createdAt: new Date(), data: file.buffer,
    };
    memoryAttachments.unshift(stored);
    return infoOf(stored);
  }

  /**
   * Attachments of one enquiry, or of a customer's enquiries that are still live (not lost), newest first.
   * What a person preparing a quote needs: they open "New quote" from the customer and still find the voice note.
   */
  async list(tenantId: string, scope: { leadId?: string; customerId?: string }): Promise<Array<AttachmentInfo & { leadTitle: string }>> {
    if (!scope.leadId && !scope.customerId) throw new BadRequestException('Say which enquiry or customer to list.');
    try {
      const fromDb = await this.inTenant(tenantId, async (tx) => {
        const leadFilter = scope.leadId
          ? and(eq(leads.tenantId, tenantId), eq(leads.id, scope.leadId))
          : and(eq(leads.tenantId, tenantId), eq(leads.customerId, scope.customerId!), ne(leads.stage, 'LOST'));
        const found = await tx.select({ id: leads.id, title: leads.title }).from(leads).where(leadFilter);
        if (!found.length) return null;
        const titles = new Map<string, string>(found.map((l: any) => [l.id, l.title]));
        const rows = await tx
          .select(INFO_COLUMNS)
          .from(leadAttachments)
          .where(and(eq(leadAttachments.tenantId, tenantId), inArray(leadAttachments.leadId, [...titles.keys()])))
          .orderBy(desc(leadAttachments.createdAt))
          .limit(50);
        return rows.map((r: any) => ({ ...infoOf(r), leadTitle: titles.get(r.leadId) ?? '' }));
      });
      if (fromDb) return fromDb;
    } catch (err: any) {
      this.rethrowUnlessOffline(err);
    }

    const memLeads = (globalMemoryLeads as any[]).filter(
      (l) => l.tenantId === tenantId && (scope.leadId ? l.id === scope.leadId : l.customerId === scope.customerId && l.stage !== 'LOST')
    );
    const titles = new Map<string, string>(memLeads.map((l) => [l.id, l.title]));
    return memoryAttachments
      .filter((a) => a.tenantId === tenantId && titles.has(a.leadId))
      .slice(0, 50)
      .map((a) => ({ ...infoOf(a), leadTitle: titles.get(a.leadId) ?? '' }));
  }

  /**
   * Everything the quote reader needs about an enquiry (or a customer's live enquiries): what was typed on the
   * enquiry itself and each attachment with its bytes. Only called when staff ask for the enquiry to be read.
   */
  async readable(
    tenantId: string,
    scope: { leadId?: string; customerId?: string }
  ): Promise<{ leads: Array<{ id: string; title: string; notes: string | null; customData: Record<string, any> }>; attachments: Array<AttachmentInfo & { data: Buffer }> }> {
    const infos = await this.list(tenantId, scope);
    const attachments: Array<AttachmentInfo & { data: Buffer }> = [];
    for (const i of infos.slice(0, MAX_ATTACHMENTS_PER_LEAD)) attachments.push(await this.get(tenantId, i.id));

    const leadRows = async (): Promise<Array<{ id: string; title: string; notes: string | null; customData: Record<string, any> }>> => {
      try {
        const rows = await this.inTenant(tenantId, async (tx) => {
          const filter = scope.leadId
            ? and(eq(leads.tenantId, tenantId), eq(leads.id, scope.leadId))
            : and(eq(leads.tenantId, tenantId), eq(leads.customerId, scope.customerId!), ne(leads.stage, 'LOST'));
          return tx.select({ id: leads.id, title: leads.title, notes: leads.notes, customData: leads.customData }).from(leads).where(filter).limit(10);
        });
        if (rows.length) return rows;
      } catch (err: any) {
        this.rethrowUnlessOffline(err);
      }
      return (globalMemoryLeads as any[])
        .filter((l) => l.tenantId === tenantId && (scope.leadId ? l.id === scope.leadId : l.customerId === scope.customerId && l.stage !== 'LOST'))
        .slice(0, 10)
        .map((l) => ({ id: l.id, title: l.title, notes: l.notes ?? null, customData: l.customData ?? {} }));
    };
    return { leads: await leadRows(), attachments };
  }

  async get(tenantId: string, id: string): Promise<AttachmentInfo & { data: Buffer }> {
    try {
      const found = await this.inTenant(tenantId, async (tx) => {
        const [row] = await tx
          .select({ ...INFO_COLUMNS, data: leadAttachments.data })
          .from(leadAttachments)
          .where(and(eq(leadAttachments.tenantId, tenantId), eq(leadAttachments.id, id)))
          .limit(1);
        return row ? { ...infoOf(row), data: row.data as Buffer } : null;
      });
      if (found) return found;
    } catch (err: any) {
      this.rethrowUnlessOffline(err);
    }
    const m = memoryAttachments.find((a) => a.tenantId === tenantId && a.id === id);
    if (!m) throw new NotFoundException('Attachment not found.');
    return { ...infoOf(m), data: m.data };
  }

  async remove(tenantId: string, id: string): Promise<{ removed: true }> {
    try {
      const done = await this.inTenant(tenantId, async (tx) => {
        const gone = await tx
          .delete(leadAttachments)
          .where(and(eq(leadAttachments.tenantId, tenantId), eq(leadAttachments.id, id)))
          .returning({ id: leadAttachments.id });
        return gone.length > 0;
      });
      if (done) return { removed: true };
    } catch (err: any) {
      this.rethrowUnlessOffline(err);
    }
    const i = memoryAttachments.findIndex((a) => a.tenantId === tenantId && a.id === id);
    if (i < 0) throw new NotFoundException('Attachment not found.');
    memoryAttachments.splice(i, 1);
    return { removed: true };
  }
}
