import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, asc, eq, or, sql as dsql } from 'drizzle-orm';
import { db, sql, products } from '@friendly-crm/db';
import { CleanProduct, validateProductRow } from '@friendly-crm/shared';
import { globalMemoryProducts } from '../crm/memory-store';

export const MAX_PRODUCT_IMPORT_ROWS = 1000;

export interface ProductView {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  hsnCode: string | null;
  unit: string;
  unitPrice: string;
  taxPercent: string;
  isActive: boolean;
}

export type ProductImportStatus = 'create' | 'update' | 'skip' | 'error';

export interface ProductImportRow {
  /** 1-based position among the data rows (not counting the header). */
  row: number;
  name: string;
  status: ProductImportStatus;
  messages: string[];
}

export interface ProductImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: ProductImportRow[];
}

const money = (paise: number) => (paise / 100).toFixed(2);
const pct = (n: number) => n.toFixed(2);
const toView = (p: any): ProductView => ({
  id: p.id,
  name: p.name,
  code: p.code ?? null,
  description: p.description ?? null,
  hsnCode: p.hsnCode ?? null,
  unit: p.unit,
  unitPrice: String(p.unitPrice),
  taxPercent: String(p.taxPercent),
  isActive: p.isActive !== false,
});

/** Product / service master: what a business sells, with the defaults that fill a quotation line. */
@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  // ---------------------------------------------------------------- reads

  async list(tenantId: string, opts: { search?: string; includeArchived?: boolean; limit?: number } = {}): Promise<{ data: ProductView[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const needle = (opts.search ?? '').trim().toLowerCase();
    const rows = await this.withStore(tenantId, async (tx) => {
      if (tx) {
        const conds: any[] = [eq(products.tenantId, tenantId)];
        if (!opts.includeArchived) conds.push(eq(products.isActive, true));
        if (needle) {
          const like = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
          conds.push(or(dsql`lower(${products.name}) like ${like}`, dsql`lower(coalesce(${products.code}, '')) like ${like}`, dsql`lower(coalesce(${products.hsnCode}, '')) like ${like}`));
        }
        return tx.select().from(products).where(and(...conds)).orderBy(asc(dsql`lower(${products.name})`)).limit(limit + 1);
      }
      return globalMemoryProducts
        .filter(
          (p) =>
            p.tenantId === tenantId &&
            (opts.includeArchived || p.isActive !== false) &&
            (!needle || [p.name, p.code, p.hsnCode].some((v) => String(v ?? '').toLowerCase().includes(needle)))
        )
        .sort((a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()))
        .slice(0, limit + 1);
    });
    return { data: rows.slice(0, limit).map(toView), total: rows.length > limit ? limit + 1 : rows.length };
  }

  // ---------------------------------------------------------------- writes

  async create(tenantId: string, actorId: string | null, raw: Record<string, unknown>): Promise<ProductView> {
    const clean = this.check(raw);
    return this.withStore(tenantId, async (tx) => {
      const clash = await this.findClashes(tx, tenantId, [clean]);
      if (clash.length > 0) throw this.clash(clean, clash[0]);
      const values = this.values(tenantId, actorId, clean);
      if (tx) {
        const [row] = await tx.insert(products).values(values).returning();
        return toView(row);
      }
      const mem = { id: randomUUID(), ...values, isActive: true, createdAt: new Date(), updatedAt: new Date() };
      globalMemoryProducts.push(mem);
      return toView(mem);
    });
  }

  /** Changes only the fields sent; the merged result is validated as a whole. */
  async update(tenantId: string, id: string, patch: Record<string, unknown>): Promise<ProductView> {
    return this.withStore(tenantId, async (tx) => {
      const current = await this.getRaw(tx, tenantId, id);
      if (!current) throw new NotFoundException('Product not found');
      const merged: Record<string, unknown> = {
        name: current.name,
        code: current.code,
        description: current.description,
        hsnCode: current.hsnCode,
        unit: current.unit,
        unitPrice: current.unitPrice,
        taxPercent: current.taxPercent,
      };
      for (const k of Object.keys(merged)) if (k in patch) merged[k] = patch[k];
      const clean = this.check(merged);
      const clash = (await this.findClashes(tx, tenantId, [clean])).filter((c) => c.id !== id);
      if (clash.length > 0) throw this.clash(clean, clash[0]);
      const set = { ...this.values(tenantId, null, clean), updatedAt: new Date() } as Record<string, unknown>;
      delete set.tenantId;
      delete set.createdById;
      if (typeof patch.isActive === 'boolean') set.isActive = patch.isActive;
      if (tx) {
        const [row] = await tx.update(products).set(set).where(and(eq(products.id, id), eq(products.tenantId, tenantId))).returning();
        return toView(row);
      }
      Object.assign(current, set);
      return toView(current);
    });
  }

  /** Archives (or restores) a product. Quotes and invoices already made keep their own copy of its details. */
  async setActive(tenantId: string, id: string, isActive: boolean): Promise<ProductView> {
    return this.withStore(tenantId, async (tx) => {
      if (tx) {
        const [row] = await tx
          .update(products)
          .set({ isActive, updatedAt: new Date() })
          .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
          .returning();
        if (!row) throw new NotFoundException('Product not found');
        return toView(row);
      }
      const mem = globalMemoryProducts.find((p) => p.id === id && p.tenantId === tenantId);
      if (!mem) throw new NotFoundException('Product not found');
      mem.isActive = isActive;
      return toView(mem);
    });
  }

  /**
   * Bulk-adds products from a parsed sheet. `dryRun` reports what would happen without writing. A row whose name
   * or code already belongs to a product is skipped, or with 'update' has its rate, GST, HSN, unit and description
   * refreshed. Rows with problems are reported and left out; they never stop the good rows.
   */
  async importProducts(
    tenantId: string,
    actorId: string | null,
    rawRows: unknown,
    opts: { dryRun: boolean; onDuplicate: 'skip' | 'update' }
  ): Promise<ProductImportResult> {
    if (!Array.isArray(rawRows) || rawRows.length === 0) throw new BadRequestException('Send at least one row to import');
    if (rawRows.length > MAX_PRODUCT_IMPORT_ROWS) {
      throw new BadRequestException(`Import at most ${MAX_PRODUCT_IMPORT_ROWS} products at a time (this file has ${rawRows.length}). Split it into parts.`);
    }

    type Planned = { result: ProductImportRow; clean?: CleanProduct; existingId?: string; warnings: string[]; supplied?: Set<string> };
    const planned: Planned[] = [];
    const seenName = new Map<string, number>();
    const seenCode = new Map<string, number>();
    rawRows.forEach((raw, i) => {
      const row = i + 1;
      const check = validateProductRow((raw && typeof raw === 'object' ? raw : {}) as any);
      const shownName = String((raw as any)?.name ?? '').trim();
      if (!check.ok || !check.value) {
        planned.push({ result: { row, name: shownName, status: 'error', messages: check.errors }, warnings: [] });
        return;
      }
      const c = check.value;
      const nk = c.name.toLowerCase();
      const ck = c.code ? c.code.toLowerCase() : null;
      const dupRow = seenName.get(nk) ?? (ck ? seenCode.get(ck) : undefined);
      if (dupRow !== undefined) {
        planned.push({ result: { row, name: c.name, status: 'error', messages: [`Same name or code as row ${dupRow}`] }, warnings: [] });
        return;
      }
      seenName.set(nk, row);
      if (ck) seenCode.set(ck, row);
      // Which optional columns this row actually filled in: a blank cell must never wipe an existing value.
      const supplied = new Set(
        (['description', 'hsnCode', 'unit', 'unitPrice', 'taxPercent'] as const).filter((k) => String((raw as any)?.[k] ?? '').trim() !== '')
      );
      planned.push({ result: { row, name: c.name, status: 'create', messages: [...check.warnings] }, clean: c, warnings: [...check.warnings], supplied });
    });

    const run = async (tx: any | null) => {
      const clean = planned.filter((p) => p.clean).map((p) => p.clean!);
      const clashes = await this.findClashes(tx, tenantId, clean);
      for (const p of planned) {
        if (!p.clean) continue;
        const hit = clashes.find((c) => c.name.toLowerCase() === p.clean!.name.toLowerCase() || (p.clean!.code && c.code && c.code.toLowerCase() === p.clean!.code.toLowerCase()));
        if (!hit) continue;
        p.existingId = hit.id;
        if (opts.onDuplicate === 'update') {
          p.result.status = 'update';
          p.result.messages.push(`Already a product (${hit.name}); the columns you filled in will be updated`);
        } else {
          p.result.status = 'skip';
          p.result.messages.push(`Already a product (${hit.name})`);
        }
      }
      if (opts.dryRun) return;
      const toCreate = planned.filter((p) => p.result.status === 'create' && p.clean);
      const toUpdate = planned.filter((p) => p.result.status === 'update' && p.clean && p.existingId);
      if (tx) {
        for (let i = 0; i < toCreate.length; i += 200) {
          await tx.insert(products).values(toCreate.slice(i, i + 200).map((p) => this.values(tenantId, actorId, p.clean!)));
        }
        for (const p of toUpdate) {
          await tx
            .update(products)
            .set({ ...this.suppliedValues(tenantId, actorId, p), isActive: true, updatedAt: new Date() })
            .where(and(eq(products.id, p.existingId!), eq(products.tenantId, tenantId)));
        }
      } else {
        for (const p of toCreate) {
          globalMemoryProducts.push({ id: randomUUID(), ...this.values(tenantId, actorId, p.clean!), isActive: true, createdAt: new Date(), updatedAt: new Date() });
        }
        for (const p of toUpdate) {
          const mem = globalMemoryProducts.find((x) => x.id === p.existingId);
          if (mem) Object.assign(mem, { ...this.suppliedValues(tenantId, actorId, p), isActive: true, updatedAt: new Date() });
        }
      }
    };

    try {
      await this.withStore(tenantId, async (tx) => {
        // A failed database attempt may already have marked rows as duplicates: always start the plan clean.
        for (const p of planned) {
          if (!p.clean) continue;
          p.result.status = 'create';
          p.result.messages = [...p.warnings];
          p.existingId = undefined;
        }
        await run(tx);
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException({ statusCode: 409, error: 'ProductExists', message: 'Another person added one of these products while you were importing. Nothing was imported; please try again.' });
      }
      throw err;
    }

    const rows = planned.map((p) => p.result);
    const count = (s: ProductImportStatus) => rows.filter((r) => r.status === s).length;
    return { dryRun: opts.dryRun, created: count('create'), updated: count('update'), skipped: count('skip'), errors: count('error'), rows };
  }

  // ---------------------------------------------------------------- helpers

  /** Used by the invoice screen: the HSN of the active product with this name, if the master has one. */
  async hsnForName(tenantId: string, name: string): Promise<string | null> {
    const found = await this.withStore(tenantId, async (tx) => {
      if (tx) {
        const [row] = await tx
          .select({ hsn: products.hsnCode })
          .from(products)
          .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true), dsql`lower(${products.name}) = lower(${name})`, dsql`${products.hsnCode} is not null`))
          .limit(1);
        return row?.hsn ?? null;
      }
      return globalMemoryProducts.find((p) => p.tenantId === tenantId && p.isActive !== false && p.hsnCode && String(p.name).toLowerCase() === name.toLowerCase())?.hsnCode ?? null;
    });
    return found;
  }

  private check(raw: Record<string, unknown>): CleanProduct {
    const check = validateProductRow(raw as any);
    if (!check.ok || !check.value) {
      throw new BadRequestException({ statusCode: 400, error: 'InvalidProduct', message: check.errors.join('. '), errors: check.errors });
    }
    return check.value;
  }

  private values(tenantId: string, actorId: string | null, c: CleanProduct) {
    return {
      tenantId,
      name: c.name,
      code: c.code,
      description: c.description,
      hsnCode: c.hsnCode,
      unit: c.unit,
      unitPrice: money(c.unitPricePaise),
      taxPercent: pct(c.taxPercent),
      createdById: actorId,
    };
  }

  /** Only the columns the sheet row filled in, so a blank cell leaves the existing value alone. */
  private suppliedValues(tenantId: string, actorId: string | null, p: { clean?: CleanProduct; supplied?: Set<string> }) {
    const v = this.values(tenantId, actorId, p.clean!);
    const set: Record<string, unknown> = {};
    for (const k of ['description', 'hsnCode', 'unit', 'unitPrice', 'taxPercent'] as const) if (p.supplied?.has(k)) set[k] = v[k];
    return set;
  }

  private clash(c: CleanProduct, existing: any) {
    const byCode = c.code && existing.code && existing.code.toLowerCase() === c.code.toLowerCase() && existing.name.toLowerCase() !== c.name.toLowerCase();
    return new ConflictException({
      statusCode: 409,
      error: 'ProductExists',
      message: byCode ? `Code ${c.code} is already used by ${existing.name}.` : `${existing.name} is already a product.`,
      productId: existing.id,
    });
  }

  private async getRaw(tx: any | null, tenantId: string, id: string): Promise<any | undefined> {
    if (tx) {
      const [row] = await tx.select().from(products).where(and(eq(products.id, id), eq(products.tenantId, tenantId))).limit(1);
      return row;
    }
    return globalMemoryProducts.find((p) => p.id === id && p.tenantId === tenantId);
  }

  /** Existing products (active or archived) that share a name or code with any of `list`. */
  private async findClashes(tx: any | null, tenantId: string, list: CleanProduct[]): Promise<any[]> {
    if (list.length === 0) return [];
    const names = [...new Set(list.map((c) => c.name.toLowerCase()))];
    const codes = [...new Set(list.map((c) => c.code?.toLowerCase()).filter((c): c is string => !!c))];
    if (tx) {
      const out = new Map<string, any>();
      for (let i = 0; i < names.length; i += 400) {
        const chunk = names.slice(i, i + 400);
        const rows = await tx
          .select()
          .from(products)
          .where(and(eq(products.tenantId, tenantId), dsql`lower(${products.name}) in (${dsql.join(chunk.map((n) => dsql`${n}`), dsql`, `)})`));
        for (const r of rows) out.set(r.id, r);
      }
      for (let i = 0; i < codes.length; i += 400) {
        const chunk = codes.slice(i, i + 400);
        const rows = await tx
          .select()
          .from(products)
          .where(and(eq(products.tenantId, tenantId), dsql`lower(${products.code}) in (${dsql.join(chunk.map((n) => dsql`${n}`), dsql`, `)})`));
        for (const r of rows) out.set(r.id, r);
      }
      return [...out.values()];
    }
    return globalMemoryProducts.filter(
      (p) => p.tenantId === tenantId && (names.includes(String(p.name).toLowerCase()) || (p.code && codes.includes(String(p.code).toLowerCase())))
    );
  }

  /** Same pattern as invoices: a tenant-scoped transaction, or memory only when there is no database (never in production). */
  private async withStore<T>(tenantId: string, fn: (tx: any | null) => Promise<T>): Promise<T> {
    if (db && typeof db.transaction === 'function') {
      try {
        return await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          return fn(tx);
        });
      } catch (err: any) {
        if (err instanceof HttpException || err?.code === '23505') throw err;
        if (process.env.NODE_ENV === 'production') {
          this.logger.error(`Product storage failed: ${err.message}`);
          throw new ServiceUnavailableException('Products are temporarily unavailable. Please try again.');
        }
        this.logger.warn(`Postgres offline; using the in-memory product store: ${err.message}`);
      }
    }
    return fn(null);
  }
}
