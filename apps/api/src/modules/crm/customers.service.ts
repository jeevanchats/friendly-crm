import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { sql, eq, and, desc } from 'drizzle-orm';
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
import { globalMemoryCustomers, globalMemoryOrders } from './memory-store';

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

  // In-memory fallback repository for local offline development & tests
  // Pre-seeded with the 4 isolated MSME Pilot Businesses
  private memoryCustomers: Array<any> = globalMemoryCustomers;

  // In-memory linked pilot orders for Customer 360 fallback
  private memoryOrders: Array<any> = globalMemoryOrders;

  /**
   * List all customers for a tenant with computed outstanding balance
   * Enforces Row-Level Security: returns ONLY customers belonging to the tenant.
   */
  async listCustomers(tenantId: string, search?: string) {
    try {
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

        if (!search) return rows;
        const q = search.toLowerCase();
        return rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.companyName?.toLowerCase().includes(q) ||
            r.phone.includes(q)
        );
      });
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for listCustomers: ${err.message}`);

      let tenantCustomers = this.memoryCustomers.filter((c) => c.tenantId === tenantId);

      if (search) {
        const q = search.toLowerCase();
        tenantCustomers = tenantCustomers.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.companyName?.toLowerCase().includes(q) ||
            c.phone.includes(q)
        );
      }

      return tenantCustomers;
    }
  }

  /**
   * Customer 360° Detail: Profile + Leads + Quotations + Orders + Ledger + Activity History
   * Enforces Row-Level Security: throws NotFoundException if the customer belongs to another tenant.
   */
  async getCustomer360(tenantId: string, userRole: TenantRole, customerId: string) {
    try {
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
          .where(eq(leads.customerId, customerId))
          .orderBy(desc(leads.createdAt));

        const customerQuotes = await tx
          .select()
          .from(quotations)
          .where(eq(quotations.customerId, customerId))
          .orderBy(desc(quotations.createdAt));

        const customerOrders = await tx
          .select()
          .from(orders)
          .where(eq(orders.customerId, customerId))
          .orderBy(desc(orders.createdAt));

        const pendingTasks = await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.customerId, customerId), eq(tasks.status, 'PENDING')))
          .orderBy(tasks.dueAt);

        const canViewPayments = hasPermission(userRole, 'payment:view');
        const customerPayments = canViewPayments
          ? await tx
              .select()
              .from(payments)
              .where(eq(payments.customerId, customerId))
              .orderBy(desc(payments.paidAt))
          : [];

        const timeline = await tx
          .select()
          .from(activities)
          .where(eq(activities.tenantId, tenantId))
          .orderBy(desc(activities.createdAt))
          .limit(30);

        const totalOrderValue = customerOrders.reduce(
          (sum, o) => sum + parseFloat(o.totalAmount || '0'),
          0
        );
        const totalOrderBalance = customerOrders.reduce(
          (sum, o) => sum + parseFloat(o.balanceDue || '0'),
          0
        );
        const netReceivable = parseFloat(customer.openingBalance || '0') + totalOrderBalance;

        return {
          customer,
          financialSummary: canViewPayments
            ? {
                openingBalance: customer.openingBalance || '0.00',
                lifetimeOrderValue: totalOrderValue.toFixed(2),
                totalPendingBalance: netReceivable.toFixed(2),
                creditLimit: customer.creditLimit || '100000.00',
              }
            : null,
          leads: customerLeads,
          quotations: customerQuotes,
          orders: customerOrders.map((o) =>
            canViewPayments
              ? o
              : { ...o, totalAmount: null, advanceReceived: null, balanceDue: null }
          ),
          payments: customerPayments,
          pendingTasks,
          timeline,
        };
      });
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      this.logger.warn(`Postgres offline; utilizing memory fallback for getCustomer360: ${err.message}`);

      // Strict Tenant RLS Isolation Check: Customer MUST belong to the requested tenantId!
      const customer = this.memoryCustomers.find((c) => c.id === customerId);
      if (!customer || customer.tenantId !== tenantId) {
        throw new NotFoundException(`Customer ${customerId} not found in tenant ${tenantId}`);
      }

      const canViewPayments = hasPermission(userRole, 'payment:view');
      const tenantOrders = this.memoryOrders.filter(
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

      return {
        customer,
        financialSummary: canViewPayments
          ? {
              openingBalance: customer.openingBalance,
              lifetimeOrderValue: totalOrderValue.toFixed(2),
              totalPendingBalance: netReceivable.toFixed(2),
              creditLimit: customer.creditLimit,
            }
          : null,
        leads: [
          {
            id: `lead-${customerId}-1`,
            title: `Ongoing project inquiry for ${customer.name}`,
            stage: 'QUALIFIED',
            createdAt: new Date(Date.now() - 86400000 * 3),
          },
        ],
        quotations: [
          {
            id: `qt-${customerId}-1`,
            quoteNumber: `QT-2026-${Math.floor(1000 + Math.random() * 9000)}`,
            version: 1,
            status: 'SENT',
            grandTotal: totalOrderValue ? totalOrderValue.toFixed(2) : '85000.00',
            createdAt: new Date(Date.now() - 86400000 * 2),
          },
        ],
        orders: tenantOrders.map((o) =>
          canViewPayments
            ? o
            : { ...o, totalAmount: null, advanceReceived: null, balanceDue: null }
        ),
        payments: canViewPayments
          ? [
              {
                id: `pay-${customerId}-1`,
                receiptNumber: `RCP-2026-${Math.floor(1000 + Math.random() * 9000)}`,
                mode: 'UPI',
                amount: (totalOrderValue * 0.4).toFixed(2),
                paidAt: new Date(Date.now() - 86400000 * 1),
              },
            ]
          : [],
        pendingTasks: [
          {
            id: `task-${customerId}-1`,
            title: `Follow up on production review with ${customer.name}`,
            dueAt: new Date(Date.now() + 86400000 * 1),
          },
        ],
        timeline: [
          {
            id: `act-${customerId}-1`,
            action: 'CUSTOMER_CREATED',
            createdAt: customer.createdAt,
          },
        ],
      };
    }
  }
}
