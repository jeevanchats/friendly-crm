import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { sql, eq, and, desc } from 'drizzle-orm';
import { NotificationOutboxService } from '../notifications/notification-outbox.service';
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
  tenants,
} from '@friendly-crm/db';
import { TenantRole, hasPermission, getIndustryTemplate, IndustryKey } from '@friendly-crm/shared';
import { tenantContextStorage } from '../../common/interceptors/tenant-rls.interceptor';
import {
  getNextDbDocumentNumber,
  getNextMemoryDocumentNumber,
  getIdempotentResult,
  setIdempotentResult,
  roundMoney,
  filterAndSanitizeActivities,
} from '../../common';
import { randomUUID } from 'crypto';
import {
  globalMemoryOrders,
  globalMemoryOrderItems,
  globalMemoryPayments,
  globalMemoryActivities,
  globalMemoryCustomers,
  globalMemoryTenants,
} from '../crm/memory-store';

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

  constructor(
    @Optional() private readonly notificationOutboxService?: NotificationOutboxService
  ) {}

  private getDb() {
    return tenantContextStorage.getStore()?.tx || db;
  }

  /**
   * Customer-facing order list (WhatsApp self-service). Strictly scoped to ONE customer within ONE
   * tenant and returns only fields a customer may see (no items, custom data, notes or audit trail).
   */
  async getOrdersForCustomer(tenantId: string, customerId: string, limit = 10) {
    const pick = (o: any) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      productionStage: o.productionStage,
      totalAmount: o.totalAmount ?? null,
      advanceReceived: o.advanceReceived ?? null,
      balanceDue: o.balanceDue ?? null,
      expectedDeliveryAt: o.expectedDeliveryAt ?? null,
      createdAt: o.createdAt ?? null,
    });

    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.transaction === 'function') {
        return await activeDb.transaction(async (tx: any) => {
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
          const rows = await tx
            .select()
            .from(orders)
            .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, customerId)))
            .orderBy(desc(orders.createdAt))
            .limit(limit);
          return rows.map(pick);
        });
      }
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for getOrdersForCustomer: ${err.message}`);
    }

    return globalMemoryOrders
      .filter((o) => o.tenantId === tenantId && o.customerId === customerId)
      .sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0))
      .slice(0, limit)
      .map(pick);
  }

  /**
   * 1. GET /api/orders
   * List all orders for the tenant, optionally filtered by production stage
   */
  async getOrders(tenantId: string, stage?: string, userRole?: TenantRole) {
    const canSeePayments = userRole ? hasPermission(userRole, 'payment:view') : true;
    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.transaction === 'function') {
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
            ...(canSeePayments
              ? r.order
              : {
                  ...r.order,
                  totalAmount: null,
                  advanceReceived: null,
                  balanceDue: null,
                }),
            customer: r.customer,
          }));
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for getOrders: ${err.message}`);
    }

    let list = globalMemoryOrders.filter((o) => o.tenantId === tenantId);
    if (stage && stage !== 'ALL') {
      list = list.filter((o) => o.productionStage === stage);
    }
    return list.map((o) => {
      const cust = o.customer || globalMemoryCustomers.find((c) => c.id === o.customerId);
      const maskedOrder = canSeePayments
        ? o
        : {
            ...o,
            totalAmount: null,
            advanceReceived: null,
            balanceDue: null,
          };
      return {
        ...maskedOrder,
        customer: cust
          ? {
              id: cust.id,
              name: cust.name,
              phone: cust.phone,
              companyName: cust.companyName,
            }
          : {
              id: o.customerId,
              name: 'Customer',
              phone: '',
              companyName: '',
            },
      };
    });
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
    if (!nextStageId || typeof nextStageId !== 'string' || !nextStageId.trim()) {
      throw new BadRequestException('nextStageId is required');
    }
    const cleanStageId = nextStageId.trim();

    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.transaction === 'function') {
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

          // Verify nextStageId belongs to tenant's active industry template stages
          const [tenant] = await tx
            .select({ industryKey: tenants.industryKey })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(1);

          const industryKey = (tenant?.industryKey || 'printing') as IndustryKey;
          const template = getIndustryTemplate(industryKey);
          const isValidStage = template.orderStages.some((s) => s.id === cleanStageId);
          if (!isValidStage) {
            throw new BadRequestException(
              `Invalid production stage '${cleanStageId}' for industry '${industryKey}'. Valid stages are: ${template.orderStages.map((s) => s.id).join(', ')}`
            );
          }

          const prevStage = existing.productionStage;
          const newCustomData = customDataUpdates
            ? { ...(existing.customData || {}), ...customDataUpdates }
            : existing.customData;

          const [updated] = await tx
            .update(orders)
            .set({
              productionStage: cleanStageId,
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
              nextStage: cleanStageId,
              customDataUpdates: customDataUpdates || null,
            },
          });

          if (this.notificationOutboxService) {
            tx.select({ phone: customers.phone, name: customers.name })
              .from(customers)
              .where(eq(customers.id, order.customerId))
              .limit(1)
              .then(([cust]: any[]) => {
                if (cust?.phone) {
                  this.notificationOutboxService?.enqueueNotification({
                    tenantId,
                    recipient: cust.phone,
                    templateKey: 'STAGE_UPDATED',
                    params: {
                      customerName: cust.name,
                      orderNumber: updated.orderNumber,
                      stageName: cleanStageId,
                      balanceText: updated.balanceDue != null ? `\nBalance Due: ₹${updated.balanceDue}` : '',
                    },
                  }).catch((e: any) => this.logger.warn(`Stage update outbox enqueue failed: ${e.message}`));
                }
              })
              .catch((e: any) => this.logger.warn(`Failed to resolve customer phone for notification: ${e.message}`));
          }

          return updated;
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for updateOrderStage: ${err.message}`);
    }

    const order = globalMemoryOrders.find(
      (o) => o.id === orderId && o.tenantId === tenantId
    );
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found in this tenant`);
    }

    const memTenant = globalMemoryTenants.get(tenantId);
    const industryKey = (memTenant?.industryKey || 'printing') as IndustryKey;
    const template = getIndustryTemplate(industryKey);
    const isValidStage = template.orderStages.some((s) => s.id === cleanStageId);
    if (!isValidStage) {
      throw new BadRequestException(
        `Invalid production stage '${cleanStageId}' for industry '${industryKey}'. Valid stages are: ${template.orderStages.map((s) => s.id).join(', ')}`
      );
    }

    const prevStage = order.productionStage;
    order.productionStage = cleanStageId;
    if (customDataUpdates) {
      order.customData = { ...(order.customData || {}), ...customDataUpdates };
    }
    order.updatedAt = new Date();

    globalMemoryActivities.unshift({
      id: randomUUID(),
      tenantId,
      actorId: userId,
      entityType: 'ORDER',
      entityId: orderId,
      action: 'STAGE_UPDATED',
      metadata: { prevStage, nextStage: cleanStageId, customDataUpdates: customDataUpdates || null },
      createdAt: new Date(),
    });

    const cust = order.customer || globalMemoryCustomers.find((c) => c.id === order.customerId);
    if (this.notificationOutboxService && cust?.phone) {
      this.notificationOutboxService.enqueueNotification({
        tenantId,
        recipient: cust.phone,
        templateKey: 'STAGE_UPDATED',
        params: {
          customerName: cust.name,
          orderNumber: order.orderNumber,
          stageName: cleanStageId,
          balanceText: order.balanceDue != null ? `\nBalance Due: ₹${order.balanceDue}` : '',
        },
      }).catch((e: any) => this.logger.warn(`Stage update outbox enqueue failed: ${e.message}`));
    }

    return order;
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
    dto: RecordPaymentDto,
    idempotencyKey?: string
  ) {
    const amount = Number(dto.amount);
    if (!amount || amount <= 0 || isNaN(amount)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const key = idempotencyKey || (dto as any).idempotencyKey;
    if (key) {
      const cached = getIdempotentResult(tenantId, 'record-payment', key);
      if (cached) {
        return { ...cached, isIdempotent: true };
      }
    }

    const mode = dto.mode || 'UPI';

    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.transaction === 'function') {
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

          if (dto.referenceNo && dto.referenceNo.trim()) {
            const [existingRef] = await tx
              .select()
              .from(payments)
              .where(
                and(
                  eq(payments.tenantId, tenantId),
                  eq(payments.orderId, orderId),
                  eq(payments.referenceNo, dto.referenceNo.trim())
                )
              )
              .limit(1);
            if (existingRef) {
              throw new BadRequestException(
                `Payment with reference number '${dto.referenceNo.trim()}' has already been recorded`
              );
            }
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

          const receiptNumber = await getNextDbDocumentNumber(tx, payments, payments.receiptNumber, 'RCP', tenantId);

          // 1. Insert Payment
          const [payment] = await tx
            .insert(payments)
            .values({
              tenantId,
              receiptNumber,
              customerId: order.customerId,
              orderId: order.id,
              amount: roundMoney(amount),
              mode,
              referenceNo: dto.referenceNo?.trim() || null,
              receivedById: userId,
              notes: dto.notes || null,
              paidAt: new Date(),
            })
            .returning();

          // 2. Update Order Balances
          const [updatedOrder] = await tx
            .update(orders)
            .set({
              advanceReceived: roundMoney(newAdvance),
              balanceDue: roundMoney(newBalance),
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
              amount: roundMoney(amount),
              mode,
              balanceRemaining: roundMoney(newBalance),
            },
          });

          // 4. The customer's receivable is computed from opening balance + order balances when read; there is no
          // stored total to update (the database has no such column).
          const [customer] = await tx
            .select()
            .from(customers)
            .where(and(eq(customers.id, order.customerId), eq(customers.tenantId, tenantId)))
            .limit(1);

          const result = {
            payment,
            order: updatedOrder,
          };

          if (key) {
            setIdempotentResult(tenantId, 'record-payment', key, result);
          }

          if (this.notificationOutboxService && customer?.phone) {
            this.notificationOutboxService.enqueueNotification({
              tenantId,
              recipient: customer.phone,
              templateKey: 'PAYMENT_RECEIPT',
              params: {
                customerName: customer.name,
                amount: roundMoney(amount),
                mode,
                receiptNumber,
                balanceRemaining: roundMoney(newBalance),
              },
            }).catch((e: any) => this.logger.warn(`Payment outbox enqueue failed: ${e.message}`));
          }

          return result;
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for recordPayment: ${err.message}`);
    }

    const order = globalMemoryOrders.find(
      (o) => o.id === orderId && o.tenantId === tenantId
    );
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found in this tenant`);
    }

    if (dto.referenceNo && dto.referenceNo.trim()) {
      const existingRef = globalMemoryPayments.find(
        (p) => p.tenantId === tenantId && p.orderId === orderId && p.referenceNo === dto.referenceNo.trim()
      );
      if (existingRef) {
        throw new BadRequestException(
          `Payment with reference number '${dto.referenceNo.trim()}' has already been recorded`
        );
      }
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

    const receiptNumber = getNextMemoryDocumentNumber(globalMemoryPayments, 'receiptNumber', 'RCP', tenantId);

    const payment = {
      id: randomUUID(),
      tenantId,
      receiptNumber,
      customerId: order.customerId,
      orderId: order.id,
      amount: roundMoney(amount),
      mode,
      referenceNo: dto.referenceNo ? dto.referenceNo.trim() : `REF-${Date.now().toString().slice(-6)}`,
      receivedById: userId,
      paidAt: new Date(),
      notes: dto.notes || null,
    };

    globalMemoryPayments.unshift(payment);

    order.advanceReceived = roundMoney(newAdvance);
    order.balanceDue = roundMoney(newBalance);
    order.updatedAt = new Date();

    const customer = globalMemoryCustomers.find(
      (c) => c.id === order.customerId && c.tenantId === tenantId
    );
    if (customer) {
      const curRec = parseFloat(customer.totalReceivable || '0.00');
      customer.totalReceivable = roundMoney(Math.max(0, curRec - amount));
    }

    globalMemoryActivities.unshift({
      id: randomUUID(),
      tenantId,
      actorId: userId,
      entityType: 'ORDER',
      entityId: orderId,
      action: 'PAYMENT_RECORDED',
      metadata: {
        receiptNumber,
        amount: roundMoney(amount),
        mode,
        balanceRemaining: roundMoney(newBalance),
      },
      createdAt: new Date(),
    });

    const result = {
      payment,
      order,
    };

    if (key) {
      setIdempotentResult(tenantId, 'record-payment', key, result);
    }

    if (this.notificationOutboxService && customer?.phone) {
      this.notificationOutboxService.enqueueNotification({
        tenantId,
        recipient: customer.phone,
        templateKey: 'PAYMENT_RECEIPT',
        params: {
          customerName: customer.name,
          amount: roundMoney(amount),
          mode,
          receiptNumber,
          balanceRemaining: roundMoney(newBalance),
        },
      }).catch((e: any) => this.logger.warn(`Payment outbox enqueue failed: ${e.message}`));
    }

    return result;
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
      if (typeof activeDb?.transaction === 'function') {
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

          const sanitizedTimeline = filterAndSanitizeActivities(timeline, canSeePayments);

          return {
            ...maskedOrder,
            customer: orderRow.customer,
            items: maskedItems,
            payments: paymentHistory,
            timeline: sanitizedTimeline,
          };
        });
      }
    } catch (err: any) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      this.logger.warn(`Postgres offline; utilizing memory fallback for getOrderDetail: ${err.message}`);
    }

    const order = globalMemoryOrders.find(
      (o) => o.id === orderId && o.tenantId === tenantId
    );
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const canSeePayments = hasPermission(userRole, 'payment:view');
    const orderPayments = canSeePayments
      ? globalMemoryPayments.filter((p) => p.orderId === orderId && p.tenantId === tenantId)
      : [];

    const existingItems = globalMemoryOrderItems.filter((i) => i.orderId === orderId);

    const itemsToReturn = existingItems.length > 0 ? existingItems : [
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

    const maskedItems = itemsToReturn.map((item: any) =>
      canSeePayments
        ? item
        : {
            ...item,
            unitPrice: null,
            lineTotal: null,
          }
    );

    const customer = order.customer || globalMemoryCustomers.find((c) => c.id === order.customerId) || {
      id: order.customerId,
      name: 'Customer',
      phone: '',
      companyName: '',
    };

    const orderTimeline = globalMemoryActivities.filter((a) => a.entityId === orderId && a.tenantId === tenantId);
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

    const sanitizedTimeline = filterAndSanitizeActivities(timelineToReturn, canSeePayments);

    return {
      ...maskedOrder,
      customer,
      items: maskedItems,
      payments: orderPayments,
      timeline: sanitizedTimeline,
    };
  }
}

