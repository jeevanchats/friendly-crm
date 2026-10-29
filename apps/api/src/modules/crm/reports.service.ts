import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { sql, eq } from 'drizzle-orm';
import { db } from '@friendly-crm/db';
import { leads, quotations, orders, customers, payments } from '@friendly-crm/db';
import { TenantRole, hasPermission } from '@friendly-crm/shared';
import {
  globalMemoryOrders,
  globalMemoryCustomers,
  globalMemoryLeads,
} from './memory-store';
import { onDbError } from '../../common/utils/db-fallback.util';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  async getBusinessInsights(tenantId: string, userRole: TenantRole) {
    if (!hasPermission(userRole, 'report:view')) {
      throw new ForbiddenException('Your role does not have access to business reports');
    }

    try {
      if (typeof db?.transaction === 'function') {
        return await db.transaction(async (tx) => {
          // Enforce PostgreSQL Row-Level Security
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

          // 1. Lead-to-Order Conversion Funnel Metrics
          const [funnel] = await tx
            .select({
              totalLeads: sql<number>`count(*)::int`,
              quotedLeads: sql<number>`count(*) FILTER (WHERE stage IN ('QUOTED', 'NEGOTIATION', 'WON'))::int`,
              wonLeads: sql<number>`count(*) FILTER (WHERE stage = 'WON')::int`,
            })
            .from(leads)
            .where(eq(leads.tenantId, tenantId));

          const conversionRate =
            funnel.totalLeads > 0
              ? ((funnel.wonLeads / funnel.totalLeads) * 100).toFixed(1)
              : '0.0';

          // 2. Sales & Collections Summary
          const [financials] = await tx
            .select({
              totalSalesBooked: sql<string>`COALESCE(SUM(total_amount), 0)::numeric(12,2)::text`,
              totalCollected: sql<string>`COALESCE(SUM(advance_received), 0)::numeric(12,2)::text`,
              totalPendingReceivables: sql<string>`COALESCE(SUM(balance_due), 0)::numeric(12,2)::text`,
            })
            .from(orders)
            .where(eq(orders.tenantId, tenantId));

          // 3. Top Pending Receivables (Customers who owe money right now)
          const topDebtors = await tx.execute(sql`
            SELECT
              c.id AS "customerId",
              c.name AS "customerName",
              c.phone AS "customerPhone",
              SUM(o.balance_due)::numeric(12,2)::text AS "totalDue",
              COUNT(o.id)::int AS "unpaidOrdersCount"
            FROM customers c
            JOIN orders o ON o.customer_id = c.id
            WHERE c.tenant_id = ${tenantId} AND o.balance_due > 0
            GROUP BY c.id, c.name, c.phone
            ORDER BY SUM(o.balance_due) DESC
            LIMIT 10
          `);

          // 4. Section 8 AI/Business Insight: Inactive & Repeat-Order Opportunities
          // Finds past buyers whose last order was > 45 days ago
          const repeatOpportunities = await tx.execute(sql`
            SELECT
              c.id AS "customerId",
              c.name AS "customerName",
              c.phone AS "customerPhone",
              MAX(o.created_at) AS "lastOrderDate",
              COUNT(o.id)::int AS "pastOrdersCount",
              SUM(o.total_amount)::numeric(12,2)::text AS "lifetimeSpent"
            FROM customers c
            JOIN orders o ON o.customer_id = c.id
            WHERE c.tenant_id = ${tenantId}
            GROUP BY c.id, c.name, c.phone
            HAVING MAX(o.created_at) < NOW() - INTERVAL '45 days'
            ORDER BY SUM(o.total_amount) DESC
            LIMIT 10
          `);

          return {
            funnel: {
              ...funnel,
              conversionRatePercent: conversionRate,
            },
            financials,
            topDebtors: Array.isArray(topDebtors) ? topDebtors : (topDebtors as any)?.rows ?? [],
            repeatOpportunities: Array.isArray(repeatOpportunities) ? repeatOpportunities : (repeatOpportunities as any)?.rows ?? [],
          };
        });
      }
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      onDbError(this.logger, 'utilizing memory fallback for getBusinessInsights', err);
    }

    // Memory Fallback strictly scoped to tenantId
    const tenantLeads = globalMemoryLeads.filter((l) => l.tenantId === tenantId);
    const tenantOrders = globalMemoryOrders.filter((o) => o.tenantId === tenantId);
    const tenantCustomers = globalMemoryCustomers.filter((c) => c.tenantId === tenantId);

    const totalLeads = tenantLeads.length;
    const wonLeads = tenantLeads.filter((l) => l.stage === 'WON').length;
    const quotedLeads = tenantLeads.filter((l) => ['QUOTED', 'NEGOTIATION', 'WON'].includes(l.stage)).length;
    const conversionRatePercent = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0';

    const totalSalesBookedNum = tenantOrders.reduce((sum, o) => sum + parseFloat(o.totalAmount || '0'), 0);
    const totalCollectedNum = tenantOrders.reduce((sum, o) => sum + parseFloat(o.advanceReceived || '0'), 0);
    const totalPendingReceivablesNum = tenantOrders.reduce((sum, o) => sum + parseFloat(o.balanceDue || '0'), 0);

    const debtors = tenantCustomers
      .map((c) => {
        const custOrders = tenantOrders.filter((o) => o.customerId === c.id && parseFloat(o.balanceDue || '0') > 0);
        const totalDue = custOrders.reduce((sum, o) => sum + parseFloat(o.balanceDue || '0'), 0);
        return {
          customerId: c.id,
          customerName: c.name,
          customerPhone: c.phone,
          totalDue: totalDue.toFixed(2),
          unpaidOrdersCount: custOrders.length,
        };
      })
      .filter((d) => parseFloat(d.totalDue) > 0)
      .sort((a, b) => parseFloat(b.totalDue) - parseFloat(a.totalDue));

    // Repeat opportunities (orders > 45 days ago)
    const fortyFiveDaysAgo = Date.now() - 86400000 * 45;
    const repeatOpps = tenantCustomers
      .map((c) => {
        const custOrders = tenantOrders.filter((o) => o.customerId === c.id);
        if (custOrders.length === 0) return null;
        const lastOrder = custOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        const lastOrderTime = new Date(lastOrder.createdAt).getTime();
        if (lastOrderTime >= fortyFiveDaysAgo) return null;

        const lifetimeSpent = custOrders.reduce((sum, o) => sum + parseFloat(o.totalAmount || '0'), 0);
        return {
          customerId: c.id,
          customerName: c.name,
          customerPhone: c.phone,
          pastOrdersCount: custOrders.length,
          lifetimeSpent: lifetimeSpent.toFixed(2),
          lastOrderDate: lastOrder.createdAt instanceof Date ? lastOrder.createdAt.toISOString() : String(lastOrder.createdAt),
        };
      })
      .filter(Boolean)
      .slice(0, 10);

    return {
      funnel: {
        totalLeads,
        quotedLeads,
        wonLeads,
        conversionRatePercent,
      },
      financials: {
        totalSalesBooked: totalSalesBookedNum.toFixed(2),
        totalCollected: totalCollectedNum.toFixed(2),
        totalPendingReceivables: totalPendingReceivablesNum.toFixed(2),
      },
      topDebtors: debtors,
      repeatOpportunities: repeatOpps,
    };

  }
}
