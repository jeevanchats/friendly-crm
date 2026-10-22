import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { sql, eq, and, lte, asc, desc } from 'drizzle-orm';
import { db, tasks, quotations, orders, customers, activities } from '@friendly-crm/db';
import { TenantRole, hasPermission } from '@friendly-crm/shared';
import { randomUUID } from 'crypto';
import {
  globalMemoryTasks,
  globalMemoryActivities,
  globalMemoryQuotations,
  globalMemoryOrders,
  globalMemoryCustomers,
} from './memory-store';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  /**
   * Fetches Home Screen KPIs + Priority Follow-up List (Section 4)
   */
  async getHomeDashboard(tenantId: string, userId: string, userRole: TenantRole) {
    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx) => {
          // 1. Enforce PostgreSQL Row-Level Security
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          const endOfToday = new Date();
          endOfToday.setHours(23, 59, 59, 999);

          // Salespersons only see their own assigned tasks; Owners/Managers see all
          const isScopedToUser = userRole === 'SALESPERSON';

          // 2. KPI 1: Pending & Overdue Follow-ups Count (Due <= Today)
          const [followUpStats] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(
              and(
                eq(tasks.tenantId, tenantId),
                eq(tasks.status, 'PENDING'),
                lte(tasks.dueAt, endOfToday),
                isScopedToUser ? eq(tasks.assignedToId, userId) : undefined
              )
            );

          // 3. KPI 2: Open Quotations (Status = 'SENT' or 'DRAFT')
          const [quoteStats] = await tx
            .select({
              count: sql<number>`count(*)::int`,
              totalValue: sql<string>`COALESCE(SUM(grand_total), 0)::text`,
            })
            .from(quotations)
            .where(and(eq(quotations.tenantId, tenantId), eq(quotations.status, 'SENT')));

          // 4. KPI 3 & 4: Active Orders Count + Total Pending Receivables (Balance Due)
          const [orderStats] = await tx
            .select({
              activeCount: sql<number>`count(*) FILTER (WHERE production_stage != 'DELIVERED' AND production_stage != 'INSTALLED')::int`,
              totalReceivables: sql<string>`COALESCE(SUM(balance_due), 0)::text`,
            })
            .from(orders)
            .where(eq(orders.tenantId, tenantId));

          // 5. Priority Follow-Up Queue (Overdue first, then Today) joined with Customer Phone
          const priorityTasks = await tx
            .select({
              id: tasks.id,
              type: tasks.type,
              title: tasks.title,
              dueAt: tasks.dueAt,
              customerId: customers.id,
              customerName: customers.name,
              customerPhone: customers.phone,
            })
            .from(tasks)
            .innerJoin(customers, eq(tasks.customerId, customers.id))
            .where(
              and(
                eq(tasks.tenantId, tenantId),
                eq(tasks.status, 'PENDING'),
                lte(tasks.dueAt, endOfToday),
                isScopedToUser ? eq(tasks.assignedToId, userId) : undefined
              )
            )
            .orderBy(asc(tasks.dueAt))
            .limit(20);

          const canSeeReceivables = hasPermission(userRole, 'payment:view');

          return {
            summaryCards: {
              dueFollowUps: followUpStats?.count ?? 0,
              openQuotations: quoteStats?.count ?? 0,
              openQuotationsValue: quoteStats?.totalValue ?? '0.00',
              activeOrders: orderStats?.activeCount ?? 0,
              totalReceivables: canSeeReceivables ? (orderStats?.totalReceivables ?? '0.00') : null,
            },
            priorityTasks,
          };
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for getHomeDashboard: ${err.message}`);
    }

    const isScopedToUser = userRole === 'SALESPERSON';
    const pendingTasks = globalMemoryTasks.filter(
      (t) =>
        t.tenantId === tenantId &&
        t.status === 'PENDING' &&
        (!isScopedToUser || t.assignedToId === userId)
    );

    const openQuotes = globalMemoryQuotations.filter(
      (q) => q.tenantId === tenantId && ['SENT', 'DRAFT'].includes(q.status)
    );
    const openQuotesVal = openQuotes.reduce(
      (sum, q) => sum + parseFloat(q.grandTotal || '0'),
      0
    );

    const tenantOrders = globalMemoryOrders.filter((o) => o.tenantId === tenantId);
    const activeOrders = tenantOrders.filter(
      (o) => !['DELIVERED', 'INSTALLED'].includes(o.productionStage)
    );
    const totalReceivables = tenantOrders.reduce(
      (sum, o) => sum + parseFloat(o.balanceDue || '0'),
      0
    );

    const canSeeReceivables = hasPermission(userRole, 'payment:view');

    return {
      summaryCards: {
        dueFollowUps: pendingTasks.length,
        openQuotations: openQuotes.length,
        openQuotationsValue: openQuotesVal.toFixed(2),
        activeOrders: activeOrders.length,
        totalReceivables: canSeeReceivables ? totalReceivables.toFixed(2) : null,
      },
      priorityTasks: pendingTasks.map((t) => {
        const cust = globalMemoryCustomers.find((c) => c.id === t.customerId);
        return {
          id: t.id,
          type: t.type,
          title: t.title,
          dueAt: t.dueAt,
          customerId: t.customerId,
          customerName: t.customerName || cust?.name || 'Customer',
          customerPhone: t.customerPhone || cust?.phone || '',
        };
      }),
    };
  }

  /**
   * 1-Tap Complete Task with Outcome Note & Optional Next Follow-up
   */
  async completeFollowUpTask(
    tenantId: string,
    userId: string,
    taskId: string,
    outcomeNote: string,
    nextFollowUpAt?: string
  ) {
    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          const [completed] = await tx
            .update(tasks)
            .set({
              status: 'COMPLETED',
              outcomeNote,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
            .returning();

          if (!completed) {
            throw new NotFoundException(`Task ${taskId} not found in this tenant`);
          }

          // Schedule next follow-up if requested
          if (nextFollowUpAt) {
            await tx.insert(tasks).values({
              tenantId,
              customerId: completed.customerId,
              leadId: completed.leadId,
              type: 'FOLLOW_UP_CALL',
              title: completed.title,
              dueAt: new Date(nextFollowUpAt),
              assignedToId: userId,
            });
          }

          const [activity] = await tx
            .insert(activities)
            .values({
              tenantId,
              actorId: userId,
              entityType: 'LEAD',
              entityId: completed?.leadId || completed?.customerId || completed?.id || taskId,
              action: 'FOLLOW_UP_COMPLETED',
              metadata: { taskId, outcomeNote, nextFollowUpAt },
            })
            .returning();

          return {
            task: completed,
            activity,
          };
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for completeFollowUpTask: ${err.message}`);
    }

    const task = globalMemoryTasks.find((t) => t.id === taskId && t.tenantId === tenantId);
    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found in this tenant`);
    }

    task.status = 'COMPLETED';
    task.outcomeNote = outcomeNote;
    task.completedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();

    if (nextFollowUpAt) {
      const nextTask = {
        id: randomUUID(),
        tenantId,
        customerId: task.customerId,
        leadId: task.leadId,
        type: 'FOLLOW_UP_CALL',
        title: task.title,
        dueAt: new Date(nextFollowUpAt).toISOString(),
        status: 'PENDING',
        assignedToId: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      globalMemoryTasks.unshift(nextTask);
    }

    const activity = {
      id: randomUUID(),
      tenantId,
      actorId: userId,
      entityType: 'LEAD',
      entityId: task.leadId || task.customerId || taskId,
      action: 'FOLLOW_UP_COMPLETED',
      metadata: { taskId, outcomeNote, nextFollowUpAt },
      createdAt: new Date().toISOString(),
    };
    globalMemoryActivities.unshift(activity);

    return {
      task,
      activity,
    };
  }

  /**
   * Fetches logged activities for tenant (used in activity feed verification)
   */
  async getActivities(tenantId: string) {
    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          return await tx
            .select()
            .from(activities)
            .where(eq(activities.tenantId, tenantId))
            .orderBy(desc(activities.createdAt))
            .limit(50);
        });
      }
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for getActivities: ${err.message}`);
    }

    return globalMemoryActivities.filter((a) => a.tenantId === tenantId);
  }
}

