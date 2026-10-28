import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';

const TICK_MS = 5_000;
/** A failed send waits this long before its next attempt, so a short provider outage does not burn all retries. */
const RETRY_DELAY_MS = 60_000;
const BATCH = 20;

/**
 * Drains the notification outbox in the background so queued WhatsApp messages (stage updates, receipts,
 * reminders) are actually delivered. Runs in every API process; with several instances, jobs could be picked
 * up twice, so run a single API instance until jobs are claimed atomically.
 * Off in tests; set OUTBOX_WORKER_ENABLED=false to disable it elsewhere.
 */
@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly outbox: NotificationOutboxService) {}

  static isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NODE_ENV !== 'test' && env.OUTBOX_WORKER_ENABLED !== 'false';
  }

  onModuleInit() {
    if (!OutboxWorker.isEnabled()) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref(); // never keep the process alive on its own
    this.logger.log(`Outbox worker started (every ${TICK_MS / 1000}s)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Skipped if the previous pass is still running; errors are logged, never thrown. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.outbox.processOutbox(undefined, BATCH, RETRY_DELAY_MS);
      if (r.processed > 0) {
        this.logger.log(`Outbox: ${r.sent} sent, ${r.failed} to retry, ${r.deadLetter} dead-lettered`);
      }
    } catch (err: any) {
      this.logger.error(`Outbox pass failed: ${err.message}`);
    } finally {
      this.running = false;
    }
  }
}
