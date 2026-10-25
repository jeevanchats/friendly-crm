import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import { db, sql, invoices, ewayBills } from '@friendly-crm/db';
import {
  EWAY_BILL_FILE_TYPES,
  MAX_EWAY_BILLS_PER_INVOICE,
  MAX_FILE_BYTES,
  baseMimeType,
  normalizeEwayBillNumber,
  normalizeVehicleNumber,
  parseIsoDate,
  sanitizeFileName,
} from '@friendly-crm/shared';
import { globalMemoryInvoices, globalMemoryEwayBills } from '../crm/memory-store';

export interface EwayBillInput {
  ewbNumber?: unknown;
  generatedOn?: unknown;
  validUntil?: unknown;
  vehicleNumber?: unknown;
}

export interface UploadedEwayFile {
  originalname?: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

export interface EwayBillView {
  id: string;
  invoiceId: string;
  ewbNumber: string;
  generatedOn: string | null;
  validUntil: string | null;
  vehicleNumber: string | null;
  hasFile: boolean;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

const VIEW_COLUMNS = {
  id: ewayBills.id,
  invoiceId: ewayBills.invoiceId,
  ewbNumber: ewayBills.ewbNumber,
  generatedOn: ewayBills.generatedOn,
  validUntil: ewayBills.validUntil,
  vehicleNumber: ewayBills.vehicleNumber,
  fileName: ewayBills.fileName,
  mimeType: ewayBills.mimeType,
  sizeBytes: ewayBills.sizeBytes,
  hasFile: dsql<boolean>`${ewayBills.data} is not null`,
  createdAt: ewayBills.createdAt,
};

const toView = (r: any): EwayBillView => ({
  id: r.id,
  invoiceId: r.invoiceId,
  ewbNumber: r.ewbNumber,
  generatedOn: r.generatedOn ? String(r.generatedOn).slice(0, 10) : null,
  validUntil: r.validUntil ? String(r.validUntil).slice(0, 10) : null,
  vehicleNumber: r.vehicleNumber ?? null,
  hasFile: !!r.hasFile,
  fileName: r.fileName ?? null,
  mimeType: r.mimeType ?? null,
  sizeBytes: r.sizeBytes ?? null,
  createdAt: new Date(r.createdAt).toISOString(),
});

/**
 * E-way bills that staff generated on the government portal, recorded against the invoice they belong to with the
 * PDF they downloaded. Nothing here calls the government.
 */
@Injectable()
export class EwayBillsService {
  private readonly logger = new Logger(EwayBillsService.name);

  private async inTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return db.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
  }

  /** Real validation errors reach the caller; only a database that cannot be reached falls back to memory. */
  private rethrowUnlessOffline(err: any): void {
    if (err instanceof HttpException) throw err;
    if (process.env.NODE_ENV === 'production') throw err;
    this.logger.warn(`Postgres offline; using memory for e-way bills: ${err?.message}`);
  }

  private parse(input: EwayBillInput, file: UploadedEwayFile | undefined) {
    const ewbNumber = normalizeEwayBillNumber(input?.ewbNumber);
    if (!ewbNumber) throw new BadRequestException('The e-way bill number is the 12 digits shown on the government portal.');

    const blank = (v: unknown) => v === undefined || v === null || v === '';
    const generatedOn = blank(input.generatedOn) ? null : parseIsoDate(input.generatedOn);
    if (!blank(input.generatedOn) && !generatedOn) throw new BadRequestException('Generated-on must be a date (yyyy-mm-dd).');
    const validUntil = blank(input.validUntil) ? null : parseIsoDate(input.validUntil);
    if (!blank(input.validUntil) && !validUntil) throw new BadRequestException('Valid-until must be a date (yyyy-mm-dd).');
    if (generatedOn && validUntil && validUntil < generatedOn) throw new BadRequestException('Valid-until cannot be before the date it was generated.');

    const vehicleNumber = blank(input.vehicleNumber) ? null : normalizeVehicleNumber(input.vehicleNumber);
    if (!blank(input.vehicleNumber) && !vehicleNumber) throw new BadRequestException('The vehicle number looks wrong. Example: TN38AB1234.');

    let fileFields: { fileName: string; mimeType: string; sizeBytes: number; data: Buffer } | null = null;
    if (file && file.buffer && file.size > 0) {
      const mime = baseMimeType(file.mimetype);
      if (!EWAY_BILL_FILE_TYPES.includes(mime)) throw new BadRequestException('Upload the e-way bill as a PDF or a photo (JPG, PNG).');
      if (file.size > MAX_FILE_BYTES) throw new BadRequestException('The file is too large (10 MB at most).');
      fileFields = { fileName: sanitizeFileName(file.originalname, `eway-bill-${ewbNumber}`), mimeType: mime, sizeBytes: file.size, data: file.buffer };
    }
    return { ewbNumber, generatedOn, validUntil, vehicleNumber, file: fileFields };
  }

  async add(tenantId: string, userId: string | null, invoiceId: string, input: EwayBillInput, file?: UploadedEwayFile): Promise<EwayBillView> {
    const p = this.parse(input, file);
    const duplicate = () =>
      new ConflictException({ statusCode: 409, error: 'EwayBillExists', message: `E-way bill ${p.ewbNumber} is already recorded.` });

    try {
      const saved = await this.inTenant(tenantId, async (tx) => {
        const [inv] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
        if (!inv) return null; // maybe a memory-only invoice (offline development); the fallback below decides
        const [{ n }] = await tx
          .select({ n: dsql<number>`count(*)::int` })
          .from(ewayBills)
          .where(and(eq(ewayBills.tenantId, tenantId), eq(ewayBills.invoiceId, invoiceId)));
        if (n >= MAX_EWAY_BILLS_PER_INVOICE) throw new BadRequestException(`An invoice can have at most ${MAX_EWAY_BILLS_PER_INVOICE} e-way bills.`);
        try {
          const [row] = await tx
            .insert(ewayBills)
            .values({
              tenantId,
              invoiceId,
              ewbNumber: p.ewbNumber,
              generatedOn: p.generatedOn,
              validUntil: p.validUntil,
              vehicleNumber: p.vehicleNumber,
              fileName: p.file?.fileName ?? null,
              mimeType: p.file?.mimeType ?? null,
              sizeBytes: p.file?.sizeBytes ?? null,
              data: p.file?.data ?? null,
              uploadedById: userId,
            })
            .returning({ ...VIEW_COLUMNS, hasFile: dsql<boolean>`true` });
          return { ...row, hasFile: !!p.file };
        } catch (err: any) {
          if (err?.code === '23505') throw duplicate();
          throw err;
        }
      });
      if (saved) return toView(saved);
    } catch (err: any) {
      this.rethrowUnlessOffline(err);
    }

    // Memory fallback
    if (!globalMemoryInvoices.some((i) => i.id === invoiceId && i.tenantId === tenantId)) throw new NotFoundException('Invoice not found.');
    if (globalMemoryEwayBills.some((b) => b.tenantId === tenantId && b.ewbNumber === p.ewbNumber)) throw duplicate();
    if (globalMemoryEwayBills.filter((b) => b.tenantId === tenantId && b.invoiceId === invoiceId).length >= MAX_EWAY_BILLS_PER_INVOICE) {
      throw new BadRequestException(`An invoice can have at most ${MAX_EWAY_BILLS_PER_INVOICE} e-way bills.`);
    }
    const row = {
      id: randomUUID(), tenantId, invoiceId, ewbNumber: p.ewbNumber, generatedOn: p.generatedOn, validUntil: p.validUntil, vehicleNumber: p.vehicleNumber,
      fileName: p.file?.fileName ?? null, mimeType: p.file?.mimeType ?? null, sizeBytes: p.file?.sizeBytes ?? null, data: p.file?.data ?? null,
      hasFile: !!p.file, createdAt: new Date(),
    };
    globalMemoryEwayBills.unshift(row);
    return toView(row);
  }

  async list(tenantId: string, invoiceId: string): Promise<EwayBillView[]> {
    try {
      const rows = await this.inTenant(tenantId, async (tx) => {
        const [inv] = await tx.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
        if (!inv) return null;
        return tx.select(VIEW_COLUMNS).from(ewayBills).where(and(eq(ewayBills.tenantId, tenantId), eq(ewayBills.invoiceId, invoiceId))).orderBy(desc(ewayBills.createdAt));
      });
      if (rows) return rows.map(toView);
    } catch (err: any) {
      this.rethrowUnlessOffline(err);
    }
    if (!globalMemoryInvoices.some((i) => i.id === invoiceId && i.tenantId === tenantId)) throw new NotFoundException('Invoice not found.');
    return globalMemoryEwayBills.filter((b) => b.tenantId === tenantId && b.invoiceId === invoiceId).map(toView);
  }

  async getFile(tenantId: string, id: string): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
    try {
      const found = await this.inTenant(tenantId, async (tx) => {
        const [r] = await tx
          .select({ fileName: ewayBills.fileName, mimeType: ewayBills.mimeType, data: ewayBills.data })
          .from(ewayBills)
          .where(and(eq(ewayBills.tenantId, tenantId), eq(ewayBills.id, id)))
          .limit(1);
        return r ?? null;
      });
      if (found) {
        if (!found.data) throw new NotFoundException('No file was uploaded with this e-way bill.');
        return { fileName: found.fileName ?? 'eway-bill', mimeType: found.mimeType ?? 'application/octet-stream', data: found.data };
      }
    } catch (err: any) {
      this.rethrowUnlessOffline(err);
    }
    const m = globalMemoryEwayBills.find((b) => b.tenantId === tenantId && b.id === id);
    if (!m) throw new NotFoundException('E-way bill not found.');
    if (!m.data) throw new NotFoundException('No file was uploaded with this e-way bill.');
    return { fileName: m.fileName, mimeType: m.mimeType, data: m.data };
  }

  async remove(tenantId: string, id: string): Promise<{ removed: true }> {
    try {
      const done = await this.inTenant(tenantId, async (tx) => {
        const gone = await tx.delete(ewayBills).where(and(eq(ewayBills.tenantId, tenantId), eq(ewayBills.id, id))).returning({ id: ewayBills.id });
        return gone.length > 0;
      });
      if (done) return { removed: true };
    } catch (err: any) {
      this.rethrowUnlessOffline(err);
    }
    const i = globalMemoryEwayBills.findIndex((b) => b.tenantId === tenantId && b.id === id);
    if (i < 0) throw new NotFoundException('E-way bill not found.');
    globalMemoryEwayBills.splice(i, 1);
    return { removed: true };
  }
}
