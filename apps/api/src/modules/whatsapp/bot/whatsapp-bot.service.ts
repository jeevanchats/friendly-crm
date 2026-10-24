import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { hasPermission } from '@friendly-crm/shared';
import { AuthService } from '../../auth/auth.service';
import { CrmService } from '../../crm/crm.service';
import { OrdersService } from '../../orders/orders.service';
import { TenantNotificationProviderManager } from '../../notifications/adapters/tenant-provider-manager';
import { webhookDeduplication } from '../../notifications/webhook-verification.util';
import { BotPorts, BotSession, ConversationEngine, OrderSummary } from './conversation.engine';
import { InboundMessage, parseInboundMessages } from './inbound-parser';
import { InMemorySessionStore } from './session-store';
import { CustomerIdentityService } from './customer-identity.service';
import { TenantService } from '../../tenant/tenant.service';
import { CustomerQuoteService } from '../../sales/customer-quote.service';

/**
 * Wires the pure ConversationEngine to the real CRM / Orders / Auth services and sends replies.
 * Authorization is re-checked on every write here (defense in depth), independent of the menu.
 */
@Injectable()
export class WhatsAppBotService {
  private readonly logger = new Logger(WhatsAppBotService.name);
  private readonly engine: ConversationEngine;

  constructor(
    private readonly auth: AuthService,
    private readonly crm: CrmService,
    private readonly orders: OrdersService,
    private readonly providers: TenantNotificationProviderManager,
    private readonly customerIdentity: CustomerIdentityService,
    private readonly tenants: TenantService,
    private readonly customerQuotes: CustomerQuoteService
  ) {
    this.engine = new ConversationEngine(this.buildPorts(), new InMemorySessionStore<BotSession>());
  }

  /** Processes every inbound message in a verified webhook body. Never throws. */
  async handleWebhook(body: unknown): Promise<{ received: number; handled: number }> {
    const messages = parseInboundMessages(body);
    let handled = 0;
    for (const message of messages) {
      if (webhookDeduplication.isDuplicate(`msg:${message.id}`)) continue;
      try {
        await this.handleMessage(message);
        handled += 1;
      } catch (err: any) {
        // Swallow: a 5xx makes the provider retry the whole batch and re-run earlier messages.
        this.logger.error(`Bot failed for message ${message.id}: ${err?.message ?? err}`);
      }
    }
    return { received: messages.length, handled };
  }

  async handleMessage(message: InboundMessage): Promise<void> {
    const { replies, tenantId } = await this.engine.handle(message);
    // Replies go out inside the 24h customer-service window, so free-form text is allowed.
    const adapter = this.providers.getAdapterForTenant(tenantId ?? 'default');
    for (const text of replies) {
      const result = await adapter.sendMessage({
        tenantId: tenantId ?? 'default',
        recipient: message.from,
        message: text,
        channel: 'WHATSAPP',
      });
      if (!result.success) {
        this.logger.warn(`Reply to ${message.from} failed via ${result.provider}: ${result.error}`);
        break;
      }
    }
  }

  private buildPorts(): BotPorts {
    const need = (role: string, action: Parameters<typeof hasPermission>[1]) => {
      if (!hasPermission(role, action)) throw new ForbiddenException(`Role ${role} lacks ${action}`);
    };

    return {
      findStaffByPhone: (phone) => this.auth.findStaffByPhone(phone),

      findCustomerByPhone: (phone) => this.customerIdentity.findByPhone(phone),

      // Scoped by tenantId AND customerId taken from the verified phone lookup, never from message text.
      listCustomerOrders: async (who) => {
        const rows = await this.orders.getOrdersForCustomer(who.tenantId, who.customerId, 50);
        return rows.map((r) => ({
          id: r.id,
          orderNumber: r.orderNumber,
          productionStage: r.productionStage,
          totalAmount: r.totalAmount ?? null,
          advanceReceived: r.advanceReceived ?? null,
          balanceDue: r.balanceDue ?? null,
          expectedDeliveryAt: r.expectedDeliveryAt ?? null,
        }));
      },

      // Quote decisions: tenantId/customerId come from the verified phone lookup, never from message text.
      listCustomerQuotes: (who) => this.customerQuotes.listForCustomer(who.tenantId, who.customerId),

      approveCustomerQuote: (who, quoteId, expectedTotal, ctx) =>
        this.customerQuotes.approve(who.tenantId, who.customerId, who.industryKey, quoteId, expectedTotal, ctx),

      requestQuoteChange: (who, quoteId, text, ctx) =>
        this.customerQuotes.requestChange(who.tenantId, who.customerId, quoteId, text, ctx),

      setPreferredLanguage: (userId, locale) => this.auth.setPreferredLanguage(userId, locale),

      getCustomerSelfService: async (who) => {
        need(who.role, 'settings:manage');
        return (await this.tenants.getSettings(who.tenantId)).customerSelfServiceEnabled;
      },

      setCustomerSelfService: async (who, enabled) => {
        need(who.role, 'settings:manage');
        await this.tenants.updateSettings(who.tenantId, who.userId, { customerSelfServiceEnabled: enabled }, 'WHATSAPP');
      },

      createLead: async (who, input) => {
        need(who.role, 'lead:create');
        await this.crm.intakeLead(who.tenantId, who.userId, undefined, {
          name: input.customerName,
          phone: input.customerPhone,
          title: input.title,
          notes: input.notes,
          source: 'WHATSAPP',
          stage: 'NEW',
          priority: 'MEDIUM',
          customData: input.customData,
        });
      },

      findOrders: async (who, query): Promise<OrderSummary[]> => {
        need(who.role, 'order:view');
        // getOrders applies role-based money masking (balanceDue is null without payment:view).
        // TODO(scale): push this search into SQL (ILIKE on order_number / customer name) instead of filtering in memory.
        const rows: any[] = await this.orders.getOrders(who.tenantId, undefined, who.role);
        const q = query.trim().toLowerCase();
        return rows
          .filter(
            (r) =>
              String(r.orderNumber ?? '').toLowerCase().includes(q) ||
              String(r.customer?.name ?? '').toLowerCase().includes(q) ||
              String(r.customer?.companyName ?? '').toLowerCase().includes(q)
          )
          .sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0))
          .map((r) => ({
            id: r.id,
            orderNumber: r.orderNumber,
            customerName: r.customer?.name ?? 'Customer',
            productionStage: r.productionStage,
            balanceDue: r.balanceDue ?? null,
          }));
      },

      updateOrderStage: async (who, orderId, stageId) => {
        need(who.role, 'order:update_stage');
        await this.orders.updateOrderStage(who.tenantId, who.userId, orderId, stageId);
      },

      // Same service as the web API, so validation (no overpayment, duplicate references), receipt numbering,
      // balances and the customer's PAYMENT_RECEIPT message behave identically from WhatsApp.
      recordPayment: async (who, orderId, input) => {
        need(who.role, 'payment:create');
        const result: any = await this.orders.recordPayment(
          who.tenantId,
          who.userId,
          orderId,
          {
            amount: Number(input.amount),
            mode: input.mode,
            referenceNo: input.referenceNo,
            notes: 'Recorded via WhatsApp',
          } as any,
          input.idempotencyKey
        );
        return {
          receiptNumber: result.payment?.receiptNumber,
          balanceRemaining: result.order?.balanceDue ?? null,
        };
      },
    };
  }
}
