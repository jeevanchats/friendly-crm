import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';
import {
  AuthGuard,
  TenantGuard,
  PermissionsGuard,
  RequirePermission,
  TenantRlsInterceptor,
  AuditInterceptor,
  CurrentTenant,
} from '../../common';

@Controller('notifications/outbox')
@UseGuards(AuthGuard, TenantGuard, PermissionsGuard)
@UseInterceptors(TenantRlsInterceptor, AuditInterceptor)
export class NotificationsController {
  constructor(private readonly outboxService: NotificationOutboxService) {}

  /**
   * 1. GET /api/notifications/outbox
   * Query queued, sent, and dead-letter notifications for tenant
   */
  @Get()
  @RequirePermission('tenant:read')
  async getOutboxJobs(
    @CurrentTenant() tenant: { id: string },
    @Query('status') status?: string
  ) {
    return this.outboxService.getOutboxJobs(tenant.id, status);
  }

  /**
   * 2. POST /api/notifications/outbox/process
   * Manually trigger background outbox processor batch
   */
  @Post('process')
  @RequirePermission('tenant:read')
  async processOutbox(
    @CurrentTenant() tenant: { id: string },
    @Query('limit') limit?: string
  ) {
    const lim = limit ? parseInt(limit, 10) : 20;
    return this.outboxService.processOutbox(tenant.id, lim);
  }

  /**
   * 3. POST /api/notifications/outbox/:id/retry
   * Re-queue a DEAD_LETTER notification for retry
   */
  @Post(':id/retry')
  @RequirePermission('tenant:read')
  async retryDeadLetterJob(
    @CurrentTenant() tenant: { id: string },
    @Param('id') jobId: string
  ) {
    return this.outboxService.retryDeadLetterJob(tenant.id, jobId);
  }
}
