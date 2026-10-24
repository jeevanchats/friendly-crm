import {
  ConversationEngine,
  BotPorts,
  StaffIdentity,
  OrderSummary,
  BotSession,
  CustomerIdentity,
  CustomerOrderView,
} from '../src/modules/whatsapp/bot/conversation.engine';
import { InMemorySessionStore } from '../src/modules/whatsapp/bot/session-store';
import { parseInboundMessages, webhookEventKeys, InboundMessage } from '../src/modules/whatsapp/bot/inbound-parser';
import { TenantRole } from '@friendly-crm/shared';

const PHONE = '+919876543210';
const CUSTOMER_PHONE = '+919443022222';

function staff(over: Partial<StaffIdentity> = {}): StaffIdentity {
  return {
    userId: 'u1',
    fullName: 'Jeevan Prakash',
    preferredLanguage: 'en',
    tenantId: 't1',
    tenantName: 'Senthaamarai Calendars',
    industryKey: 'printing',
    role: 'OWNER' as TenantRole,
    ...over,
  };
}

function customer(over: Partial<CustomerIdentity> = {}): CustomerIdentity {
  return {
    customerId: 'c1',
    customerName: 'Sri Krishna Sweets',
    tenantId: 't1',
    tenantName: 'Senthaamarai Calendars',
    tenantPhone: '+919443011111',
    industryKey: 'printing',
    defaultLanguage: 'en',
    selfServiceEnabled: true,
    ...over,
  };
}

function setup(
  identities: StaffIdentity[],
  orders: OrderSummary[] = [],
  customers: CustomerIdentity[] = [],
  customerOrders: Record<string, CustomerOrderView[]> = {},
  opts: { rate?: { max: number; windowMs: number }; clock?: () => number } = {}
) {
  const calls = {
    createLead: [] as any[],
    updateStage: [] as any[],
    setLang: [] as any[],
    orderQueries: [] as string[],
    customerOrderCalls: [] as string[],
    setSelfService: [] as boolean[],
  };
  const state = { selfService: true, failSet: false };
  const failures = { createLead: false };
  const ports: BotPorts = {
    findStaffByPhone: async (p) => (p === PHONE ? identities : []),
    findCustomerByPhone: async (p) => (p === CUSTOMER_PHONE ? customers : []),
    listCustomerOrders: async (who) => {
      calls.customerOrderCalls.push(who.customerId);
      return customerOrders[who.customerId] ?? [];
    },
    createLead: async (who, input) => {
      if (failures.createLead) throw new Error('db down');
      calls.createLead.push({ who, input });
    },
    findOrders: async (_who, q) => {
      calls.orderQueries.push(q);
      return orders.filter((o) => (o.orderNumber + o.customerName).toLowerCase().includes(q.toLowerCase()));
    },
    updateOrderStage: async (who, orderId, stageId) => {
      calls.updateStage.push({ who, orderId, stageId });
    },
    setPreferredLanguage: async (userId, locale) => {
      calls.setLang.push({ userId, locale });
    },
    getCustomerSelfService: async () => state.selfService,
    setCustomerSelfService: async (_who, enabled) => {
      if (state.failSet) throw new Error('db down');
      calls.setSelfService.push(enabled);
      state.selfService = enabled;
    },
  };
  const engine = new ConversationEngine(
    ports,
    new InMemorySessionStore<BotSession>(),
    undefined,
    opts.rate,
    opts.clock
  );
  let n = 0;
  const say = async (text: string, from = PHONE) =>
    (await engine.handle({ id: `m${++n}`, from, type: 'text', text })).replies.join('\n---\n');
  return { engine, say, calls, failures, state };
}

describe('WhatsApp inbound parser', () => {
  it('parses Meta Cloud API text and interactive replies', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA-1',
          changes: [
            {
              value: {
                messages: [
                  { id: 'wamid.1', from: '919876543210', type: 'text', text: { body: 'hi' } },
                  { id: 'wamid.2', from: '919876543210', type: 'interactive', interactive: { button_reply: { id: '1', title: 'Save' } } },
                  { id: 'wamid.3', from: '919876543210', type: 'audio' },
                ],
              },
            },
          ],
        },
      ],
    };
    const msgs = parseInboundMessages(body);
    expect(msgs.map((m) => [m.id, m.from, m.type, m.text])).toEqual([
      ['wamid.1', '+919876543210', 'text', 'hi'],
      ['wamid.2', '+919876543210', 'text', '1'],
      ['wamid.3', '+919876543210', 'media', ''],
    ]);
  });

  it('parses WAHA payloads and ignores own messages, groups and statuses', () => {
    const mk = (over: any) => ({ event: 'message', payload: { id: 'false_1@c.us_X', from: '919876543210@c.us', fromMe: false, body: 'menu', ...over } });
    expect(parseInboundMessages(mk({}))).toHaveLength(1);
    expect(parseInboundMessages(mk({ fromMe: true }))).toHaveLength(0);
    expect(parseInboundMessages(mk({ from: '1203630@g.us' }))).toHaveLength(0);
    expect(parseInboundMessages({ id: 'e1', messageId: 'job-1', status: 'DELIVERED' })).toHaveLength(0);
  });

  it('never uses the Meta business-account id as an event key', () => {
    const body = {
      entry: [{ id: 'WABA-1', changes: [{ value: { statuses: [{ id: 'wamid.9', status: 'delivered' }], messages: [{ id: 'wamid.8' }] } }] }],
    };
    const keys = webhookEventKeys(body);
    expect(keys).toContain('status:wamid.9:delivered');
    expect(keys).toContain('msg:wamid.8');
    expect(keys).not.toContain('WABA-1');
  });
});

describe('WhatsApp conversation engine', () => {
  it('rejects unregistered numbers without revealing anything (bilingual)', async () => {
    const { say } = setup([staff()]);
    const reply = await say('hi', '+910000000000');
    expect(reply).toContain('registered with Friendly CRM');
    expect(reply).toContain('பதிவு செய்யப்படவில்லை');
  });

  it('shows only the menu items the role may use', async () => {
    const owner = await setup([staff()]).say('hi');
    expect(owner).toContain('New enquiry');
    expect(owner).toContain('Update order stage');

    const floor = await setup([staff({ role: 'PRODUCTION' as TenantRole })]).say('hi');
    expect(floor).not.toContain('New enquiry');
    expect(floor).toContain('Order status');
    expect(floor).toContain('Update order stage');

    const sales = await setup([staff({ role: 'SALESPERSON' as TenantRole })]).say('hi');
    expect(sales).toContain('New enquiry');
    expect(sales).not.toContain('Update order stage');
  });

  it('captures an enquiry using the industry template (printing asks Job Category)', async () => {
    const { say, calls } = setup([staff()]);
    await say('hi');
    expect(await say('1')).toContain("Customer's name");
    await say('Sri Krishna Sweets');
    expect(await say('98765 43211')).toContain('What do they need');
    const jobPrompt = await say('5000 wall calendars for 2027');
    expect(jobPrompt).toContain('Job Category');
    expect(jobPrompt).toContain('Calendars');
    const confirm = await say('1');
    expect(confirm).toContain('Sri Krishna Sweets');
    expect(confirm).toContain('+919876543211');
    expect(confirm).toContain('Job Category: Calendars');
    const saved = await say('1');
    expect(saved).toContain('Enquiry saved');
    expect(calls.createLead).toHaveLength(1);
    expect(calls.createLead[0].input).toMatchObject({
      customerName: 'Sri Krishna Sweets',
      customerPhone: '+919876543211',
      customData: { job_type: 'CALENDAR' },
    });
  });

  it('asks different required fields for a different industry (furniture)', async () => {
    const { say } = setup([staff({ industryKey: 'furniture' })]);
    await say('hi');
    await say('1');
    await say('Karthik');
    await say('9443044444');
    const prompt = await say('3-door wardrobe');
    expect(prompt).toContain('Primary Material');
    expect(prompt).not.toContain('Job Category');
  });

  it('re-prompts on a bad phone number and a bad option, without advancing', async () => {
    const { say } = setup([staff()]);
    await say('hi');
    await say('1');
    await say('Murugan');
    expect(await say('12345')).toContain('valid 10-digit');
    await say('9443044444');
    await say('Boxes');
    expect(await say('9')).toContain('Please reply with one of the numbers');
  });

  it('is idempotent on a double "Save" (no duplicate lead)', async () => {
    const { engine, say, calls } = setup([staff()]);
    await say('hi');
    await say('1');
    await say('Anand');
    await say('9443044444');
    await say('Calendars');
    await say('1'); // job type
    const mk = (id: string): InboundMessage => ({ id, from: PHONE, type: 'text', text: '1' });
    await Promise.all([engine.handle(mk('a')), engine.handle(mk('b'))]);
    expect(calls.createLead).toHaveLength(1);
  });

  it('survives a failing save and tells the user', async () => {
    const { say, failures, calls } = setup([staff()]);
    failures.createLead = true;
    await say('hi');
    await say('1');
    await say('Anand');
    await say('9443044444');
    await say('Calendars');
    await say('1');
    const out = await say('1');
    expect(out).toContain("couldn't save");
    expect(calls.createLead).toHaveLength(0);
  });

  it('cancel aborts a flow', async () => {
    const { say, calls } = setup([staff()]);
    await say('hi');
    await say('1');
    await say('Anand');
    expect(await say('cancel')).toContain('Cancelled');
    expect(calls.createLead).toHaveLength(0);
  });

  it('speaks Tamil, understands Tamil digits, and switches language per user', async () => {
    const { say, calls } = setup([staff({ preferredLanguage: 'ta' })]);
    const menu = await say('வணக்கம்');
    expect(menu).toContain('புதிய விசாரணை');
    expect(await say('௧')).toContain('வாடிக்கையாளர் பெயர்');
    await say('menu');
    await say('4'); // language
    const back = await say('1'); // English
    expect(back).toContain('Language set to English');
    expect(calls.setLang).toEqual([{ userId: 'u1', locale: 'en' }]);
  });

  it('shows order status with a localized stage and hides balance when masked', async () => {
    const orders: OrderSummary[] = [
      { id: 'o1', orderNumber: 'ORD-2026-4011', customerName: 'Sri Krishna Sweets', productionStage: 'PRINTING_CMYK', balanceDue: '75000.00' },
      { id: 'o2', orderNumber: 'ORD-2026-0089', customerName: 'Murugan Textiles', productionStage: 'ARTWORK_PENDING', balanceDue: null },
    ];
    const { say } = setup([staff()], orders);
    await say('hi');
    await say('2');
    const a = await say('4011');
    expect(a).toContain('Printing in Progress');
    expect(a).toContain('₹75,000');
    const b = await say('murugan');
    expect(b).toContain('Artwork Approval');
    expect(b).not.toContain('Balance');
    expect(await say('nothing-matches')).toContain('No matching orders');
  });

  it('lets a floor supervisor update an order stage with confirmation', async () => {
    const orders: OrderSummary[] = [
      { id: 'o1', orderNumber: 'ORD-1', customerName: 'Sri Krishna Sweets', productionStage: 'PRINTING_CMYK' },
      { id: 'o2', orderNumber: 'ORD-2', customerName: 'Sri Lakshmi Stores', productionStage: 'ARTWORK_PENDING' },
    ];
    const { say, calls } = setup([staff({ role: 'PRODUCTION' as TenantRole })], orders);
    await say('hi');
    await say('2'); // PRODUCTION menu: 1 status, 2 update stage
    expect(await say('sri')).toContain('Which order?');
    const stages = await say('1'); // ORD-1
    expect(stages).toContain('Printing in Progress ✓');
    expect(await say('4')).toContain('Move *ORD-1* to');
    expect(await say('2')).toContain('Cancelled');
    expect(calls.updateStage).toHaveLength(0);

    await say('ORD-1');
    await say('4');
    const done = await say('1');
    expect(done).toContain('is now at');
    expect(calls.updateStage).toEqual([
      expect.objectContaining({ orderId: 'o1', stageId: 'FINISHING_BINDING' }),
    ]);
  });

  it('asks which business when a person belongs to several, then remembers', async () => {
    const { say } = setup([
      staff({ tenantId: 't1', tenantName: 'Senthaamarai Calendars' }),
      staff({ tenantId: 't2', tenantName: 'Vidhyasri Offset', industryKey: 'printing' }),
    ]);
    const ask = await say('hi');
    expect(ask).toContain('Which business?');
    const menu = await say('2');
    expect(menu).toContain('Vidhyasri Offset');
    expect(await say('hi')).toContain('Vidhyasri Offset'); // remembered for the session
  });

  it('replies to media with a polite text-only notice', async () => {
    const { engine } = setup([staff()]);
    const r = await engine.handle({ id: 'x', from: PHONE, type: 'media', text: '' });
    expect(r.replies[0]).toContain('text messages');
  });

  describe('customer self-service', () => {
    const orders: Record<string, CustomerOrderView[]> = {
      c1: [
        {
          id: 'o1',
          orderNumber: 'ORD-2026-4011',
          productionStage: 'PRINTING_CMYK',
          totalAmount: '125000.00',
          advanceReceived: '50000.00',
          balanceDue: '75000.00',
          expectedDeliveryAt: '2026-11-12T00:00:00.000Z',
        },
        { id: 'o2', orderNumber: 'ORD-2026-0100', productionStage: 'DELIVERED', totalAmount: '10000', advanceReceived: '10000', balanceDue: '0.00' },
      ],
    };

    // The number alone is not proof: the sender must first give the registered name (or an order number).
    const open = async (say: (t: string, from?: string) => Promise<string>, answer = 'Sri Krishna Sweets') => {
      await say('hi', CUSTOMER_PHONE);
      return say(answer, CUSTOMER_PHONE);
    };

    it('greets a known customer and shows only customer options', async () => {
      const { say } = setup([], [], [customer()], orders);
      const menu = await open(say);
      expect(menu).toContain('Sri');
      expect(menu).toContain('Senthaamarai Calendars');
      expect(menu).toContain('My orders');
      expect(menu).not.toContain('New enquiry');
      expect(menu).not.toContain('Update order stage');
    });

    it("shows the customer's own orders with stage, paid and balance", async () => {
      const { say } = setup([], [], [customer()], orders);
      await open(say);
      const out = await say('1', CUSTOMER_PHONE);
      expect(out).toContain('ORD-2026-4011');
      expect(out).toContain('Printing in Progress');
      expect(out).toContain('Total: ₹1,25,000');
      expect(out).toContain('Paid: ₹50,000');
      expect(out).toContain('Balance: ₹75,000');
      expect(out).toContain('2026');
      expect(out).toContain('+919443011111');
      // a fully paid order shows no balance line
      expect(out.split('ORD-2026-0100')[1]).not.toContain('Balance');
    });

    it('looks up a specific order by number, only among their own', async () => {
      const { say, calls } = setup([], [], [customer()], orders);
      await open(say);
      const mine = await say('4011', CUSTOMER_PHONE);
      expect(mine).toContain('ORD-2026-4011');
      expect(mine).not.toContain('ORD-2026-0100');
      const other = await say('9999', CUSTOMER_PHONE);
      expect(other).toContain("couldn't find that order");
      expect(calls.customerOrderCalls.every((id) => id === 'c1')).toBe(true);
    });

    it('never exposes staff features or other customers to a customer', async () => {
      const { say, calls } = setup(
        [],
        [{ id: 'x', orderNumber: 'ORD-STAFF-ONLY', customerName: 'Someone Else', productionStage: 'ARTWORK_PENDING' }],
        [customer()],
        orders
      );
      await open(say);
      const out = await say('ORD-STAFF-ONLY 123', CUSTOMER_PHONE);
      expect(out).not.toContain('Someone Else');
      expect(calls.orderQueries).toHaveLength(0); // staff search port is never used for customers
      expect(calls.createLead).toHaveLength(0);
    });

    it('replies in Tamil when the customer writes in Tamil, and can switch language', async () => {
      const { say } = setup([], [], [customer()], orders);
      expect(await say('வணக்கம்', CUSTOMER_PHONE)).toContain('பாதுகாப்பு'); // verification prompt, in Tamil
      const menu = await say('Sri Krishna Sweets', CUSTOMER_PHONE);
      expect(menu).toContain('என் ஆர்டர்கள்');
      const orderReply = await say('1', CUSTOMER_PHONE);
      expect(orderReply).toContain('நிலை');
      expect(orderReply).toContain('நிலுவை');
      await say('menu', CUSTOMER_PHONE);
      await say('2', CUSTOMER_PHONE); // language
      expect(await say('1', CUSTOMER_PHONE)).toContain('Language set to English');
    });

    it('says so when there are no orders', async () => {
      const { say } = setup([], [], [customer({ customerId: 'c-empty' })], orders);
      await open(say);
      expect(await say('1', CUSTOMER_PHONE)).toContain("couldn't find any orders");
    });

    it('asks which business when the customer buys from several', async () => {
      const { say } = setup(
        [],
        [],
        [customer(), customer({ customerId: 'c2', tenantId: 't2', tenantName: 'Vidhyasri Offset' })],
        { ...orders, c2: [{ id: 'z', orderNumber: 'VO-77', productionStage: 'ARTWORK_PENDING', balanceDue: '500' }] }
      );
      expect(await say('hi', CUSTOMER_PHONE)).toContain('Which business?');
      const prompt = await say('2', CUSTOMER_PHONE);
      expect(prompt).toContain('Vidhyasri Offset');
      expect(prompt).toContain('registered with us');
      expect(await say('Sri Krishna Sweets', CUSTOMER_PHONE)).toContain('My orders');
      expect(await say('1', CUSTOMER_PHONE)).toContain('VO-77');
    });

    describe('ownership check', () => {
      it('shows nothing about the customer before it passes, not even their name', async () => {
        const { say, calls } = setup([], [], [customer()], orders);
        const first = await say('hi', CUSTOMER_PHONE);
        expect(first).toContain('registered with us');
        expect(first).not.toContain('Sri');
        expect(first).not.toContain('My orders');
        expect(calls.customerOrderCalls).toHaveLength(0);
        // an order lookup is not honoured until verified: it is treated as the (wrong) answer
        const probe = await say('4011', CUSTOMER_PHONE);
        expect(probe).toContain("doesn't match");
        expect(probe).not.toContain('ORD-2026-4011');
      });

      it('accepts the name ignoring case, spacing and punctuation', async () => {
        const { say } = setup([], [], [customer()], orders);
        await say('hi', CUSTOMER_PHONE);
        expect(await say('  sri  KRISHNA sweets. ', CUSTOMER_PHONE)).toContain('My orders');
      });

      it('accepts one of their own order numbers instead of the name', async () => {
        const { say } = setup([], [], [customer()], orders);
        await say('hi', CUSTOMER_PHONE);
        expect(await say('ord-2026-4011', CUSTOMER_PHONE)).toContain('My orders');
      });

      it("does not accept another customer's order number or a partial name", async () => {
        const { say } = setup([], [], [customer()], { ...orders, other: [{ id: 'q', orderNumber: 'ORD-OTHER-1', productionStage: 'DELIVERED' }] });
        await say('hi', CUSTOMER_PHONE);
        expect(await say('ORD-OTHER-1', CUSTOMER_PHONE)).toContain("doesn't match");
        expect(await say('Sri', CUSTOMER_PHONE)).toContain("doesn't match");
      });

      it('locks after 3 wrong answers, even if the right one follows', async () => {
        const { say, calls } = setup([], [], [customer()], orders);
        await say('hi', CUSTOMER_PHONE);
        await say('wrong one', CUSTOMER_PHONE);
        await say('wrong two', CUSTOMER_PHONE);
        const locked = await say('wrong three', CUSTOMER_PHONE);
        expect(locked).toContain("couldn't verify");
        expect(locked).toContain('+919443011111');
        expect(await say('Sri Krishna Sweets', CUSTOMER_PHONE)).toContain("couldn't verify");
        expect(await say('1', CUSTOMER_PHONE)).not.toContain('ORD-2026-4011');
        expect(calls.customerOrderCalls.every((id) => id === 'c1')).toBe(true);
      });

      it('stays verified for the rest of the session', async () => {
        const { say } = setup([], [], [customer()], orders);
        await open(say);
        expect(await say('menu', CUSTOMER_PHONE)).toContain('Sri');
        expect(await say('1', CUSTOMER_PHONE)).toContain('ORD-2026-4011');
      });
    });

    it('staff take precedence when a number is both staff and customer', async () => {
      const { engine } = setup([staff()], [], [customer()], orders);
      const r = await engine.handle({ id: 'p', from: PHONE, type: 'text', text: 'hi' });
      expect(r.replies[0]).toContain('New enquiry');
    });
  });

  describe('rate limiting', () => {
    it('warns once, then silently drops, then recovers after the window', async () => {
      let now = 1_000_000;
      const { engine } = setup([staff()], [], [], {}, { rate: { max: 3, windowMs: 60_000 }, clock: () => now });
      const send = (i: number) => engine.handle({ id: `r${i}`, from: PHONE, type: 'text', text: 'hi' });
      for (let i = 0; i < 3; i++) expect((await send(i)).replies.length).toBeGreaterThan(0);
      const warn = await send(4);
      expect(warn.replies[0]).toContain('too fast');
      expect((await send(5)).replies).toEqual([]);
      now += 61_000;
      expect((await send(6)).replies[0]).toContain('New enquiry');
    });
  });

  describe('owner setting: customer self-service on/off', () => {
    it('is offered to the owner only', async () => {
      expect(await setup([staff()]).say('hi')).toContain('Customer order updates on/off');
      expect(await setup([staff({ role: 'MANAGER' as TenantRole })]).say('hi')).not.toContain('Customer order updates');
      expect(await setup([staff({ role: 'SALESPERSON' as TenantRole })]).say('hi')).not.toContain('Customer order updates');
    });

    it('turns it OFF after showing the current state', async () => {
      const { say, calls } = setup([staff()]);
      await say('hi');
      const status = await say('5');
      expect(status).toContain('*ON*');
      const done = await say('1');
      expect(done).toContain('now *OFF*');
      expect(calls.setSelfService).toEqual([false]);
    });

    it('can turn it back ON, and "keep" changes nothing', async () => {
      const { say, calls, state } = setup([staff()]);
      state.selfService = false;
      await say('hi');
      expect(await say('5')).toContain('*OFF*');
      await say('2'); // keep OFF
      expect(calls.setSelfService).toEqual([]);
      await say('5');
      expect(await say('1')).toContain('now *ON*');
      expect(calls.setSelfService).toEqual([true]);
    });

    it('reports a failed save instead of claiming success', async () => {
      const { say, state } = setup([staff()]);
      state.failSet = true;
      await say('hi');
      await say('5');
      const out = await say('1');
      expect(out).toContain("couldn't change that setting");
      expect(out).not.toContain('now *OFF*');
    });
  });

  describe('customers of a business that switched self-service off', () => {
    it('get a polite pointer to the business, never their orders', async () => {
      const { say, calls } = setup([], [], [customer({ selfServiceEnabled: false })], {
        c1: [{ id: 'o1', orderNumber: 'ORD-1', productionStage: 'PRINTING_CMYK', balanceDue: '500' }],
      });
      const out = await say('hi', CUSTOMER_PHONE);
      expect(out).toContain("aren't available for *Senthaamarai Calendars*");
      expect(out).toContain('+919443011111');
      expect(await say('1', CUSTOMER_PHONE)).toContain("aren't available");
      expect(calls.customerOrderCalls).toHaveLength(0);
    });

    it('only offers the businesses that have it on', async () => {
      const { say } = setup(
        [],
        [],
        [customer({ selfServiceEnabled: false }), customer({ customerId: 'c2', tenantId: 't2', tenantName: 'Vidhyasri Offset' })],
        { c2: [{ id: 'z', orderNumber: 'VO-77', productionStage: 'ARTWORK_PENDING', balanceDue: '500' }] }
      );
      const prompt = await say('hi', CUSTOMER_PHONE); // single enabled business -> no "which business?"
      expect(prompt).not.toContain('Which business?');
      expect(prompt).toContain('Vidhyasri Offset');
      expect(await say('Sri Krishna Sweets', CUSTOMER_PHONE)).toContain('Vidhyasri Offset');
      expect(await say('1', CUSTOMER_PHONE)).toContain('VO-77');
    });

    it('answers in Tamil when the customer writes Tamil', async () => {
      const { say } = setup([], [], [customer({ selfServiceEnabled: false })]);
      expect(await say('வணக்கம்', CUSTOMER_PHONE)).toContain('கிடைக்காது');
    });
  });
});
