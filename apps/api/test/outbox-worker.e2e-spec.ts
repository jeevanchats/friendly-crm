import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { OutboxWorker } from '../src/modules/notifications/outbox-worker.service';
import { globalMemoryOutbox } from '../src/modules/crm/memory-store';

describe('Outbox worker', () => {
  let worker: OutboxWorker;
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
});
