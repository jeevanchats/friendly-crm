import { Module, Global } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';
import { OutboxWorker } from './outbox-worker.service';
import { NotificationsController } from './notifications.controller';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { TwilioWebhookController } from './twilio-webhook.controller';
import { TemplateEngine } from './templates/template-engine';
import { DevNotificationAdapter } from './adapters/dev-notification.adapter';
import { HttpWhatsAppAdapter } from './adapters/http-whatsapp.adapter';
import { TenantNotificationProviderManager } from './adapters/tenant-provider-manager';
import { DevEmailAdapter } from './adapters/dev-email.adapter';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Global()
@Module({
  imports: [WhatsAppModule],
  controllers: [NotificationsController, WhatsAppWebhookController, TwilioWebhookController],
  providers: [
    NotificationOutboxService,
    OutboxWorker,
    TemplateEngine,
    DevNotificationAdapter,
    HttpWhatsAppAdapter,
    TenantNotificationProviderManager,
    DevEmailAdapter,
  ],
  exports: [
    NotificationOutboxService,
    TemplateEngine,
    TenantNotificationProviderManager,
    DevEmailAdapter,
  ],
})
export class NotificationsModule {}
