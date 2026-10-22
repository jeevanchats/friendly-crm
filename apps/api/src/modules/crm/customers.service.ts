import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { sql, eq, and, or, inArray, desc } from 'drizzle-orm';
import {
  db,
  customers,
  leads,
  quotations,
  orders,
  payments,
  tasks,
  activities,
} from '@friendly-crm/db';
import { TenantRole, hasPermission } from '@friendly-crm/shared';
import { filterAndSanitizeActivities } from '../../common';
import {
  globalMemoryCustomers,
  globalMemoryOrders,
  globalMemoryQuotations,
  globalMemoryLeads,
  globalMemoryPayments,
  globalMemoryTasks,
  globalMemoryActivities,
} from './memory-store';

export interface PilotCustomerRecord {
  id: string;
  tenantId: string;
  name: string;
  companyName?: string;
  phone: string;
  whatsappNumber?: string;
  gstin?: string;
  openingBalance: string;
  creditLimit: string;
  activeOrdersCount: number;
  totalReceivable: string;
  createdAt: Date;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  /**
   * List all customers for a tenant with computed outstanding balance
   * Enforces Row-Level Security: returns ONLY customers belonging to the tenant.
   */
  async listCustomers(tenantId: string, search?: string, userRole?: TenantRole) {
    const canSeePayments = userRole ? hasPermission(userRole, 'payment:view') : true;
    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          const rows = await tx
            .select({
              id: customers.id,
              name: customers.name,
              companyName: customers.companyName,
              phone: customers.phone,
              gstin: customers.gstin,
              openingBalance: customers.openingBalance,
              activeOrdersCount: sql<number>`(
                SELECT count(*)::int FROM orders o
                WHERE o.customer_id = ${customers.id}
                  AND o.production_stage NOT IN ('DELIVERED', 'INSTALLED')
              )`,
              totalReceivable: sql<string>`(
                COALESCE(${customers.openingBalance}, 0) +
                COALESCE((SELECT SUM(o.balance_due) FROM orders o WHERE o.customer_id = ${customers.id}), 0)
              )::numeric(12,2)::text`,
            })
            .from(customers)
            .where(eq(customers.tenantId, tenantId))
            .orderBy(desc(customers.createdAt));

          const sanitizedRows = rows.map((r) =>
            canSeePayments
              ? r
              : {
                  ...r,
                  openingBalance: null,
                  totalReceivable: null,
                }
          );

          if (!search) return sanitizedRows;
          const q = search.toLowerCase();
          return sanitizedRows.filter(
            (r) =>
              r.name.toLowerCase().includes(q) ||
              r.companyName?.toLowerCase().includes(q) ||
              r.phone.includes(q)
          );
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for listCustomers: ${err.message}`);
    }

    let tenantCustomers = globalMemoryCustomers
      .filter((c) => c.tenantId === tenantId)
      .map((c) => {
        const custOrders = globalMemoryOrders.filter(
          (o) => o.customerId === c.id && o.tenantId === tenantId
        );
        const activeOrders = custOrders.filter(
          (o) => !['DELIVERED', 'INSTALLED'].includes(o.productionStage)
        );
        const totalPendingOrderBal = custOrders.reduce(
          (sum, o) => sum + parseFloat(o.balanceDue || '0'),
          0
        );
        const totalReceivable = (
          parseFloat(c.openingBalance || '0') + totalPendingOrderBal
        ).toFixed(2);

        return {
          ...c,
          activeOrdersCount: activeOrders.length,
          totalReceivable,
        };
      });

    if (search) {
      const q = search.toLowerCase();
      tenantCustomers = tenantCustomers.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.companyName?.toLowerCase().includes(q) ||
          c.phone.includes(q)
      );
    }

    return tenantCustomers.map((c) =>
      canSeePayments
        ? c
        : {
            ...c,
            openingBalance: null,
            totalReceivable: null,
            creditLimit: null,
          }
    );
  }

  /**
   * Customer 360° Detail: Profile + Leads + Quotations + Orders + Ledger + Activity History
   * Enforces Row-Level Security: throws NotFoundException if the customer belongs to another tenant.
   */
  async getCustomer360(tenantId: string, userRole: TenantRole, customerId: string) {
    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          const [customer] = await tx
            .select()
            .from(customers)
            .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
            .limit(1);

          if (!customer) throw new NotFoundException('Customer not found in this tenant organization');

          const customerLeads = await tx
            .select()
            .from(leads)
            .where(and(eq(leads.customerId, customerId), eq(leads.tenantId, tenantId)))
            .orderBy(desc(leads.createdAt));

          const customerQuotes = await tx
            .select()
            .from(quotations)
            .where(and(eq(quotations.customerId, customerId), eq(quotations.tenantId, tenantId)))
            .orderBy(desc(quotations.createdAt));

          const customerOrders = await tx
            .select()
            .from(orders)
            .where(and(eq(orders.customerId, customerId), eq(orders.tenantId, tenantId)))
            .orderBy(desc(orders.createdAt));

          const pendingTasks = await tx
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.customerId, customerId),
                eq(tasks.tenantId, tenantId),
                eq(tasks.status, 'PENDING')
              )
            )
            .orderBy(tasks.dueAt);

          const canViewPayments = hasPermission(userRole, 'payment:view');
          const customerPayments = canViewPayments
            ? await tx
                .select()
                .from(payments)
                .where(and(eq(payments.customerId, customerId), eq(payments.tenantId, tenantId)))
                .orderBy(desc(payments.paidAt))
            : [];

          const relatedConditions: any[] = [
            eq(activities.entityId, customerId),
            sql`${activities.metadata}->>'customerId' = ${customerId}`,
          ];

          const leadIds = customerLeads.map((l) => l.id);
          if (leadIds.length > 0) {
            relatedConditions.push(and(eq(activities.entityType, 'LEAD'), inArray(activities.entityId, leadIds))!);
          }

          const quoteIds = customerQuotes.map((q) => q.id);
          if (quoteIds.length > 0) {
            relatedConditions.push(and(eq(activities.entityType, 'QUOTATION'), inArray(activities.entityId, quoteIds))!);
          }

          const orderIds = customerOrders.map((o) => o.id);
          if (orderIds.length > 0) {
            relatedConditions.push(and(eq(activities.entityType, 'ORDER'), inArray(activities.entityId, orderIds))!);
          }

          const taskIds = pendingTasks.map((t) => t.id);
          if (taskIds.length > 0) {
            relatedConditions.push(and(eq(activities.entityType, 'TASK'), inArray(activities.entityId, taskIds))!);
          }

          const timeline = await tx
            .select()
            .from(activities)
            .where(
              and(
                eq(activities.tenantId, tenantId),
                or(...relatedConditions)!
              )
            )
            .orderBy(desc(activities.createdAt))
            .limit(50);

          const totalOrderValue = customerOrders.reduce(
            (sum, o) => sum + parseFloat(o.totalAmount || '0'),
            0
          );
          const totalOrderBalance = customerOrders.reduce(
            (sum, o) => sum + parseFloat(o.balanceDue || '0'),
            0
          );
          const netReceivable = parseFloat(customer.openingBalance || '0') + totalOrderBalance;

          const maskedCustomer = canViewPayments
            ? customer
            : {
                ...customer,
                openingBalance: null,
                creditLimit: null,
              };

          const maskedQuotes = customerQuotes.map((q) =>
            canViewPayments
              ? q
              : {
                  ...q,
                  subTotal: null,
                  taxTotal: null,
                  discountTotal: null,
                  grandTotal: null,
                }
          );

          const sanitizedTimeline = filterAndSanitizeActivities(timeline, canViewPayments);

          return {
            customer: maskedCustomer,
            financialSummary: canViewPayments
              ? {
                  openingBalance: customer.openingBalance || '0.00',
                  lifetimeOrderValue: totalOrderValue.toFixed(2),
                  totalPendingBalance: netReceivable.toFixed(2),
                  creditLimit: customer.creditLimit || '100000.00',
                }
              : null,
            leads: customerLeads,
            quotations: maskedQuotes,
            orders: customerOrders.map((o) =>
              canViewPayments
                ? o
                : { ...o, totalAmount: null, advanceReceived: null, balanceDue: null }
            ),
            payments: customerPayments,
            pendingTasks,
            timeline: sanitizedTimeline,
          };
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for getCustomer360: ${err.message}`);
    }

    // Strict Tenant RLS Isolation Check: Customer MUST belong to the requested tenantId!
    const customer = globalMemoryCustomers.find(
      (c) => c.id === customerId && c.tenantId === tenantId
    );
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found in tenant ${tenantId}`);
    }

    const canViewPayments = hasPermission(userRole, 'payment:view');
    const tenantOrders = globalMemoryOrders.filter(
      (o) => o.customerId === customerId && o.tenantId === tenantId
    );

    const totalOrderValue = tenantOrders.reduce(
      (sum, o) => sum + parseFloat(o.totalAmount || '0'),
      0
    );
    const totalOrderBalance = tenantOrders.reduce(
      (sum, o) => sum + parseFloat(o.balanceDue || '0'),
      0
    );
    const netReceivable = parseFloat(customer.openingBalance || '0') + totalOrderBalance;

    const tenantLeads = globalMemoryLeads.filter(
      (l) => l.customerId === customerId && l.tenantId === tenantId
    );

    const tenantQuotes = globalMemoryQuotations.filter(
      (q) => q.customerId === customerId && q.tenantId === tenantId
    );

    const tenantPayments = canViewPayments
      ? globalMemoryPayments.filter(
          (p) => p.customerId === customerId && p.tenantId === tenantId
        )
      : [];

    const tenantTasks = globalMemoryTasks.filter(
      (t) =>
        t.customerId === customerId &&
        t.tenantId === tenantId &&
        t.status === 'PENDING'
    );

    const leadIdSet = new Set(tenantLeads.map((l) => l.id));
    const quoteIdSet = new Set(tenantQuotes.map((q) => q.id));
    const orderIdSet = new Set(tenantOrders.map((o) => o.id));
    const taskIdSet = new Set(tenantTasks.map((t) => t.id));

    const tenantActivities = globalMemoryActivities.filter(
      (a) =>
        a.tenantId === tenantId &&
        (a.entityId === customerId ||
          a.metadata?.customerId === customerId ||
          leadIdSet.has(a.entityId) ||
          quoteIdSet.has(a.entityId) ||
          orderIdSet.has(a.entityId) ||
          taskIdSet.has(a.entityId))
    );

    const maskedCustomer = canViewPayments
      ? customer
      : {
          ...customer,
          openingBalance: null,
          creditLimit: null,
        };

    const maskedQuotes = tenantQuotes.map((q) =>
      canViewPayments
        ? q
        : {
            ...q,
            subTotal: null,
            taxTotal: null,
            discountTotal: null,
            grandTotal: null,
          }
    );

    const baseTimeline = tenantActivities.length > 0 ? tenantActivities : [
      {
        id: `act-${customerId}-1`,
        action: 'CUSTOMER_CREATED',
        createdAt: customer.createdAt || new Date(),
      },
    ];
    const sanitizedTimeline = filterAndSanitizeActivities(baseTimeline, canViewPayments);

    return {
      customer: maskedCustomer,
      financialSummary: canViewPayments
        ? {
            openingBalance: customer.openingBalance || '0.00',
            lifetimeOrderValue: totalOrderValue.toFixed(2),
            totalPendingBalance: netReceivable.toFixed(2),
            creditLimit: customer.creditLimit || '100000.00',
          }
        : null,
      leads: tenantLeads,
      quotations: maskedQuotes,
      orders: tenantOrders.map((o) =>
        canViewPayments
          ? o
          : { ...o, totalAmount: null, advanceReceived: null, balanceDue: null }
      ),
      payments: tenantPayments,
      pendingTasks: tenantTasks,
      timeline: sanitizedTimeline,
    };
  }
}

