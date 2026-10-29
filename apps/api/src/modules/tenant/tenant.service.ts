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
import { PaymentDetails, completeBank, normalizeAccountNumber, normalizeIfsc } from '@friendly-crm/shared';
import { onDbError } from '../../common/utils/db-fallback.util';

export interface TenantSettings {
  customerSelfServiceEnabled: boolean;
  /** The business's UPI ID for customer payment links; null when not set. */
  upiId: string | null;
  /** The bank account customers can pay into. All null until the owner fills it in; usable only when name, number and IFSC are all set. */
  bankAccountName: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
  /** Supplier details printed on GST invoices. All null until the owner fills them in. */
  gstNumber: string | null;
  legalName: string | null;
  address: string | null;
  /** Two-digit GST state code; derived from the GSTIN when one is set. */
  stateCode: string | null;
  /** Automatic payment reminders. Off until the owner turns them on. */
  autoRemindersEnabled: boolean;
  /** First reminder once the oldest unpaid order is this many days old. */
  reminderAfterDays: number;
  /** Then repeat every this many days. */
  reminderRepeatDays: number;
  /** At most this many automatic reminders per customer for one outstanding debt. */
  reminderMaxCount: number;
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

    // The business, its owner and the owner's membership are saved together or not at all. `memberships` is
    // row-level-secured by business, so the new business id is set for the transaction first; without that a
    // restricted database role would refuse the membership and leave a business that nobody can sign in to.
    let effectiveOwnerId = ownerUserId;
    try {
      if (db && typeof db.transaction === 'function') {
        effectiveOwnerId = await db.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          await tx.insert(tenants).values({
            id: tenantId,
            name: dto.name,
            slug: dto.slug.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
            industryKey: normalizedIndustry,
            defaultLanguage: 'en',
            gstNumber: dto.gstNumber || null,
            phone: normalizedPhone,
            isActive: true,
          });

          let ownerId = ownerUserId;
          const [existingUser] = await tx.select().from(users).where(eq(users.phone, normalizedPhone)).limit(1);
          if (existingUser) {
            ownerId = existingUser.id;
          } else {
            await tx.insert(users).values({
              id: ownerUserId,
              fullName: dto.ownerName || 'Business Owner',
              phone: normalizedPhone,
              preferredLanguage: 'en',
            });
          }

          await tx.insert(memberships).values({
            id: membershipId,
            tenantId,
            userId: ownerId,
            role: 'OWNER',
            isActive: true,
          });
          return ownerId;
        });
      }
    } catch (err: any) {
      // A real database answer (for example a web address that is already taken) is reported, not hidden.
      if (err?.code === '23505') {
        throw new ConflictException('A business with this web address (slug) already exists. Choose another.');
      }
      if (typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) {
        this.logger.error(`Onboarding failed in Postgres (${err.code}): ${err.message}`);
        throw new BadRequestException('The business could not be created. Check the details and try again.');
      }
      onDbError(this.logger, 'persisting onboarding to memory store', err);
    }

    // Mirror to unified memory stores
    globalMemoryTenants.set(tenantId, {
      id: tenantId,
      name: dto.name,
      industryKey: normalizedIndustry,
    });

    this.authService.registerUser({
      id: effectiveOwnerId,
      fullName: dto.ownerName || 'Business Owner',
      phone: normalizedPhone,
    });

    this.authService.registerMembership(tenantId, effectiveOwnerId, 'OWNER', true);

    return {
      tenantId,
      name: dto.name,
      slug: dto.slug,
      industry: normalizedIndustry,
      ownerId: effectiveOwnerId,
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
    } catch (err: any) {
      onDbError(this.logger, 'reading business settings', err);
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

  /**
   * What a customer is shown to pay: the bank account (when complete) and the UPI ID. Never throws for a business
   * that has not set them: both are then null.
   */
  async getPaymentDetails(tenantId: string): Promise<PaymentDetails & { payeeName: string }> {
    const s = await this.getSettings(tenantId);
    const name = ((await this.getTenantName(tenantId)) ?? '').trim();
    return {
      upiId: s.upiId && isValidUpiId(s.upiId) ? s.upiId : null,
      bank: completeBank({ accountName: s.bankAccountName, bankName: s.bankName, accountNumber: s.bankAccountNumber, ifsc: s.bankIfsc, branch: s.bankBranch }),
      payeeName: (s.legalName ?? '').trim() || name,
    };
  }

  private async getTenantName(tenantId: string): Promise<string | null> {
    try {
      if (db && typeof db.select === 'function') {
        const [row] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        if (row) return row.name;
      }
    } catch (err: any) {
      onDbError(this.logger, 'reading the business name', err);
    }
    return (globalMemoryTenants.get(tenantId) as any)?.name ?? null;
  }

  /** Owner-controlled tenant settings. */
  async getSettings(tenantId: string): Promise<TenantSettings> {
    try {
      if (db && typeof db.select === 'function') {
        const [row] = await db
          .select({
            enabled: tenants.customerSelfServiceEnabled,
            upiId: tenants.upiId,
            bankAccountName: tenants.bankAccountName,
            bankName: tenants.bankName,
            bankAccountNumber: tenants.bankAccountNumber,
            bankIfsc: tenants.bankIfsc,
            bankBranch: tenants.bankBranch,
            gstNumber: tenants.gstNumber,
            legalName: tenants.legalName,
            address: tenants.address,
            stateCode: tenants.stateCode,
            autoRemindersEnabled: tenants.autoRemindersEnabled,
            reminderAfterDays: tenants.reminderAfterDays,
            reminderRepeatDays: tenants.reminderRepeatDays,
            reminderMaxCount: tenants.reminderMaxCount,
          })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        if (row) {
          return {
            customerSelfServiceEnabled: row.enabled,
            upiId: row.upiId ?? null,
            bankAccountName: row.bankAccountName ?? null,
            bankName: row.bankName ?? null,
            bankAccountNumber: row.bankAccountNumber ?? null,
            bankIfsc: row.bankIfsc ?? null,
            bankBranch: row.bankBranch ?? null,
            gstNumber: row.gstNumber ?? null,
            legalName: row.legalName ?? null,
            address: row.address ?? null,
            stateCode: row.stateCode ?? null,
            autoRemindersEnabled: row.autoRemindersEnabled,
            reminderAfterDays: row.reminderAfterDays,
            reminderRepeatDays: row.reminderRepeatDays,
            reminderMaxCount: row.reminderMaxCount,
          };
        }
      }
    } catch (err: any) {
      onDbError(this.logger, 'reading business details', err);
    }
    const mem = globalMemoryTenants.get(tenantId) as any;
    if (!mem) throw new NotFoundException(`Tenant ${tenantId} not found`);
    return {
      customerSelfServiceEnabled: mem.customerSelfServiceEnabled !== false,
      upiId: mem.upiId ?? null,
      bankAccountName: mem.bankAccountName ?? null,
      bankName: mem.bankName ?? null,
      bankAccountNumber: mem.bankAccountNumber ?? null,
      bankIfsc: mem.bankIfsc ?? null,
      bankBranch: mem.bankBranch ?? null,
      gstNumber: mem.gstNumber ?? null,
      legalName: mem.legalName ?? null,
      address: mem.address ?? null,
      stateCode: mem.stateCode ?? null,
      autoRemindersEnabled: mem.autoRemindersEnabled === true,
      reminderAfterDays: mem.reminderAfterDays ?? 7,
      reminderRepeatDays: mem.reminderRepeatDays ?? 7,
      reminderMaxCount: mem.reminderMaxCount ?? 3,
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
      bankAccountName?: string | null;
      bankName?: string | null;
      bankAccountNumber?: string | null;
      bankIfsc?: string | null;
      bankBranch?: string | null;
      gstNumber?: string | null;
      legalName?: string | null;
      address?: string | null;
      stateCode?: string | null;
      autoRemindersEnabled?: boolean;
      reminderAfterDays?: number;
      reminderRepeatDays?: number;
      reminderMaxCount?: number;
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
    if (patch.bankAccountName !== undefined) next.bankAccountName = text(patch.bankAccountName, 160, 'bankAccountName');
    if (patch.bankName !== undefined) next.bankName = text(patch.bankName, 120, 'bankName');
    if (patch.bankBranch !== undefined) next.bankBranch = text(patch.bankBranch, 120, 'bankBranch');
    if (patch.bankAccountNumber !== undefined) {
      const raw = patch.bankAccountNumber === null ? '' : String(patch.bankAccountNumber).trim();
      if (raw !== '' && !normalizeAccountNumber(raw)) throw new BadRequestException('bankAccountNumber must be 9 to 18 digits');
      next.bankAccountNumber = raw === '' ? null : normalizeAccountNumber(raw);
    }
    if (patch.bankIfsc !== undefined) {
      const raw = patch.bankIfsc === null ? '' : String(patch.bankIfsc).trim();
      if (raw !== '' && !normalizeIfsc(raw)) throw new BadRequestException('bankIfsc must look like HDFC0001234 (4 letters, a zero, then 6 letters or digits)');
      next.bankIfsc = raw === '' ? null : normalizeIfsc(raw);
    }
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
    if (patch.autoRemindersEnabled !== undefined) {
      if (typeof patch.autoRemindersEnabled !== 'boolean') {
        throw new BadRequestException('autoRemindersEnabled must be true or false');
      }
      next.autoRemindersEnabled = patch.autoRemindersEnabled;
    }
    const whole = (v: unknown, min: number, max: number, field: string): number => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
        throw new BadRequestException(`${field} must be a whole number from ${min} to ${max}`);
      }
      return v;
    };
    if (patch.reminderAfterDays !== undefined) next.reminderAfterDays = whole(patch.reminderAfterDays, 1, 90, 'reminderAfterDays');
    if (patch.reminderRepeatDays !== undefined) next.reminderRepeatDays = whole(patch.reminderRepeatDays, 1, 60, 'reminderRepeatDays');
    if (patch.reminderMaxCount !== undefined) next.reminderMaxCount = whole(patch.reminderMaxCount, 1, 10, 'reminderMaxCount');
    if (Object.keys(next).length === 0) {
      throw new BadRequestException(
        'Nothing to update: send customerSelfServiceEnabled, upiId, bank details, gstNumber, legalName, address, stateCode and/or the reminder settings'
      );
    }
    const current = await this.getSettings(tenantId);
    // A bank account is shown to customers, so it must be whole: name, account number and IFSC together, or none.
    const after = { ...current, ...next };
    const anyBank = !!(after.bankAccountName || after.bankAccountNumber || after.bankIfsc);
    if (anyBank && !completeBank({ accountName: after.bankAccountName, bankName: after.bankName, accountNumber: after.bankAccountNumber, ifsc: after.bankIfsc })) {
      throw new BadRequestException('Bank details need the account name, account number and IFSC together. Fill in all three, or clear them.');
    }
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
      onDbError(this.logger, 'applying tenant settings to memory store', err);
    }

    const mem = globalMemoryTenants.get(tenantId) as any;
    if (!mem) throw new NotFoundException(`Tenant ${tenantId} not found`);
    Object.assign(mem, next);
    globalMemoryAuditLogs.unshift(audit as any);
    return merged;
  }
}
