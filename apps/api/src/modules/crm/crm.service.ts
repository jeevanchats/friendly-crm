import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { sql, eq, and, or, ilike, desc } from 'drizzle-orm';
import { db, customers, leads, tasks, activities, tenants } from '@friendly-crm/db';
import {
  IntakeLeadDto,
  UpdateLeadStageDto,
  CreateCrmTaskDto,
  LeadFilterQueryDto,
  getIndustryTemplate,
  validateCustomData,
  isIndustryKey,
  IndustryKey,
} from '@friendly-crm/shared';
import { tenantContextStorage } from '../../common/interceptors/tenant-rls.interceptor';
import { randomUUID } from 'crypto';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryLeads,
  globalMemoryTasks,
  globalMemoryActivities,
} from './memory-store';

/** Does this enquiry still need a quote? Only enquiries at the start of the pipeline do. */
const needsQuote = (stage?: string | null): boolean => !stage || stage === 'NEW' || stage === 'QUALIFIED';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  // In-memory fallback repository for local offline development & tests
  private memoryTenants = globalMemoryTenants;
  private memoryCustomers = globalMemoryCustomers;
  private memoryLeads = globalMemoryLeads;
  private memoryTasks = globalMemoryTasks;

  /**
   * Normalizes Indian mobile numbers to E.164 (+91XXXXXXXXXX)
   */
  public normalizePhone(rawPhone: string): string {
    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    if (digits.length > 10 && rawPhone.startsWith('+')) return `+${digits}`;
    if (digits.length >= 10) return `+${digits}`;
    throw new BadRequestException('Invalid phone number format. Enter a valid 10-digit mobile number.');
  }

  /**
   * Helper to retrieve active database transaction from TenantRlsInterceptor or default db client
   */
  private getDb() {
    const store = tenantContextStorage.getStore();
    return store?.tx || db;
  }

  /**
   * Resolve active industry for a tenant
   */
  async resolveTenantIndustry(tenantId: string, headerOverride?: string): Promise<IndustryKey> {
    if (headerOverride && isIndustryKey(headerOverride)) {
      return headerOverride.toLowerCase() as IndustryKey;
    }

    try {
      const activeDb = this.getDb();
      const [tenant] = await activeDb
        .select({ industryKey: tenants.industryKey })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (tenant?.industryKey) {
        return tenant.industryKey as IndustryKey;
      }
    } catch {
      // Postgres offline fallback
    }

    const memTenant = this.memoryTenants.get(tenantId);
    return memTenant?.industryKey || 'printing';
  }

  /**
   * 1. POST /api/crm/intake-lead
   * Atomic Lead Intake:
   * - Validates customData against tenant's active industry template in industry-templates.json
   * - Enforces RLS tenant context
   * - Matches or creates Customer by normalized phone
   * - Creates Lead with validated industry customData
   * - Schedules Follow-up Task
   * - Logs immutable Activity
   */
  async intakeLead(
    tenantId: string,
    arg2: any,
    arg3?: any,
    arg4?: any
  ) {
    let dto: any;
    let industryOverride: string | undefined;
    let effectiveActorId: string;

    if (typeof arg2 === 'string') {
      // Called as: intakeLead(tenantId, actorId, industryKey, dto)
      effectiveActorId = arg2;
      industryOverride = arg3;
      dto = { ...(arg4 || {}) };
    } else {
      // Called as: intakeLead(tenantId, dto, industryOverride, actorId)
      dto = { ...(arg2 || {}) };
      industryOverride = arg3;
      effectiveActorId = arg4 || randomUUID();
    }

    const customerName = (dto.name || dto.customerName || 'Walk-in Customer').trim();
    dto.name = customerName;

    const normalizedPhone = this.normalizePhone(dto.phone);
    const industryKey = await this.resolveTenantIndustry(tenantId, industryOverride);
    const template = getIndustryTemplate(industryKey);

    // Validate customData against tenant's active industry template in industry-templates.json
    try {
      validateCustomData(industryKey, 'LEAD', dto.customData);
    } catch (err: any) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'IndustryCustomDataValidationFailed',
        message: err.message,
        industry: industryKey,
        industryName: template.name,
      });
    }

    const leadTitle = dto.title?.trim() || `Inquiry from ${customerName}${dto.companyName ? ` (${dto.companyName.trim()})` : ''}`;

    try {
      const activeDb = this.getDb();

      // Execute within transaction enforcing RLS
      if (typeof activeDb?.transaction === 'function') {
        return await activeDb.transaction(async (tx: any) => {
          // Enforce Row-Level Security for this transaction
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          // Match existing customer or create a new profile
          let [customer] = await tx
            .select()
            .from(customers)
            .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, normalizedPhone)))
            .limit(1);

          let isNewCustomer = false;
          if (!customer) {
            isNewCustomer = true;
            [customer] = await tx
              .insert(customers)
              .values({
                tenantId,
                name: customerName,
                companyName: dto.companyName?.trim() || null,
                phone: normalizedPhone,
                whatsappNumber: dto.whatsappNumber ? this.normalizePhone(dto.whatsappNumber) : normalizedPhone,
                email: dto.email || null,
                createdById: effectiveActorId,
              })
              .returning();
          }

          // Create the Lead
          const [lead] = await tx
            .insert(leads)
            .values({
              tenantId,
              customerId: customer.id,
              title: leadTitle,
              source: dto.source,
              stage: dto.stage || 'NEW',
              priority: dto.priority || 'MEDIUM',
              estimatedValue: dto.estimatedValue ? dto.estimatedValue.toString() : null,
              notes: dto.notes || null,
              assignedToId: dto.assignedToId || effectiveActorId,
              customData: dto.customData || {},
            })
            .returning();

          // The first job for a new enquiry is to send the customer a quote (due as set, or within 4 hours).
          // An enquiry that arrives already past that stage just gets an ordinary follow-up.
          const wantsQuote = needsQuote(lead.stage);
          let dueDate: Date;
          if (dto.followUpDueAt) {
            const parsed = new Date(dto.followUpDueAt);
            if (isNaN(parsed.getTime())) {
              throw new BadRequestException('Invalid followUpDueAt date format');
            }
            dueDate = parsed;
          } else {
            dueDate = new Date(Date.now() + (wantsQuote ? 4 : 24) * 60 * 60 * 1000);
          }
          const [followUpTask] = await tx
            .insert(tasks)
            .values({
              tenantId,
              customerId: customer.id,
              leadId: lead.id,
              type: wantsQuote ? 'SEND_QUOTE' : 'FOLLOW_UP_CALL',
              title: (wantsQuote ? `Send quote to ${customer.name}: ${leadTitle}` : `Follow up with ${customer.name} (${leadTitle})`).slice(0, 200),
              dueAt: dueDate,
              assignedToId: effectiveActorId,
            })
            .returning();

          // Write Immutable Activity
          await tx.insert(activities).values({
            tenantId,
            actorId: effectiveActorId,
            entityType: 'LEAD',
            entityId: lead.id,
            action: 'LEAD_INTAKE_COMPLETED',
            metadata: {
              isNewCustomer,
              source: dto.source,
              customerId: customer.id,
              followUpTaskId: followUpTask.id,
              industryKey,
            },
          });

          return {
            success: true,
            customer,
            lead,
            followUpTask,
            isNewCustomer,
            industry: industryKey,
          };
        });
      }
    } catch (dbErr: any) {
      if (dbErr instanceof BadRequestException || dbErr instanceof NotFoundException || dbErr instanceof ForbiddenException) {
        throw dbErr;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback: ${dbErr.message}`);
    }

      // Memory Fallback
      let customer = this.memoryCustomers.find(
        (c) => c.tenantId === tenantId && c.phone === normalizedPhone
      );
      let isNewCustomer = false;

      if (!customer) {
        isNewCustomer = true;
        customer = {
          id: randomUUID(),
          tenantId,
          name: customerName,
          companyName: dto.companyName?.trim() || null,
          phone: normalizedPhone,
          whatsappNumber: dto.whatsappNumber ? this.normalizePhone(dto.whatsappNumber) : normalizedPhone,
          email: dto.email || null,
          openingBalance: '0.00',
          creditLimit: '100000.00',
          activeOrdersCount: 0,
          totalReceivable: '0.00',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        this.memoryCustomers.unshift(customer);
      }

      const lead = {
        id: randomUUID(),
        tenantId,
        customerId: customer.id,
        title: leadTitle,
        source: dto.source,
        stage: dto.stage || 'NEW',
        priority: dto.priority || 'MEDIUM',
        estimatedValue: dto.estimatedValue ? dto.estimatedValue.toString() : null,
        notes: dto.notes || null,
        assignedToId: dto.assignedToId || effectiveActorId,
        customData: dto.customData || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.memoryLeads.unshift(lead);

      const wantsQuote = needsQuote(lead.stage);
      let dueDate: Date;
      if (dto.followUpDueAt) {
        const parsed = new Date(dto.followUpDueAt);
        if (isNaN(parsed.getTime())) {
          throw new BadRequestException('Invalid followUpDueAt date format');
        }
        dueDate = parsed;
      } else {
        dueDate = new Date(Date.now() + (wantsQuote ? 4 : 24) * 60 * 60 * 1000);
      }

      const followUpTask = {
        id: randomUUID(),
        tenantId,
        customerId: customer.id,
        leadId: lead.id,
        type: wantsQuote ? 'SEND_QUOTE' : 'FOLLOW_UP_CALL',
        title: (wantsQuote ? `Send quote to ${customer.name}: ${leadTitle}` : `Follow up with ${customer.name} (${leadTitle})`).slice(0, 200),
        dueAt: dueDate,
        status: 'PENDING',
        assignedToId: effectiveActorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.memoryTasks.unshift(followUpTask);

      return {
        success: true,
        customer,
        lead,
        followUpTask,
        isNewCustomer,
        industry: industryKey,
      };
    }

  /**
   * 2. GET /api/crm/leads
   * Query leads for tenant with joined customer profiles and filter criteria
   */
  async getLeads(tenantId: string, filter: LeadFilterQueryDto) {
    try {
      const activeDb = this.getDb();
      const conditions: any[] = [eq(leads.tenantId, tenantId)];

      if (filter.stage) {
        conditions.push(eq(leads.stage, filter.stage.toUpperCase() as any));
      }
      if (filter.priority) {
        conditions.push(eq(leads.priority, filter.priority as any));
      }
      if (filter.source) {
        conditions.push(eq(leads.source, filter.source as any));
      }
      if (filter.search && filter.search.trim()) {
        const searchTerm = `%${filter.search.trim()}%`;
        conditions.push(
          or(
            ilike(leads.title, searchTerm),
            ilike(leads.notes, searchTerm),
            ilike(customers.name, searchTerm),
            ilike(customers.phone, searchTerm)
          )
        );
      }

      const whereClause = and(...conditions);

      // True total count of matching records for pagination
      const [countResult] = await activeDb
        .select({ total: sql<number>`count(*)::int` })
        .from(leads)
        .innerJoin(customers, eq(leads.customerId, customers.id))
        .where(whereClause);

      const totalCount = countResult?.total ?? 0;

      const rows = await activeDb
        .select({
          id: leads.id,
          tenantId: leads.tenantId,
          title: leads.title,
          source: leads.source,
          stage: leads.stage,
          priority: leads.priority,
          estimatedValue: leads.estimatedValue,
          notes: leads.notes,
          customData: leads.customData,
          createdAt: leads.createdAt,
          updatedAt: leads.updatedAt,
          customerId: customers.id,
          customerName: customers.name,
          customerPhone: customers.phone,
          customerCompanyName: customers.companyName,
          whatsappNumber: customers.whatsappNumber,
        })
        .from(leads)
        .innerJoin(customers, eq(leads.customerId, customers.id))
        .where(whereClause)
        .orderBy(desc(leads.createdAt))
        .limit(filter.limit || 50)
        .offset(filter.offset || 0);

      return {
        data: rows,
        total: totalCount,
      };
    } catch {
      // Memory Fallback
      let filtered = this.memoryLeads.filter((l) => l.tenantId === tenantId);

      if (filter.stage) {
        filtered = filtered.filter((l) => l.stage.toUpperCase() === filter.stage?.toUpperCase());
      }
      if (filter.priority) {
        filtered = filtered.filter((l) => l.priority === filter.priority);
      }
      if (filter.source) {
        filtered = filtered.filter((l) => l.source === filter.source);
      }
      if (filter.search && filter.search.trim()) {
        const s = filter.search.toLowerCase().trim();
        filtered = filtered.filter((l) => {
          const cust = this.memoryCustomers.find((c) => c.id === l.customerId);
          return (
            l.title.toLowerCase().includes(s) ||
            l.notes?.toLowerCase().includes(s) ||
            cust?.name.toLowerCase().includes(s) ||
            cust?.phone.includes(s)
          );
        });
      }

      const totalCount = filtered.length;
      const offset = filter.offset || 0;
      const limit = filter.limit || 50;
      const paginated = filtered.slice(offset, offset + limit);

      const rows = paginated.map((lead) => {
        const cust = this.memoryCustomers.find((c) => c.id === lead.customerId);
        return {
          ...lead,
          customerName: cust?.name || 'Walk-in Customer',
          customerPhone: cust?.phone || '',
          customerCompanyName: cust?.companyName || null,
          whatsappNumber: cust?.whatsappNumber || cust?.phone || '',
        };
      });

      return {
        data: rows,
        total: totalCount,
      };
    }
  }

  /**
   * 3. PATCH /api/crm/leads/:id/stage
   * Advance or transition lead stage
   */
  async updateLeadStage(tenantId: string, leadId: string, dto: UpdateLeadStageDto, actorId?: string) {
    try {
      const activeDb = this.getDb();

      const [existingLead] = await activeDb
        .select()
        .from(leads)
        .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
        .limit(1);

      if (!existingLead) {
        throw new NotFoundException(`Lead with id '${leadId}' not found`);
      }

      const fromStage = existingLead.stage;

      // Once the enquiry is lost or won, nobody should still be reminded to send it a quote
      if (dto.stage === 'LOST' || dto.stage === 'WON') {
        await activeDb
          .update(tasks)
          .set({ status: 'CANCELLED', updatedAt: new Date() })
          .where(and(eq(tasks.tenantId, tenantId), eq(tasks.leadId, leadId), eq(tasks.type, 'SEND_QUOTE'), eq(tasks.status, 'PENDING')));
      }

      const [updatedLead] = await activeDb
        .update(leads)
        .set({
          stage: dto.stage,
          notes: dto.notes ? `${existingLead.notes || ''}\n[Stage Update]: ${dto.notes}`.trim() : existingLead.notes,
          updatedAt: new Date(),
        })
        .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
        .returning();

      // Record stage transition in activities
      await activeDb.insert(activities).values({
        tenantId,
        actorId: actorId || null,
        entityType: 'LEAD',
        entityId: leadId,
        action: 'STAGE_CHANGED',
        metadata: {
          fromStage,
          toStage: dto.stage,
          notes: dto.notes,
        },
      });

      return {
        success: true,
        lead: updatedLead,
        fromStage,
        toStage: dto.stage,
      };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;

      // Memory Fallback
      const lead = this.memoryLeads.find((l) => l.id === leadId && l.tenantId === tenantId);
      if (!lead) {
        throw new NotFoundException(`Lead with id '${leadId}' not found`);
      }

      const fromStage = lead.stage;
      lead.stage = dto.stage;
      if (dto.stage === 'LOST' || dto.stage === 'WON') {
        for (const t of this.memoryTasks) {
          if (t.tenantId === tenantId && t.leadId === leadId && t.type === 'SEND_QUOTE' && t.status === 'PENDING') t.status = 'CANCELLED';
        }
      }
      if (dto.notes) {
        lead.notes = `${lead.notes || ''}\n[Stage Update]: ${dto.notes}`.trim();
      }
      lead.updatedAt = new Date();

      return {
        success: true,
        lead,
        fromStage,
        toStage: dto.stage,
      };
    }
  }

  /**
   * 4. POST /api/crm/tasks
   * Create CRM follow-up task
   */
  async createTask(tenantId: string, dto: CreateCrmTaskDto, actorId?: string) {
    try {
      const activeDb = this.getDb();

      const [newTask] = await activeDb
        .insert(tasks)
        .values({
          tenantId,
          title: dto.title,
          type: dto.type,
          dueAt: new Date(dto.dueAt),
          leadId: dto.leadId || null,
          customerId: dto.customerId || null,
          assignedToId: dto.assignedToId || actorId || randomUUID(),
          outcomeNote: dto.outcomeNote || null,
          status: 'PENDING',
        })
        .returning();

      return {
        success: true,
        task: newTask,
      };
    } catch {
      // Memory Fallback
      const newTask = {
        id: randomUUID(),
        tenantId,
        title: dto.title,
        type: dto.type,
        dueAt: new Date(dto.dueAt),
        leadId: dto.leadId || null,
        customerId: dto.customerId || null,
        assignedToId: dto.assignedToId || actorId || null,
        outcomeNote: dto.outcomeNote || null,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.memoryTasks.unshift(newTask);

      return {
        success: true,
        task: newTask,
      };
    }
  }
}
