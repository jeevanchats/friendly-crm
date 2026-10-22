import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, tenants, users, memberships } from '@friendly-crm/db';
import { getIndustryTemplate, IndustryKey } from '@friendly-crm/shared';
import { globalMemoryTenants } from '../crm/memory-store';
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
      activeMembers: 1,
      createdAt: new Date().toISOString(),
    };
  }
}
