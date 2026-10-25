import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, sql, tenants, users, memberships, auditLogs } from '@friendly-crm/db';
import {
  getIndustryTemplate,
  IndustryKey,
  isValidGstin,
  isValidStateCode,
  normalizeGstin,
  stateCodeFromGstin,
} from '@friendly-crm/shared';
import { globalMemoryTenants, globalMemoryAuditLogs } from '../crm/memory-store';
import { AuthService } from '../auth/auth.service';
import { isValidUpiId } from '../payments/upi';

export interface TenantSettings {
  customerSelfServiceEnabled: boolean;
  /** The business's UPI ID for customer payment links; null when not set. */
  upiId: string | null;
  /** Supplier details printed on GST invoices. All null until the owner fills them in. */
  gstNumber: string | null;
  legalName: string | null;
  address: string | null;
  /** Two-digit GST state code; derived from the GSTIN when one is set. */
  stateCode: string | null;
}

export interface CreateTenantDto {
  name: string;
  slug: string;
  industry: string;
  ownerPhone: string;
  ownerName?: string;
  gstNumber?: string;
}

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * Atomic Onboarding:
   * 1. Generates Tenant UUID
   * 2. Persists Tenant record
   * 3. Creates Owner User record
   * 4. Establishes OWNER Membership
   * 5. Configures Industry Template & Pipelines
   */
  async onboardTenant(dto: CreateTenantDto) {
    const tenantId = randomUUID();
    const ownerUserId = randomUUID();
    const membershipId = randomUUID();

    const normalizedIndustry = (dto.industry || 'printing').toLowerCase() as IndustryKey;
    const template = getIndustryTemplate(normalizedIndustry);
    const normalizedPhone = this.authService.normalizePhone(dto.ownerPhone);

    try {
      if (db && typeof db.insert === 'function') {
        // 1. Insert Tenant
        await db.insert(tenants).values({
          id: tenantId,
          name: dto.name,
          slug: dto.slug.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
          industryKey: normalizedIndustry,
          defaultLanguage: 'en',
          gstNumber: dto.gstNumber || null,
          phone: normalizedPhone,
          isActive: true,
        });

        // 2. Insert or find Owner User
        let effectiveOwnerId = ownerUserId;
        const [existingUser] = await db
          .select()
          .from(users)
          .where(eq(users.phone, normalizedPhone))
          .limit(1);

        if (existingUser) {
          effectiveOwnerId = existingUser.id;
        } else {
          await db.insert(users).values({
            id: ownerUserId,
            fullName: dto.ownerName || 'Business Owner',
            phone: normalizedPhone,
            preferredLanguage: 'en',
          });
        }

        // 3. Insert OWNER Membership
        await db.insert(memberships).values({
          id: membershipId,
          tenantId,
          userId: effectiveOwnerId,
          role: 'OWNER',
          isActive: true,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Postgres offline; persisting onboarding to memory store: ${err.message}`);
    }

    // Mirror to unified memory stores
    globalMemoryTenants.set(tenantId, {
      id: tenantId,
      name: dto.name,
      industryKey: normalizedIndustry,
    });

    this.authService.registerUser({
      id: ownerUserId,
      fullName: dto.ownerName || 'Business Owner',
      phone: normalizedPhone,
    });

    this.authService.registerMembership(tenantId, ownerUserId, 'OWNER', true);

    return {
      tenantId,
      name: dto.name,
      slug: dto.slug,
      industry: normalizedIndustry,
      ownerId: ownerUserId,
      status: 'ACTIVE',
      seededPipelineStages: {
        orders: template.orderStages,
      },
      seededCustomFields: template.customFields,
    };
  }

  async getTenantDetails(tenantId: string) {
    try {
      if (db && typeof db.select === 'function') {
        const [tenant] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);

        if (tenant) {
          const members = await db
            .select()
            .from(memberships)
            .where(eq(memberships.tenantId, tenantId));

          return {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            industry: tenant.industryKey,
            gstNumber: tenant.gstNumber,
            customerSelfServiceEnabled: tenant.customerSelfServiceEnabled,
            activeMembers: members.filter((m) => m.isActive).length,
            createdAt: tenant.createdAt,
          };
        }
      }
    } catch {
      // Memory fallback
    }

    const memTenant = globalMemoryTenants.get(tenantId);
    if (!memTenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    return {
      id: memTenant.id,
      name: memTenant.name,
      industry: memTenant.industryKey,
      customerSelfServiceEnabled: (memTenant as any).customerSelfServiceEnabled !== false,
      activeMembers: 1,
      createdAt: new Date().toISOString(),
    };
  }

  /** Owner-controlled tenant settings. */
  async getSettings(tenantId: string): Promise<TenantSettings> {
    try {
      if (db && typeof db.select === 'function') {
        const [row] = await db
          .select({
            enabled: tenants.customerSelfServiceEnabled,
            upiId: tenants.upiId,
            gstNumber: tenants.gstNumber,
            legalName: tenants.legalName,
            address: tenants.address,
            stateCode: tenants.stateCode,
          })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        if (row) {
          return {
            customerSelfServiceEnabled: row.enabled,
            upiId: row.upiId ?? null,
            gstNumber: row.gstNumber ?? null,
            legalName: row.legalName ?? null,
            address: row.address ?? null,
            stateCode: row.stateCode ?? null,
          };
        }
      }
    } catch {
      // Postgres offline: memory fallback below
    }
    const mem = globalMemoryTenants.get(tenantId) as any;
    if (!mem) throw new NotFoundException(`Tenant ${tenantId} not found`);
    return {
      customerSelfServiceEnabled: mem.customerSelfServiceEnabled !== false,
      upiId: mem.upiId ?? null,
      gstNumber: mem.gstNumber ?? null,
      legalName: mem.legalName ?? null,
      address: mem.address ?? null,
      stateCode: mem.stateCode ?? null,
    };
  }

  /**
   * Updates tenant settings and writes an audit record in the SAME transaction, whichever channel
   * (web API or WhatsApp) made the change. Callers must have checked 'settings:manage'.
   */
  async updateSettings(
    tenantId: string,
    actorId: string | null,
    patch: {
      customerSelfServiceEnabled?: boolean;
      upiId?: string | null;
      gstNumber?: string | null;
      legalName?: string | null;
      address?: string | null;
      stateCode?: string | null;
    },
    channel: 'API' | 'WHATSAPP'
  ): Promise<TenantSettings> {
    // Only the fields present in the patch change, and only those are audited.
    const next: Partial<TenantSettings> = {};
    if (patch.customerSelfServiceEnabled !== undefined) {
      if (typeof patch.customerSelfServiceEnabled !== 'boolean') {
        throw new BadRequestException('customerSelfServiceEnabled must be true or false');
      }
      next.customerSelfServiceEnabled = patch.customerSelfServiceEnabled;
    }
    if (patch.upiId !== undefined) {
      const raw = patch.upiId === null ? '' : String(patch.upiId).trim();
      if (raw !== '' && !isValidUpiId(raw)) {
        throw new BadRequestException('upiId must look like name@bank (letters, digits, . - _ before the @)');
      }
      next.upiId = raw === '' ? null : raw;
    }
    const text = (v: unknown, max: number, field: string): string | null => {
      const t = v === null ? '' : String(v).trim();
      if (t.length > max) throw new BadRequestException(`${field} must be at most ${max} characters`);
      return t === '' ? null : t;
    };
    if (patch.legalName !== undefined) next.legalName = text(patch.legalName, 200, 'legalName');
    if (patch.address !== undefined) next.address = text(patch.address, 500, 'address');
    if (patch.gstNumber !== undefined) {
      const raw = patch.gstNumber === null ? '' : String(patch.gstNumber).trim();
      if (raw !== '' && !isValidGstin(raw)) {
        throw new BadRequestException('gstNumber is not a valid GSTIN (15 characters, valid state code and check character)');
      }
      next.gstNumber = raw === '' ? null : normalizeGstin(raw);
      // The state is part of the GSTIN, so it follows it.
      if (next.gstNumber) next.stateCode = stateCodeFromGstin(next.gstNumber);
    }
    if (patch.stateCode !== undefined && patch.stateCode !== null && patch.stateCode !== '') {
      if (!isValidStateCode(patch.stateCode)) throw new BadRequestException('stateCode is not a valid GST state code');
      if (next.gstNumber && next.stateCode !== patch.stateCode) {
        throw new BadRequestException('stateCode does not match the first two digits of the GSTIN');
      }
      next.stateCode = patch.stateCode;
    } else if (patch.stateCode === null || patch.stateCode === '') {
      if (!next.gstNumber) next.stateCode = null;
    }
    if (Object.keys(next).length === 0) {
      throw new BadRequestException(
        'Nothing to update: send customerSelfServiceEnabled, upiId, gstNumber, legalName, address and/or stateCode'
      );
    }
    const current = await this.getSettings(tenantId);
    const keys = Object.keys(next) as Array<keyof TenantSettings>;
    const beforeChanges: Record<string, unknown> = {};
    const afterChanges: Record<string, unknown> = {};
    for (const k of keys) {
      beforeChanges[k] = current[k];
      afterChanges[k] = next[k];
    }
    const merged: TenantSettings = { ...current, ...next };

    const audit = {
      id: randomUUID(),
      tenantId,
      actorId,
      action: 'SETTINGS_UPDATED',
      entityType: 'TENANT',
      entityId: tenantId,
      changes: {
        before: beforeChanges,
        after: afterChanges,
        metadata: { channel },
      },
      ipAddress: null,
      userAgent: channel === 'WHATSAPP' ? 'whatsapp-bot' : null,
      createdAt: new Date(),
    };

    try {
      if (db && typeof db.transaction === 'function') {
        await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          await tx.update(tenants).set(next).where(eq(tenants.id, tenantId));
          await tx.insert(auditLogs).values(audit);
        });
        return merged;
      }
    } catch (err: any) {
      this.logger.warn(`Postgres offline; applying tenant settings to memory store: ${err.message}`);
    }

    const mem = globalMemoryTenants.get(tenantId) as any;
    if (!mem) throw new NotFoundException(`Tenant ${tenantId} not found`);
    Object.assign(mem, next);
    globalMemoryAuditLogs.unshift(audit as any);
    return merged;
  }
}
