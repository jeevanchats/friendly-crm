import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, sql, users, memberships, auditLogs } from '@friendly-crm/db';
import { TenantRole, normalizeContactPhone } from '@friendly-crm/shared';
import { AuthService } from '../auth/auth.service';
import { globalMemoryAuditLogs } from '../crm/memory-store';

/** Roles an owner can hand out. Ownership itself is not transferable from here. */
export const ASSIGNABLE_ROLES: TenantRole[] = ['MANAGER', 'SALESPERSON', 'ACCOUNTS', 'PRODUCTION', 'READ_ONLY'];

export interface TeamMember {
  userId: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: TenantRole;
  isActive: boolean;
}

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(private readonly auth: AuthService) {}

  private audit(tenantId: string, actorId: string, action: string, userId: string, before: object, after: object) {
    return {
      id: randomUUID(),
      tenantId,
      actorId,
      action,
      entityType: 'MEMBERSHIP',
      entityId: userId,
      changes: { before, after, metadata: { channel: 'API' } },
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
    };
  }

  private async inTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T | undefined> {
    if (!db || typeof db.transaction !== 'function') return undefined;
    try {
      return await db.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
        return fn(tx);
      });
    } catch (err: any) {
      if (err?.getStatus) throw err; // a deliberate 4xx from fn, not a database outage
      this.logger.warn(`Postgres offline; using the in-memory team: ${err.message}`);
      return undefined;
    }
  }

  async list(tenantId: string): Promise<{ data: TeamMember[] }> {
    const rows = await this.inTenant<TeamMember[]>(tenantId, (tx) =>
      tx
        .select({
          userId: users.id,
          fullName: users.fullName,
          phone: users.phone,
          email: users.email,
          role: memberships.role,
          isActive: memberships.isActive,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(eq(memberships.tenantId, tenantId))
    );
    // A real business always has its owner, so an empty answer means this business is not in Postgres (tests, offline).
    const data: TeamMember[] =
      (rows?.length ? rows : null) ??
      this.auth.listMemoryTeam(tenantId).map(({ membership, user }) => ({
        userId: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        role: membership.role,
        isActive: membership.isActive,
      }));
    const order = ['OWNER', ...ASSIGNABLE_ROLES];
    data.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.fullName.localeCompare(b.fullName));
    return { data };
  }

  async add(tenantId: string, actorId: string, dto: { fullName: string; phone: string; role: TenantRole }): Promise<TeamMember> {
    const fullName = dto.fullName?.trim();
    if (!fullName || fullName.length < 2 || fullName.length > 120) throw new BadRequestException('Enter the staff member\'s name.');
    const phone = normalizeContactPhone(dto.phone ?? '');
    if (!phone) throw new BadRequestException('Enter a valid 10-digit mobile number.');
    if (!ASSIGNABLE_ROLES.includes(dto.role)) {
      throw new BadRequestException(`Role must be one of ${ASSIGNABLE_ROLES.join(', ')}.`);
    }

    const done = await this.inTenant(tenantId, async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.phone, phone)).limit(1);
      if (!user) [user] = await tx.insert(users).values({ fullName, phone }).returning();
      const [existing] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, user.id)))
        .limit(1);
      if (existing?.isActive) throw new ConflictException('This number is already on your team.');
      if (existing?.role === 'OWNER') throw new ConflictException('This number belongs to an owner of the business.');
      if (existing) {
        await tx.update(memberships).set({ role: dto.role, isActive: true }).where(eq(memberships.id, existing.id));
      } else {
        await tx.insert(memberships).values({ tenantId, userId: user.id, role: dto.role, isActive: true });
      }
      await tx.insert(auditLogs).values(
        this.audit(tenantId, actorId, 'TEAM_MEMBER_ADDED', user.id, existing ? { role: existing.role, isActive: false } : {}, { role: dto.role, isActive: true, phone })
      );
      return { userId: user.id, fullName: user.fullName, phone: user.phone, email: user.email ?? null, role: dto.role, isActive: true } as TeamMember;
    });
    if (done) return done;

    const known = this.auth.findMemoryUserByPhone(phone);
    const userId = known?.id ?? randomUUID();
    if (!known) this.auth.registerUser({ id: userId, fullName, phone });
    const prior = this.auth.listMemoryTeam(tenantId).find((r) => r.user.id === userId)?.membership;
    if (prior?.isActive) throw new ConflictException('This number is already on your team.');
    if (prior?.role === 'OWNER') throw new ConflictException('This number belongs to an owner of the business.');
    this.auth.registerMembership(tenantId, userId, dto.role, true);
    globalMemoryAuditLogs.unshift(this.audit(tenantId, actorId, 'TEAM_MEMBER_ADDED', userId, {}, { role: dto.role, isActive: true, phone }) as any);
    return { userId, fullName: known?.fullName ?? fullName, phone, email: known?.email ?? null, role: dto.role, isActive: true };
  }

  async update(
    tenantId: string,
    actorId: string,
    userId: string,
    patch: { role?: TenantRole; isActive?: boolean }
  ): Promise<{ userId: string; role: TenantRole; isActive: boolean }> {
    if (patch.role === undefined && patch.isActive === undefined) throw new BadRequestException('Send a role and/or isActive.');
    if (patch.role !== undefined && !ASSIGNABLE_ROLES.includes(patch.role)) {
      throw new BadRequestException(`Role must be one of ${ASSIGNABLE_ROLES.join(', ')}.`);
    }
    if (patch.isActive !== undefined && typeof patch.isActive !== 'boolean') throw new BadRequestException('isActive must be true or false.');
    if (userId === actorId) throw new ForbiddenException('You cannot change your own role or access.');

    const guard = (current: { role: string; isActive: boolean } | undefined) => {
      if (!current) throw new NotFoundException('That person is not on your team.');
      if (current.role === 'OWNER') throw new ForbiddenException('An owner\'s role and access cannot be changed here.');
    };
    const next = (current: { role: string; isActive: boolean }) => ({
      role: (patch.role ?? current.role) as TenantRole,
      isActive: patch.isActive ?? current.isActive,
    });

    const done = await this.inTenant(tenantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
        .limit(1);
      if (!current) return null; // not in Postgres: fall through to the in-memory team
      guard(current);
      const after = next(current);
      await tx.update(memberships).set(after).where(eq(memberships.id, current.id));
      await tx
        .insert(auditLogs)
        .values(this.audit(tenantId, actorId, 'TEAM_MEMBER_UPDATED', userId, { role: current.role, isActive: current.isActive }, after));
      return { userId, ...after };
    });
    if (done) return done;

    const current = this.auth.listMemoryTeam(tenantId).find((r) => r.user.id === userId)?.membership;
    guard(current);
    const after = next(current!);
    this.auth.updateMemoryMembership(tenantId, userId, after);
    globalMemoryAuditLogs.unshift(
      this.audit(tenantId, actorId, 'TEAM_MEMBER_UPDATED', userId, { role: current!.role, isActive: current!.isActive }, after) as any
    );
    return { userId, ...after };
  }
}
