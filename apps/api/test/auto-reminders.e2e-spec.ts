import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/modules/auth/auth.service';
import { DevSmsGateway } from '../src/modules/auth/sms-gateway';
import {
  DueCustomer,
  ReceivablesService,
  inSendWindow,
  isDueForAutoReminder,
} from '../src/modules/receivables/receivables.service';
import { ReminderScheduler } from '../src/modules/receivables/reminder-scheduler.service';
import {
  globalMemoryTenants,
  globalMemoryCustomers,
  globalMemoryOrders,
  globalMemoryActivities,
  globalMemoryOutbox,
} from '../src/modules/crm/memory-store';

const DAY = 86_400_000;

describe('send window (India time)', () => {
  it('allows 09:00 up to but not including 19:00 IST', () => {
    expect(inSendWindow(new Date('2031-01-01T03:29:00Z'))).toBe(false); // 08:59 IST
    expect(inSendWindow(new Date('2031-01-01T03:30:00Z'))).toBe(true); // 09:00 IST
    expect(inSendWindow(new Date('2031-01-01T13:29:00Z'))).toBe(true); // 18:59 IST
    expect(inSendWindow(new Date('2031-01-01T13:30:00Z'))).toBe(false); // 19:00 IST
    expect(inSendWindow(new Date('2031-01-01T20:00:00Z'))).toBe(false); // 01:30 IST next day
  });
});

describe('isDueForAutoReminder', () => {
  const now = new Date('2031-03-10T05:00:00Z');
  const sched = { afterDays: 7, repeatDays: 7, maxCount: 3 };
  const cust = (over: Partial<DueCustomer> = {}): DueCustomer => ({
    customerId: 'c',
    name: 'C',
    companyName: null,
    phone: '+919840000001',
    totalDue: '1000.00',
    openingBalance: '0.00',
    oldestAgeDays: 10,
    bucket: '0-30',
    orders: [],
    lastReminderAt: null,
    autoRemindersSent: 0,
    remindersOptOut: false,
    ...over,
  });
  const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

  it('reminds an old enough debt that has never been reminded', () => {
    expect(isDueForAutoReminder(cust(), sched, now)).toBe(true);
    expect(isDueForAutoReminder(cust({ oldestAgeDays: 7 }), sched, now)).toBe(true);
  });

  it('waits until the debt is old enough', () => {
    expect(isDueForAutoReminder(cust({ oldestAgeDays: 6 }), sched, now)).toBe(false);
  });

  it('waits for the repeat interval after any earlier reminder, manual or automatic', () => {
    expect(isDueForAutoReminder(cust({ lastReminderAt: ago(6) }), sched, now)).toBe(false);
    expect(isDueForAutoReminder(cust({ lastReminderAt: ago(7) }), sched, now)).toBe(true);
  });

  it('stops at the cap, and for opted-out, phone-less or settled customers', () => {
    expect(isDueForAutoReminder(cust({ autoRemindersSent: 3, lastReminderAt: ago(30) }), sched, now)).toBe(false);
    expect(isDueForAutoReminder(cust({ autoRemindersSent: 2, lastReminderAt: ago(30) }), sched, now)).toBe(true);
    expect(isDueForAutoReminder(cust({ remindersOptOut: true }), sched, now)).toBe(false);
    expect(isDueForAutoReminder(cust({ phone: '' }), sched, now)).toBe(false);
    expect(isDueForAutoReminder(cust({ totalDue: '0.00' }), sched, now)).toBe(false);
  });
});

describe('Automatic payment reminders', () => {
  let app: INestApplication;
  let baseUrl: string;
  let receivables: ReceivablesService;
  let scheduler: ReminderScheduler;

  const ON = '91919191-9191-4919-8919-919191919191';
  const OFF = '90909090-9090-4909-8909-909090909090';
  const OWNER = '11111111-9191-4919-8919-919191919191';
  let ownerToken: string;

  // 10:00 IST today, comfortably inside the send window
  const base = new Date();
  const now = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 4, 30));

  let seq = 0;
  const addDebtor = (
    tenantId: string,
    name: string,
    ageDays: number,
    opts: { phone?: string | null; optOut?: boolean; reminders?: Array<{ daysAgo: number; auto: boolean }>; balance?: string } = {}
  ) => {
    const id = `cust-auto-${++seq}`;
    const phone = opts.phone === undefined ? `+9198409700${String(seq).padStart(2, '0')}` : opts.phone;
    globalMemoryCustomers.push({
      id,
      tenantId,
      name,
      phone: phone as any,
      whatsappNumber: phone as any,
      remindersOptOut: opts.optOut === true,
      openingBalance: '0.00',
      creditLimit: '0.00',
      activeOrdersCount: 0,
      totalReceivable: '0.00',
      createdAt: new Date(),
    } as any);
    globalMemoryOrders.push({
      id: `ord-auto-${seq}`,
      tenantId,
      orderNumber: `ORD-AUTO-${seq}`,
      customerId: id,
      productionStage: 'ORDER_CONFIRMED',
      totalAmount: '5000.00',
      advanceReceived: '0.00',
      balanceDue: opts.balance ?? '5000.00',
      createdAt: new Date(now.getTime() - ageDays * DAY),
      updatedAt: new Date(),
    } as any);
    for (const r of opts.reminders ?? []) {
      globalMemoryActivities.push({
        id: `act-auto-${seq}-${r.daysAgo}`,
        tenantId,
        actorId: null,
        entityType: 'CUSTOMER',
        entityId: id,
        action: 'PAYMENT_REMINDER_SENT',
        metadata: { auto: r.auto },
        createdAt: new Date(now.getTime() - r.daysAgo * DAY),
      } as any);
    }
    return { id, phone };
  };

  const sentTo = () => globalMemoryOutbox.filter((j: any) => j.tenantId === ON).map((j: any) => j.recipient);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_DEV_SMS_GATEWAY = 'true';
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    baseUrl = await app.getUrl();
    receivables = fixture.get(ReceivablesService);
    scheduler = fixture.get(ReminderScheduler);
    const auth = fixture.get(AuthService);

    globalMemoryTenants.set(ON, {
      id: ON,
      name: 'Auto Remind Press',
      industryKey: 'printing',
      defaultLanguage: 'en',
      phone: '+919999922222',
      upiId: 'autopress@okhdfc',
      isActive: true,
      autoRemindersEnabled: true,
      reminderAfterDays: 7,
      reminderRepeatDays: 7,
      reminderMaxCount: 3,
    } as any);
    globalMemoryTenants.set(OFF, {
      id: OFF,
      name: 'Quiet Press',
      industryKey: 'printing',
      defaultLanguage: 'en',
      phone: '+919999933333',
      isActive: true,
      autoRemindersEnabled: false,
    } as any);

    auth.registerUser({ id: OWNER, fullName: 'Auto Owner', phone: '+919840970001' });
    auth.registerMembership(ON, OWNER, 'OWNER', true);
    await auth.requestOtp({ phone: '+919840970001', countryCode: '+91' });
    const code = DevSmsGateway.getLatestOtp(auth.normalizePhone('+919840970001'))!;
    ownerToken = (await auth.verifyOtp({ phone: '+919840970001', code, tenantId: ON })).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('is off in tests and when disabled, on otherwise', () => {
    expect(ReminderScheduler.isEnabled({ NODE_ENV: 'test' } as any)).toBe(false);
    expect(ReminderScheduler.isEnabled({ NODE_ENV: 'production', REMINDER_SCHEDULER_ENABLED: 'false' } as any)).toBe(false);
    expect(ReminderScheduler.isEnabled({ NODE_ENV: 'production' } as any)).toBe(true);
  });

  it('reminds only the customers who are due, and never twice', async () => {
    const a = addDebtor(ON, 'Due A', 10);
    const b = addDebtor(ON, 'Too Recent B', 3);
    const c = addDebtor(ON, 'Opted Out C', 10, { optOut: true });
    const d = addDebtor(ON, 'Manual Yesterday D', 10, { reminders: [{ daysAgo: 2, auto: false }] });
    const e = addDebtor(ON, 'Capped E', 30, { reminders: [{ daysAgo: 20, auto: true }, { daysAgo: 13, auto: true }, { daysAgo: 8, auto: true }] });
    const f = addDebtor(ON, 'Second Nudge F', 30, { reminders: [{ daysAgo: 8, auto: true }] });
    const g = addDebtor(ON, 'No Phone G', 10, { phone: null });
    const off = addDebtor(OFF, 'Other Business', 40);

    const before = globalMemoryOutbox.length;
    const run1 = await receivables.runAutoReminders(now);
    expect(run1).toMatchObject({ tenants: 1, sent: 2, failed: 0 });
    expect(globalMemoryOutbox.length - before).toBe(2);
    expect(sentTo().sort()).toEqual([a.phone, f.phone].sort());
    for (const p of [b.phone, c.phone, d.phone, e.phone, off.phone]) expect(sentTo()).not.toContain(p);
    void g;

    const msg = (globalMemoryOutbox.find((j: any) => j.recipient === a.phone) as any).renderedMessage;
    expect(msg).toContain('ORD-AUTO');
    expect(msg).toContain('upi://pay?pa=autopress%40okhdfc');

    // The reminders are recorded as automatic, and delivered by the outbox
    const logged = globalMemoryActivities.filter((x: any) => x.entityId === a.id && x.action === 'PAYMENT_REMINDER_SENT');
    expect(logged).toHaveLength(1);
    expect((logged[0] as any).metadata.auto).toBe(true);
    expect((globalMemoryOutbox.find((j: any) => j.recipient === a.phone) as any).status).toBe('SENT');

    // A second pass right away sends nothing
    const run2 = await receivables.runAutoReminders(now);
    expect(run2.sent).toBe(0);
    expect(globalMemoryOutbox.length - before).toBe(2);
  });

  it('sends the next nudge after the repeat interval, until the cap', async () => {
    const x = addDebtor(ON, 'Repeating X', 20);
    const t0 = globalMemoryOutbox.length;
    const day = (n: number) => new Date(now.getTime() + n * DAY);

    expect((await receivables.runAutoReminders(day(0))).sent).toBeGreaterThanOrEqual(1); // first
    expect((await receivables.runAutoReminders(day(3))).sent).toBe(0); // too soon
    await receivables.runAutoReminders(day(8)); // second
    await receivables.runAutoReminders(day(16)); // third
    await receivables.runAutoReminders(day(24)); // cap reached
    await receivables.runAutoReminders(day(40)); // still capped
    expect(globalMemoryOutbox.slice(0, globalMemoryOutbox.length - t0).filter((j: any) => j.recipient === x.phone)).toHaveLength(3);
  });

  it('does nothing outside the send window', async () => {
    addDebtor(ON, 'Night Y', 15);
    const night = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 0)); // 01:30 IST
    const before = globalMemoryOutbox.length;
    expect(await receivables.runAutoReminders(night)).toEqual({ tenants: 0, sent: 0, skipped: 0, failed: 0 });
    expect(globalMemoryOutbox.length).toBe(before);
  });

  it('lets two simultaneous passes send only once', async () => {
    const z = addDebtor(ON, 'Race Z', 15);
    const before = globalMemoryOutbox.length;
    await Promise.all([receivables.runAutoReminders(now), receivables.runAutoReminders(now), scheduler.tick(now)]);
    expect(globalMemoryOutbox.slice(0, globalMemoryOutbox.length - before).filter((j: any) => j.recipient === z.phone).length).toBeLessThanOrEqual(1);
  });

  describe('settings and opt-out', () => {
    const patch = (path: string, body: unknown) =>
      fetch(`${baseUrl}/api${path}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${ownerToken}`, 'x-tenant-id': ON, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('validates and saves the schedule', async () => {
      for (const bad of [{ reminderAfterDays: 0 }, { reminderAfterDays: 91 }, { reminderRepeatDays: 1.5 }, { reminderMaxCount: 11 }, { autoRemindersEnabled: 'yes' }]) {
        expect((await patch('/tenant/settings', bad)).status).toBe(400);
      }
      const ok = await patch('/tenant/settings', { autoRemindersEnabled: true, reminderAfterDays: 14, reminderRepeatDays: 5, reminderMaxCount: 2 });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ autoRemindersEnabled: true, reminderAfterDays: 14, reminderRepeatDays: 5, reminderMaxCount: 2 });
      await patch('/tenant/settings', { reminderAfterDays: 7, reminderRepeatDays: 7, reminderMaxCount: 3 });
    });

    it('lets staff opt a customer out of automatic reminders', async () => {
      const w = addDebtor(ON, 'Opt Out W', 15);
      const res = await patch(`/crm/customers/${w.id}/billing`, { remindersOptOut: true });
      expect(res.status).toBe(200);
      expect((await res.json()).remindersOptOut).toBe(true);
      expect((await patch(`/crm/customers/${w.id}/billing`, { remindersOptOut: 'yes' })).status).toBe(400);
      const before = globalMemoryOutbox.length;
      await receivables.runAutoReminders(now);
      expect(globalMemoryOutbox.slice(0, globalMemoryOutbox.length - before).some((j: any) => j.recipient === w.phone)).toBe(false);
    });
  });
});
