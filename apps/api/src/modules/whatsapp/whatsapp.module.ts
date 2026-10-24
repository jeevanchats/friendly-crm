import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { OrdersModule } from '../orders/orders.module';
import { TenantModule } from '../tenant/tenant.module';
import { WhatsAppBotService } from './bot/whatsapp-bot.service';
import { CustomerIdentityService } from './bot/customer-identity.service';

/**
 * Inbound WhatsApp bot. AuthService and the notification provider manager come from
 * their @Global() modules (AuthModule, NotificationsModule).
 */
@Module({
  imports: [CrmModule, OrdersModule, TenantModule],
  providers: [WhatsAppBotService, CustomerIdentityService],
  exports: [WhatsAppBotService],
})
export class WhatsAppModule {}
