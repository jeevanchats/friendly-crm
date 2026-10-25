import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql, eq, and, or, lt, desc } from 'drizzle-orm';
import { db, notificationOutbox } from '@friendly-crm/db';
import { tenantContextStorage } from '../../common/interceptors/tenant-rls.interceptor';
import { TemplateEngine } from './templates/template-engine';
import {
  INotificationAdapter,
  NotificationChannel,
} from './adapters/notification-adapter.interface';
import { DevNotificationAdapter } from './adapters/dev-notification.adapter';
import { HttpWhatsAppAdapter } from './adapters/http-whatsapp.adapter';
import { globalMemoryOutbox } from '../crm/memory-store';
import { randomUUID } from 'crypto';

export interface EnqueueNotificationOptions {
  tenantId: string;
  recipient: string;
  channel?: NotificationChannel;
  templateKey?: string;
  rawMessage?: string;
  params?: Record<string, any>;
  mediaUrl?: string | null;
  lang?: 'en' | 'ta';
  maxAttempts?: number;
}

@Injectable()
export class NotificationOutboxService {
  private readonly logger = new Logger(NotificationOutboxService.name);
  private readonly devAdapter = new DevNotificationAdapter();
  private readonly httpWhatsAppAdapter = new HttpWhatsAppAdapter();

  constructor(private readonly templateEngine: TemplateEngine) {}

  private getDb() {
    return tenantContextStorage.getStore()?.tx || db;
  }

  /**
   * Resolves the active notification provider.
   * If in test mode or if external provider URL is unconfigured, uses DevNotificationAdapter sandbox.
   */
  public getAdapter(): INotificationAdapter {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.ENABLE_DEV_SMS_GATEWAY === 'true' ||
      !process.env.HOSTINGER_WHATSAPP_API_URL
    ) {
      return this.devAdapter;
    }
    return this.httpWhatsAppAdapter;
  }

  /**
   * Enqueues an outbound notification asynchronously.
   * Renders the template with default fallbacks and persists to the outbox.
   * Guarantees zero blocking / zero rollback for the caller transaction.
   */
  async enqueueNotification(options: EnqueueNotificationOptions) {
    const channel = options.channel || 'WHATSAPP';
    const lang = options.lang || 'en';
    const maxAttempts = options.maxAttempts || 3;
    const recipient = options.recipient;

    // Render message from template or raw message with safe fallbacks
    const renderedMessage = options.templateKey
      ? this.templateEngine.renderTemplate(options.templateKey, lang, options.params || {})
      : options.rawMessage || '';

    const jobId = randomUUID();

    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.transaction === 'function') {
        const [inserted] = await activeDb
          .insert(notificationOutbox)
          .values({
            id: jobId,
            tenantId: options.tenantId,
            channel,
            recipient,
            templateKey: options.templateKey || null,
            payload: options.params || {},
            renderedMessage,
            mediaUrl: options.mediaUrl || null,
            status: 'PENDING',
            attempts: 0,
            maxAttempts,
          })
          .returning();

        this.logger.log(`[OUTBOX] Enqueued notification ${jobId} for ${channel} to tenant ${options.tenantId}`);
        return inserted;
      }
    } catch (err: any) {
      this.logger.warn(`Postgres offline; utilizing memory fallback for outbox: ${err.message}`);
    }

    // Unified Memory Fallback
    const job = {
      id: jobId,
      tenantId: options.tenantId,
      channel,
      recipient,
      templateKey: options.templateKey || null,
      payload: options.params || {},
      renderedMessage,
      mediaUrl: options.mediaUrl || null,
      status: 'PENDING',
      attempts: 0,
      maxAttempts,
      lastError: null,
      scheduledAt: new Date(),
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    globalMemoryOutbox.unshift(job);
    return job;
  }

  /**
   * Dispatches a single outbox job via the active adapter and tracks retry / dead-letter status.
   */
  async dispatchJob(jobId: string, tenantId?: string) {
    let job: any;

    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.select === 'function') {
        const conditions = [eq(notificationOutbox.id, jobId)];
        if (tenantId) conditions.push(eq(notificationOutbox.tenantId, tenantId));

        const [dbJob] = await activeDb
          .select()
          .from(notificationOutbox)
          .where(and(...conditions))
          .limit(1);

        job = dbJob;
      }
    } catch {
      // Fallback to memory
    }

    if (!job) {
      job = globalMemoryOutbox.find(
        (j) => j.id === jobId && (!tenantId || j.tenantId === tenantId)
      );
    }

    if (!job) {
      throw new NotFoundException(`Outbox job ${jobId} not found`);
    }

    const adapter = this.getAdapter();
    const result = await adapter.sendMessage({
      tenantId: job.tenantId,
      recipient: job.recipient,
      message: job.renderedMessage,
      mediaUrl: job.mediaUrl,
      channel: job.channel as NotificationChannel,
    });

    const newAttempts = (job.attempts || 0) + 1;
    let newStatus = job.status;
    let sentAt = job.sentAt;
    let lastError = job.lastError;

    if (result.success) {
      newStatus = 'SENT';
      sentAt = new Date();
      lastError = null;
    } else {
      lastError = result.error || 'Dispatch failed';
      if (newAttempts >= (job.maxAttempts || 3)) {
        newStatus = 'DEAD_LETTER';
        this.logger.error(`[OUTBOX] Job ${jobId} moved to DEAD_LETTER after ${newAttempts} attempts: ${lastError}`);
      } else {
        newStatus = 'FAILED';
      }
    }

    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.update === 'function') {
        const [updated] = await activeDb
          .update(notificationOutbox)
          .set({
            status: newStatus,
            attempts: newAttempts,
            sentAt,
            lastError,
            updatedAt: new Date(),
          })
          .where(eq(notificationOutbox.id, jobId))
          .returning();

        return updated;
      }
    } catch {
      // Memory fallback update
    }

    job.status = newStatus;
    job.attempts = newAttempts;
    job.sentAt = sentAt;
    job.lastError = lastError;
    job.updatedAt = new Date();

    return job;
  }

  /**
   * Processes a batch of pending or retryable outbox jobs. `retryDelayMs` holds a FAILED job back until it
   * has waited that long since its last attempt (0 = retry immediately, the manual-trigger behaviour).
   */
  async processOutbox(tenantId?: string, limit = 20, retryDelayMs = 0) {
    let pendingJobs: any[] = [];
    const retryCutoff = new Date(Date.now() - retryDelayMs);

    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.select === 'function') {
        const whereConds = [
          or(
            eq(notificationOutbox.status, 'PENDING'),
            and(
              eq(notificationOutbox.status, 'FAILED'),
              lt(notificationOutbox.attempts, notificationOutbox.maxAttempts),
              lt(notificationOutbox.updatedAt, retryCutoff)
            )
          ),
        ];
        if (tenantId) whereConds.push(eq(notificationOutbox.tenantId, tenantId));

        pendingJobs = await activeDb
          .select()
          .from(notificationOutbox)
          .where(and(...whereConds))
          .limit(limit);
      }
    } catch {
      // Memory fallback
    }

    if (pendingJobs.length === 0) {
      pendingJobs = globalMemoryOutbox
        .filter(
          (j) =>
            (!tenantId || j.tenantId === tenantId) &&
            (j.status === 'PENDING' ||
              (j.status === 'FAILED' && j.attempts < j.maxAttempts && new Date(j.updatedAt) < retryCutoff))
        )
        .slice(0, limit);
    }

    const summary = {
      processed: 0,
      sent: 0,
      failed: 0,
      deadLetter: 0,
    };

    for (const job of pendingJobs) {
      summary.processed++;
      const res = await this.dispatchJob(job.id, job.tenantId);
      if (res.status === 'SENT') summary.sent++;
      else if (res.status === 'DEAD_LETTER') summary.deadLetter++;
      else summary.failed++;
    }

    return summary;
  }

  /**
   * Retrieves outbox history for tenant monitoring.
   */
  async getOutboxJobs(tenantId: string, status?: string) {
    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.select === 'function') {
        const conds = [eq(notificationOutbox.tenantId, tenantId)];
        if (status) conds.push(eq(notificationOutbox.status, status));

        return await activeDb
          .select()
          .from(notificationOutbox)
          .where(and(...conds))
          .orderBy(desc(notificationOutbox.createdAt))
          .limit(50);
      }
    } catch {
      // Memory fallback
    }

    let list = globalMemoryOutbox.filter((j) => j.tenantId === tenantId);
    if (status) {
      list = list.filter((j) => j.status === status);
    }
    return list;
  }

  /**
   * Re-queues a DEAD_LETTER notification for retry.
   */
  async retryDeadLetterJob(tenantId: string, jobId: string) {
    let job: any;

    try {
      const activeDb = this.getDb();
      if (typeof activeDb?.update === 'function') {
        const [updated] = await activeDb
          .update(notificationOutbox)
          .set({
            status: 'PENDING',
            attempts: 0,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(and(eq(notificationOutbox.id, jobId), eq(notificationOutbox.tenantId, tenantId)))
          .returning();

        job = updated;
      }
    } catch {
      // Memory fallback
    }

    if (!job) {
      job = globalMemoryOutbox.find(
        (j) => j.id === jobId && j.tenantId === tenantId
      );
      if (job) {
        job.status = 'PENDING';
        job.attempts = 0;
        job.lastError = null;
        job.updatedAt = new Date();
      }
    }

    if (!job) {
      throw new NotFoundException(`Dead-letter job ${jobId} not found in this tenant`);
    }

    return job;
  }

  /**
   * 6. Handle webhook delivery status callback (DELIVERED, READ, FAILED)
   */
  async handleDeliveryCallback(
    providerMessageId: string,
    status: 'DELIVERED' | 'READ' | 'FAILED',
    metadata?: any
  ): Promise<boolean> {
    try {
      if (typeof db?.transaction === 'function') {
        const [updated] = await db
          .update(notificationOutbox)
          .set({
            status: status === 'FAILED' ? 'DEAD_LETTER' : status,
            processedAt: new Date(),
          })
          .where(sql`${notificationOutbox.id}::text = ${providerMessageId} OR ${notificationOutbox.lastError} LIKE ${`%${providerMessageId}%`}`)
          .returning();
        if (updated) return true;
      }
    } catch (err: any) {
      this.logger.warn(`Failed DB callback update: ${err.message}`);
    }

    // Memory fallback update
    const job = globalMemoryOutbox.find(
      (j) => j.id === providerMessageId || j.error?.includes(providerMessageId)
    );
    if (job) {
      job.status = status === 'FAILED' ? 'DEAD_LETTER' : (status as any);
      job.processedAt = new Date();
      return true;
    }
    return false;
  }
}
