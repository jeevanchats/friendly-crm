import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { OutboxWorker } from '../src/modules/notifications/outbox-worker.service';
import { NotificationOutboxService, SENDING_LEASE_MS } from '../src/modules/notifications/notification-outbox.service';
import { DevNotificationAdapter } from '../src/modules/notifications/adapters/dev-notification.adapter';
import { globalMemoryOutbox } from '../src/modules/crm/memory-store';

describe('Outbox worker', () => {
  let worker: OutboxWorker;
  let outbox: NotificationOutboxService;
  let fixture: TestingModule;
  const TENANT = '94949494-9494-4949-8949-949494949494';

  const job = (id: string, status: string, attempts: number, updatedAgoMs: number) => {
    const j: any = {
      id,
      tenantId: TENANT,
      channel: 'WHATSAPP',
      recipient: '+919840950001',
      templateKey: null,
      payload: {},
      renderedMessage: `msg ${id}`,
      mediaUrl: null,
      status,
      attempts,
      maxAttempts: 3,
      lastError: status === 'FAILED' ? 'provider down' : null,
      scheduledAt: new Date(),
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(Date.now() - updatedAgoMs),
    };
    globalMemoryOutbox.unshift(j);
    return j;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await fixture.init();
    worker = fixture.get(OutboxWorker);
    outbox = fixture.get(NotificationOutboxService);
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('is off in tests and when disabled, on otherwise', () => {
    expect(OutboxWorker.isEnabled({ NODE_ENV: 'test' } as any)).toBe(false);
    expect(OutboxWorker.isEnabled({ NODE_ENV: 'production', OUTBOX_WORKER_ENABLED: 'false' } as any)).toBe(false);
    expect(OutboxWorker.isEnabled({ NODE_ENV: 'production' } as any)).toBe(true);
    expect(OutboxWorker.isEnabled({} as any)).toBe(true);
  });

  it('delivers pending jobs', async () => {
    const pending = job('w-pending', 'PENDING', 0, 0);
    await worker.tick();
    expect(pending.status).toBe('SENT');
    expect(pending.attempts).toBe(1);
  });

  it('holds a freshly failed job back, then retries it once the delay has passed', async () => {
    const fresh = job('w-fresh-fail', 'FAILED', 1, 1_000);
    const stale = job('w-stale-fail', 'FAILED', 1, 120_000);
    await worker.tick();
    expect(fresh.status).toBe('FAILED');
    expect(fresh.attempts).toBe(1);
    expect(stale.status).toBe('SENT');
  });

  it('never touches dead-lettered or already sent jobs', async () => {
    const dead = job('w-dead', 'DEAD_LETTER', 3, 120_000);
    const sent = job('w-sent', 'SENT', 1, 120_000);
    await worker.tick();
    expect(dead.status).toBe('DEAD_LETTER');
    expect(dead.attempts).toBe(3);
    expect(sent.attempts).toBe(1);
  });

  it('does not overlap passes', async () => {
    job('w-overlap', 'PENDING', 0, 0);
    await Promise.all([worker.tick(), worker.tick()]);
    const j = globalMemoryOutbox.find((x: any) => x.id === 'w-overlap')!;
    expect(j.status).toBe('SENT');
    expect(j.attempts).toBe(1);
  });

  describe('claiming', () => {
    const sends = () => DevNotificationAdapter.capturedMessages.length;

    it('sends a job once even when several workers race for it', async () => {
      const j = job('c-race', 'PENDING', 0, 0);
      const before = sends();
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => outbox.dispatchJob(j.id, TENANT)));
      expect(sends() - before).toBe(1);
      expect(j.status).toBe('SENT');
      expect(j.attempts).toBe(1);
      expect(results.filter((r: any) => r.status === 'SENT').length).toBeGreaterThanOrEqual(1);
    });

    it('does not resend a job that is already sent or dead-lettered', async () => {
      const sent = job('c-sent', 'SENT', 1, 0);
      const dead = job('c-dead', 'DEAD_LETTER', 3, 0);
      const before = sends();
      await outbox.dispatchJob(sent.id, TENANT);
      await outbox.dispatchJob(dead.id, TENANT);
      expect(sends()).toBe(before);
      expect(sent.attempts).toBe(1);
      expect(dead.status).toBe('DEAD_LETTER');
    });

    it('leaves a job another worker is sending alone, until its lease expires', async () => {
      const busy = job('c-busy', 'SENDING', 0, 1_000);
      const before = sends();
      await worker.tick();
      expect(sends()).toBe(before);
      expect(busy.status).toBe('SENDING');

      const abandoned = job('c-abandoned', 'SENDING', 0, SENDING_LEASE_MS + 1_000);
      await worker.tick();
      expect(abandoned.status).toBe('SENT');
    });

    it('turns an adapter that throws into a retry instead of leaving the job stuck', async () => {
      const j = job('c-throw', 'PENDING', 0, 0);
      const adapter: any = outbox.getAdapter();
      const original = adapter.sendMessage;
      adapter.sendMessage = async () => {
        throw new Error('boom');
      };
      try {
        const res: any = await outbox.dispatchJob(j.id, TENANT);
        expect(res.status).toBe('FAILED');
        expect(j.lastError).toBe('boom');
        expect(j.attempts).toBe(1);
      } finally {
        adapter.sendMessage = original;
      }
    });
  });
});
