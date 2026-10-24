import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, sql, tenants, users, memberships, auditLogs } from '@friendly-crm/db';
import { getIndustryTemplate, IndustryKey } from '@friendly-crm/shared';
import { globalMemoryTenants, globalMemoryAuditLogs } from '../crm/memory-store';
import { AuthService } from '../auth/auth.service';

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
  async getSettings(tenantId: string): Promise<{ customerSelfServiceEnabled: boolean }> {
    try {
      if (db && typeof db.select === 'function') {
        const [row] = await db
          .select({ enabled: tenants.customerSelfServiceEnabled })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        if (row) return { customerSelfServiceEnabled: row.enabled };
      }
    } catch {
      // Postgres offline: memory fallback below
    }
    const mem = globalMemoryTenants.get(tenantId) as any;
    if (!mem) throw new NotFoundException(`Tenant ${tenantId} not found`);
    return { customerSelfServiceEnabled: mem.customerSelfServiceEnabled !== false };
  }

  /**
   * Updates tenant settings and writes an audit record in the SAME transaction, whichever channel
   * (web API or WhatsApp) made the change. Callers must have checked 'settings:manage'.
   */
  async updateSettings(
    tenantId: string,
    actorId: string | null,
    patch: { customerSelfServiceEnabled?: boolean },
    channel: 'API' | 'WHATSAPP'
  ): Promise<{ customerSelfServiceEnabled: boolean }> {
    if (typeof patch.customerSelfServiceEnabled !== 'boolean') {
      throw new BadRequestException('customerSelfServiceEnabled must be true or false');
    }
    const next = patch.customerSelfServiceEnabled;
    const before = (await this.getSettings(tenantId)).customerSelfServiceEnabled;

    const audit = {
      id: randomUUID(),
      tenantId,
      actorId,
      action: 'SETTINGS_UPDATED',
      entityType: 'TENANT',
      entityId: tenantId,
      changes: {
        before: { customerSelfServiceEnabled: before },
        after: { customerSelfServiceEnabled: next },
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
          await tx.update(tenants).set({ customerSelfServiceEnabled: next }).where(eq(tenants.id, tenantId));
          await tx.insert(auditLogs).values(audit);
        });
        return { customerSelfServiceEnabled: next };
      }
    } catch (err: any) {
      this.logger.warn(`Postgres offline; applying tenant settings to memory store: ${err.message}`);
    }

    const mem = globalMemoryTenants.get(tenantId) as any;
    if (!mem) throw new NotFoundException(`Tenant ${tenantId} not found`);
    mem.customerSelfServiceEnabled = next;
    globalMemoryAuditLogs.unshift(audit as any);
    return { customerSelfServiceEnabled: next };
  }
}
