import { Module, Global } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationsController } from './notifications.controller';
import { TemplateEngine } from './templates/template-engine';
import { DevNotificationAdapter } from './adapters/dev-notification.adapter';
import { HttpWhatsAppAdapter } from './adapters/http-whatsapp.adapter';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationOutboxService,
    TemplateEngine,
    DevNotificationAdapter,
    HttpWhatsAppAdapter,
  ],
  exports: [NotificationOutboxService, TemplateEngine],
})
export class NotificationsModule {}
