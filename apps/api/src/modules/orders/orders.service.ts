import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { sql, eq, and, desc } from 'drizzle-orm';
import {
  db,
  orders,
  orderItems,
  customers,
  users,
  payments,
  invoices,
  paymentAllocations,
  activities,
} from '@friendly-crm/db';
import { TenantRole, hasPermission } from '@friendly-crm/shared';
import { tenantContextStorage } from '../../common/interceptors/tenant-rls.interceptor';
import { randomUUID } from 'crypto';

export interface RecordPaymentDto {
  orderId?: string;
  amount: number;
  mode?: string;
  referenceNo?: string;
  notes?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  // In-memory fallback repository for local offline development & tests
  private memoryOrders: Array<any> = [
    {
      id: 'ord-demo-1',
      tenantId: 't-demo-printing',
      orderNumber: 'ORD-2026-0089',
      customerId: 'c-demo-1',
      quotationId: 'quote-demo-1',
      productionStage: 'ARTWORK_PENDING',
      totalAmount: '172000.00',
      advanceReceived: '86000.00',
      balanceDue: '86000.00',
      expectedDeliveryAt: new Date(Date.now() + 7 * 86400000),
      customData: {
        job_type: 'PACKAGING_BOX',
        paper_board_gsm: '350 GSM Cyber Premium Board',
        plate_size: '28x40 inch CTP',
        artwork_approved: true,
        dimensions_lwh: '10x8x4 inches',
        print_colors: 'CMYK_4C',
        finishing_ops: ['MATT_LAM', 'DIE_PUNCH'],
      },
      customer: {
        id: 'c-demo-1',
        name: 'Sri Murugan Textiles & Sweets',
        phone: '+919840123456',
        companyName: 'Murugan Retailers Pvt Ltd',
      },
      createdAt: new Date(Date.now() - 3600000 * 5),
      updatedAt: new Date(Date.now() - 3600000 * 5),
    },
    {
      id: 'ord-demo-2',
      tenantId: 't-demo-printing',
      orderNumber: 'ORD-2026-0082',
      customerId: 'c-demo-2',
      quotationId: 'quote-demo-2',
      productionStage: 'PRINTING',
      totalAmount: '72000.00',
      advanceReceived: '50000.00',
      balanceDue: '22000.00',
      expectedDeliveryAt: new Date(Date.now() + 3 * 86400000),
      customData: {
        job_type: 'CALENDAR',
        paper_board_gsm: '170 GSM Gloss Art Paper',
        plate_size: '19x25 inch CTP',
        artwork_approved: false,
        dimensions_lwh: '15x20 inches',
        print_colors: 'CMYK_4C',
        finishing_ops: ['TIN_MOUNTING'],
      },
      customer: {
        id: 'c-demo-2',
        name: 'Karthik Precision Engineering',
        phone: '+919876543210',
        companyName: 'Karthik Works',
      },
      createdAt: new Date(Date.now() - 3600000 * 24),
      updatedAt: new Date(Date.now() - 3600000 * 12),
    },
    {
      id: 'ord-demo-3',
      tenantId: 't-demo-furniture',
      orderNumber: 'ORD-2026-0045',
      customerId: 'c-demo-3',
      quotationId: 'quote-demo-3',
      productionStage: 'WOOD_CUTTING',
      totalAmount: '97800.00',
      advanceReceived: '30000.00',
      balanceDue: '67800.00',
      expectedDeliveryAt: new Date(Date.now() + 10 * 86400000),
      customData: {
        material_type: 'TEAK_WOOD',
        dimensions_lwh: '72x36x30 inches',
        warranty_years: 5,
        installation_required: true,
        artwork_approved: true,
        finish: 'WALNUT_MATTE',
      },
      customer: {
        id: 'c-demo-3',
        name: 'Grand Royal Residency',
        phone: '+919444123890',
        companyName: 'Royal Hospitality',
      },
      createdAt: new Date(Date.now() - 3600000 * 18),
      updatedAt: new Date(Date.now() - 3600000 * 18),
    },
  ];

  private memoryPayments: Array<any> = [
    {
      id: 'pay-demo-1',
      tenantId: 't-demo-printing',
      receiptNumber: 'RCP-2026-0101',
      orderId: 'ord-demo-1',
      customerId: 'c-demo-1',
      amount: '86000.00',
      mode: 'UPI',
      referenceNo: 'UPI/62891028391',
      receivedById: 'u-demo-1',
      paidAt: new Date(Date.now() - 3600000 * 5),
      notes: 'Initial 50% advance for raw material',
    },
    {
      id: 'pay-demo-2',
      tenantId: 't-demo-printing',
      receiptNumber: 'RCP-2026-0098',
      orderId: 'ord-demo-2',
      customerId: 'c-demo-2',
      amount: '50000.00',
      mode: 'BANK_TRANSFER',
      referenceNo: 'NEFT-AXIS-91823019',
      receivedById: 'u-demo-1',
      paidAt: new Date(Date.now() - 3600000 * 24),
      notes: 'Advance transfer',
    },
  ];

  private memoryActivities: Array<any> = [];

  private getDb() {
    return tenantContextStorage.getStore()?.tx || db;
  }

  /**
   * 1. GET /api/orders
   * List all orders for the tenant, optionally filtered by production stage
   */
  async getOrders(tenantId: string, stage?: string) {
    try {
      const activeDb = this.getDb();
      return await activeDb.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

        const query = tx
          .select({
            order: orders,
            customer: {
              id: customers.id,
              name: customers.name,
              phone: customers.phone,
              companyName: customers.companyName,
            },
          })
          .from(orders)
          .innerJoin(customers, eq(orders.customerId, customers.id))
          .where(
            stage
              ? and(eq(orders.tenantId, tenantId), eq(orders.productionStage, stage))
              : eq(orders.tenantId, tenantId)
          )
          .orderBy(desc(orders.createdAt));

        const rows = await query;
        return rows.map((r: any) => ({
          ...r.order,
          customer: r.customer,
        }));
      });
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for getOrders: ${err.message}`);

      let list = this.memoryOrders.filter((o) => o.tenantId === tenantId);
      if (stage && stage !== 'ALL') {
        list = list.filter((o) => o.productionStage === stage);
      }
      return list;
    }
  }

  /**
   * 2. PATCH /api/orders/:id/stage
   * Update production stage of an order with audit trail and custom data updates
   */
  async updateOrderStage(
    tenantId: string,
    userId: string,
    orderId: string,
    nextStageId: string,
    customDataUpdates?: Record<string, any>
  ) {
    if (!nextStageId) {
      throw new BadRequestException('nextStageId is required');
    }

    try {
      const activeDb = this.getDb();
      return await activeDb.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

        const [existing] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
          .limit(1);

        if (!existing) {
          throw new NotFoundException(`Order ${orderId} not found`);
        }

        const prevStage = existing.productionStage;
        const newCustomData = customDataUpdates
          ? { ...(existing.customData || {}), ...customDataUpdates }
          : existing.customData;

        const [updated] = await tx
          .update(orders)
          .set({
            productionStage: nextStageId,
            customData: newCustomData,
            updatedAt: new Date(),
          })
          .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
          .returning();

        // Audit Trail Activity
        await tx.insert(activities).values({
          tenantId,
          actorId: userId,
          entityType: 'ORDER',
          entityId: orderId,
          action: 'STAGE_UPDATED',
          metadata: {
            prevStage,
            nextStage: nextStageId,
            customDataUpdates: customDataUpdates || null,
          },
        });

        return updated;
      });
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for updateOrderStage: ${err.message}`);

      const order = this.memoryOrders.find(
        (o) => o.id === orderId && o.tenantId === tenantId
      );
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }

      const prevStage = order.productionStage;
      order.productionStage = nextStageId;
      if (customDataUpdates) {
        order.customData = { ...(order.customData || {}), ...customDataUpdates };
      }
      order.updatedAt = new Date();

      this.memoryActivities.push({
        id: randomUUID(),
        tenantId,
        actorId: userId,
        entityType: 'ORDER',
        entityId: orderId,
        action: 'STAGE_UPDATED',
        metadata: { prevStage, nextStage: nextStageId, customDataUpdates: customDataUpdates || null },
        createdAt: new Date(),
      });

      return order;
    }
  }

  /**
   * Record payment for an order with RBAC enforcement
   */
  async recordOrderPayment(
    tenantId: string,
    userId: string,
    userRole: TenantRole,
    dto: RecordPaymentDto & { orderId: string }
  ) {
    if (!hasPermission(userRole, 'payment:create')) {
      throw new ForbiddenException('Your role is not permitted to record payments');
    }
    return this.recordPayment(tenantId, userId, dto.orderId, dto);
  }

  /**
   * 3. POST /api/orders/:id/payments
   * Record partial or full payment against an order, generate receipt & recalculate balance
   */
  async recordPayment(
    tenantId: string,
    userId: string,
    orderId: string,
    dto: RecordPaymentDto
  ) {
    const amount = Number(dto.amount);
    if (!amount || amount <= 0 || isNaN(amount)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const receiptNumber = `RCP-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const mode = dto.mode || 'UPI';

    try {
      const activeDb = this.getDb();
      return await activeDb.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

        const [order] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
          .limit(1);

        if (!order) {
          throw new NotFoundException(`Order ${orderId} not found`);
        }

        const currentAdvance = parseFloat(order.advanceReceived || '0.00');
        const currentTotal = parseFloat(order.totalAmount);
        const currentBalance = parseFloat(order.balanceDue);

        if (amount > currentBalance + 0.01) {
          throw new BadRequestException(
            `Payment amount (₹${amount}) exceeds outstanding balance (₹${currentBalance})`
          );
        }

        const newAdvance = currentAdvance + amount;
        const newBalance = Math.max(0, currentTotal - newAdvance);

        // 1. Insert Payment
        const [payment] = await tx
          .insert(payments)
          .values({
            tenantId,
            receiptNumber,
            customerId: order.customerId,
            orderId: order.id,
            amount: amount.toFixed(2),
            mode,
            referenceNo: dto.referenceNo || null,
            receivedById: userId,
            notes: dto.notes || null,
            paidAt: new Date(),
          })
          .returning();

        // 2. Update Order Balances
        const [updatedOrder] = await tx
          .update(orders)
          .set({
            advanceReceived: newAdvance.toFixed(2),
            balanceDue: newBalance.toFixed(2),
            updatedAt: new Date(),
          })
          .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
          .returning();

        // 3. Activity Audit Trail
        await tx.insert(activities).values({
          tenantId,
          actorId: userId,
          entityType: 'ORDER',
          entityId: orderId,
          action: 'PAYMENT_RECORDED',
          metadata: {
            receiptNumber,
            amount: amount.toFixed(2),
            mode,
            balanceRemaining: newBalance.toFixed(2),
          },
        });

        return {
          payment,
          order: updatedOrder,
        };
      });
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for recordPayment: ${err.message}`);

      const order = this.memoryOrders.find(
        (o) => o.id === orderId && o.tenantId === tenantId
      );
      if (!order) {
        throw new NotFoundException(`Order ${orderId} not found`);
      }

      const currentAdvance = parseFloat(order.advanceReceived || '0.00');
      const currentTotal = parseFloat(order.totalAmount);
      const currentBalance = parseFloat(order.balanceDue);

      if (amount > currentBalance + 0.01) {
        throw new BadRequestException(
          `Payment amount (₹${amount}) exceeds outstanding balance (₹${currentBalance})`
        );
      }

      const newAdvance = currentAdvance + amount;
      const newBalance = Math.max(0, currentTotal - newAdvance);

      const payment = {
        id: randomUUID(),
        tenantId,
        receiptNumber,
        customerId: order.customerId,
        orderId: order.id,
        amount: amount.toFixed(2),
        mode,
        referenceNo: dto.referenceNo || `REF-${Date.now().toString().slice(-6)}`,
        receivedById: userId,
        paidAt: new Date(),
        notes: dto.notes || null,
      };

      this.memoryPayments.unshift(payment);

      order.advanceReceived = newAdvance.toFixed(2);
      order.balanceDue = newBalance.toFixed(2);
      order.updatedAt = new Date();

      this.memoryActivities.push({
        id: randomUUID(),
        tenantId,
        actorId: userId,
        entityType: 'ORDER',
        entityId: orderId,
        action: 'PAYMENT_RECORDED',
        metadata: {
          receiptNumber,
          amount: amount.toFixed(2),
          mode,
          balanceRemaining: newBalance.toFixed(2),
        },
        createdAt: new Date(),
      });

      return {
        payment,
        order,
      };
    }
  }

  /**
   * 4. GET /api/orders/:id
   * Fetch complete order details with customer, line items, payments, and timeline
   */
  async getOrderDetail(tenantId: string, userRole: TenantRole, orderId: string) {
    if (!hasPermission(userRole, 'order:view')) {
      throw new ForbiddenException('You do not have permission to view orders');
    }

    try {
      const activeDb = this.getDb();
      return await activeDb.transaction(async (tx: any) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);

        // 1. Fetch Order + Customer Profile
        const [orderRow] = await tx
          .select({
            order: orders,
            customer: customers,
          })
          .from(orders)
          .innerJoin(customers, eq(orders.customerId, customers.id))
          .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
          .limit(1);

        if (!orderRow) throw new NotFoundException('Order not found');

        // 2. Fetch Order Line Items
        const items = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId));

        // 3. Fetch Partial Payments & Receipts (only if role has payment:view or is OWNER/MANAGER)
        const canSeePayments = hasPermission(userRole, 'payment:view');
        const paymentHistory = canSeePayments
          ? await tx
              .select()
              .from(payments)
              .where(eq(payments.orderId, orderId))
              .orderBy(desc(payments.paidAt))
          : [];

        // 4. Fetch Timestamped Activity Audit Trail with Actor Name
        const timeline = await tx
          .select({
            id: activities.id,
            action: activities.action,
            metadata: activities.metadata,
            createdAt: activities.createdAt,
            actorName: users.fullName,
          })
          .from(activities)
          .leftJoin(users, eq(activities.actorId, users.id))
          .where(
            and(
              eq(activities.tenantId, tenantId),
              eq(activities.entityType, 'ORDER'),
              eq(activities.entityId, orderId)
            )
          )
          .orderBy(desc(activities.createdAt));

        const orderData = orderRow.order;

        // Mask financial figures if user lacks 'payment:view' permission (e.g., PRODUCTION role)
        const maskedOrder = canSeePayments
          ? orderData
          : {
              ...orderData,
              totalAmount: null,
              advanceReceived: null,
              balanceDue: null,
            };

        const maskedItems = items.map((item: any) =>
          canSeePayments
            ? item
            : {
                ...item,
                unitPrice: null,
                lineTotal: null,
              }
        );

        return {
          ...maskedOrder,
          customer: orderRow.customer,
          items: maskedItems,
          payments: paymentHistory,
          timeline,
        };
      });
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for getOrderDetail: ${err.message}`);

      const order = this.memoryOrders.find(
        (o) => o.id === orderId && o.tenantId === tenantId
      );
      if (!order) throw new NotFoundException(`Order ${orderId} not found`);

      const canSeePayments = hasPermission(userRole, 'payment:view');
      const orderPayments = canSeePayments
        ? this.memoryPayments.filter((p) => p.orderId === orderId)
        : [];

      const sampleItems = [
        {
          id: `item-${orderId}-1`,
          orderId,
          itemName: order.customData?.job_type === 'PACKAGING_BOX'
            ? 'Embossed Gold Sweet Box (Heavy Duty)'
            : order.customData?.material_type || order.customData?.wood_type
            ? 'Solid Teak 6-Seater Dining Table'
            : 'Custom Specification Job',
          description: order.customData?.paper_board_gsm || order.customData?.paper_gsm
            ? `${order.customData.paper_board_gsm || order.customData.paper_gsm} GSM Cyber Premium Board, CMYK + Gold Foil Stamping`
            : order.customData?.material_type || order.customData?.wood_type
            ? `Solid Seasoned ${order.customData.material_type || order.customData.wood_type}, PU Matte Coat`
            : 'Custom fabricated job card specifications',
          quantity: order.customData?.job_type === 'PACKAGING_BOX' ? '3000' : '1',
          unit: order.customData?.job_type === 'PACKAGING_BOX' ? 'Nos' : 'Set',
          unitPrice: canSeePayments
            ? (order.customData?.job_type === 'PACKAGING_BOX' ? '42.00' : order.totalAmount)
            : null,
          taxPercent: '18.00',
          lineTotal: canSeePayments ? order.totalAmount : null,
        },
      ];

      const maskedOrder = canSeePayments
        ? order
        : {
            ...order,
            totalAmount: null,
            advanceReceived: null,
            balanceDue: null,
          };

      const orderTimeline = this.memoryActivities.filter((a) => a.entityId === orderId);
      const timelineToReturn = orderTimeline.length > 0 ? orderTimeline : [
        {
          id: `act-${orderId}-1`,
          action: 'ORDER_CONFIRMED',
          metadata: { note: 'Quotation converted into production order' },
          createdAt: order.createdAt || new Date(Date.now() - 3600000 * 5),
          actorName: 'Anand Kumar (Sales)',
        },
        ...(canSeePayments
          ? [
              {
                id: `act-${orderId}-2`,
                action: 'ADVANCE_RECORDED',
                metadata: { amount: order.advanceReceived, mode: 'UPI' },
                createdAt: order.createdAt || new Date(Date.now() - 3600000 * 4),
                actorName: 'Suresh (Accounts)',
              },
            ]
          : []),
      ];

      return {
        ...maskedOrder,
        customer: order.customer,
        items: sampleItems,
        payments: orderPayments,
        timeline: timelineToReturn,
      };
    }
  }
}
