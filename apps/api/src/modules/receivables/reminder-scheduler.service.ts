import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReceivablesService } from './receivables.service';

const TICK_MS = 10 * 60 * 1000;

/**
 * Runs the automatic payment reminders every ten minutes. Each pass only sends inside the 09:00-19:00 India
 * time window and only for businesses that turned reminders on, so a frequent tick is cheap.
 * Off in tests; set REMINDER_SCHEDULER_ENABLED=false to disable it elsewhere.
 */
@Injectable()
export class ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly receivables: ReceivablesService) {}

  static isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NODE_ENV !== 'test' && env.REMINDER_SCHEDULER_ENABLED !== 'false';
  }

  onModuleInit() {
    if (!ReminderScheduler.isEnabled()) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    this.logger.log('Payment reminder scheduler started (every 10 minutes)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.receivables.runAutoReminders(now);
      if (r.sent > 0 || r.failed > 0) {
        this.logger.log(`Auto reminders: ${r.sent} sent, ${r.failed} failed across ${r.tenants} business(es)`);
      }
    } catch (err: any) {
      this.logger.error(`Auto reminder pass failed: ${err.message}`);
    } finally {
      this.running = false;
    }
  }
}
