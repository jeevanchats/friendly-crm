import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CreditTransferService, CREDIT_TRANSFER_MODE } from '../src/modules/orders/credit-transfer.service';
import { globalMemoryOrders, globalMemoryPayments, globalMemoryCreditTransfers } from '../src/modules/crm/memory-store';

/** Using the credit on one order against what another order of the same customer owes (in-memory lane; the db spec covers Postgres). */
describe('Moving order credit to another order', () => {
  const service = new CreditTransferService();
  const T = `t-credit-move-${randomUUID()}`;
  const USER = randomUUID();
  const CUSTOMER = randomUUID();

  /** An order worth `total` with `paid` received: paid > total is credit, paid < total is money owed. */
  const order = (total: number, paid: number, over: Record<string, unknown> = {}) => {
    const o: any = {
      id: randomUUID(),
      tenantId: T,
      customerId: CUSTOMER,
      orderNumber: `ORD-2026-${Math.floor(Math.random() * 9000 + 1000)}`,
      totalAmount: total.toFixed(2),
      advanceReceived: paid.toFixed(2),
      balanceDue: (total - paid).toFixed(2),
      productionStage: 'PRINTING',
      ...over,
    };
    globalMemoryOrders.push(o);
    return o;
  };

  it('shows where the credit can go and where credit for the dues can come from', async () => {
    const credit = order(500, 1000); // 500 in credit
    const owes = order(800, 300); // owes 500
    order(400, 400); // settled: neither
    order(900, 100, { customerId: randomUUID() }); // another customer's order: never offered
    order(700, 0, { productionStage: 'CANCELLED' }); // cancelled: never a target

    const fromCredit = await service.options(T, credit.id);
    expect(fromCredit.credit).toBe('500.00');
    expect(fromCredit.targets.map((t) => [t.id, t.balanceDue])).toEqual([[owes.id, '500.00']]);

    const fromDues = await service.options(T, owes.id);
    expect(fromDues.balanceDue).toBe('500.00');
    expect(fromDues.sources.map((s) => [s.id, s.credit])).toEqual([[credit.id, '500.00']]);
  });

  it('moves the most possible when no amount is given: both orders change by the same amount and a receipt and a record are written', async () => {
    const credit = order(500, 1200); // 700 in credit
    const owes = order(1000, 400); // owes 600
    const out = await service.transfer(T, USER, credit.id, { toOrderId: owes.id });

    expect(out.transfer).toMatchObject({ amount: '600.00', fromOrderId: credit.id, toOrderId: owes.id, customerId: CUSTOMER, transferredById: USER });
    expect(out.transfer.transferNumber).toMatch(/^CTR-\d{4}-\d{4}$/);
    expect(credit).toMatchObject({ advanceReceived: '600.00', balanceDue: '-100.00' }); // 100 still in credit
    expect(owes).toMatchObject({ advanceReceived: '1000.00', balanceDue: '0.00' });
    expect(out.payment).toMatchObject({ orderId: owes.id, amount: '600.00', mode: CREDIT_TRANSFER_MODE });
    expect(out.payment.notes).toContain(credit.orderNumber);
    expect(globalMemoryPayments.some((p) => p.id === out.payment.id)).toBe(true);
    expect(globalMemoryCreditTransfers.some((t) => t.id === out.transfer.id)).toBe(true);
    expect((await service.list(T, credit.id)).data).toHaveLength(1);
    expect((await service.list(T, owes.id)).data).toHaveLength(1); // the same record from either side
  });

  it('moves a part when an amount is given, and money in the books is unchanged', async () => {
    const credit = order(500, 1000);
    const owes = order(900, 0);
    const before = Number(credit.advanceReceived) + Number(owes.advanceReceived);
    await service.transfer(T, USER, credit.id, { toOrderId: owes.id, amount: 125.5 });
    expect(Number(credit.advanceReceived) + Number(owes.advanceReceived)).toBe(before);
    expect(credit).toMatchObject({ advanceReceived: '874.50', balanceDue: '-374.50' });
    expect(owes).toMatchObject({ advanceReceived: '125.50', balanceDue: '774.50' });
  });

  it('never moves more than the credit or more than the other order owes, and changes nothing when refused', async () => {
    const credit = order(500, 800); // 300 credit
    const smallDue = order(100, 0); // owes 100
    await expect(service.transfer(T, USER, credit.id, { toOrderId: smallDue.id, amount: 100.01 })).rejects.toMatchObject({ response: { error: 'TransferTooLarge', available: '100.00' } });
    const bigDue = order(5000, 0);
    await expect(service.transfer(T, USER, credit.id, { toOrderId: bigDue.id, amount: 300.01 })).rejects.toMatchObject({ response: { error: 'TransferTooLarge', available: '300.00' } });
    expect([credit.advanceReceived, smallDue.advanceReceived, bigDue.advanceReceived]).toEqual(['800.00', '0.00', '0.00']);
  });

  it('refuses an order that is not in credit, one with nothing owed, itself, a cancelled one, a zero or part-paisa amount', async () => {
    const owes = order(500, 100);
    const other = order(500, 0);
    await expect(service.transfer(T, USER, owes.id, { toOrderId: other.id })).rejects.toMatchObject({ response: { error: 'NotInCredit' } });

    const credit = order(500, 900);
    const settled = order(300, 300);
    await expect(service.transfer(T, USER, credit.id, { toOrderId: settled.id })).rejects.toMatchObject({ response: { error: 'NothingOwed' } });
    await expect(service.transfer(T, USER, credit.id, { toOrderId: credit.id })).rejects.toMatchObject({ response: { error: 'SameOrder' } });
    const cancelled = order(300, 0, { productionStage: 'CANCELLED' });
    await expect(service.transfer(T, USER, credit.id, { toOrderId: cancelled.id })).rejects.toMatchObject({ response: { error: 'OrderCancelled' } });
    const target = order(300, 0);
    for (const amount of [0, -5, 1.005]) {
      await expect(service.transfer(T, USER, credit.id, { toOrderId: target.id, amount })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(credit.advanceReceived).toBe('900.00');
  });

  it('cannot move credit between two different customers, or reach another business', async () => {
    const credit = order(500, 900);
    const strangers = order(300, 0, { customerId: randomUUID() });
    await expect(service.transfer(T, USER, credit.id, { toOrderId: strangers.id })).rejects.toMatchObject({ response: { error: 'DifferentCustomer' } });

    const elsewhere = order(300, 0, { tenantId: 't-someone-else' });
    await expect(service.transfer(T, USER, credit.id, { toOrderId: elsewhere.id })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.transfer('t-someone-else', USER, credit.id, { toOrderId: elsewhere.id })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.options('t-someone-else', credit.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(credit.advanceReceived).toBe('900.00');
  });

  it('a repeated request (idempotency key) moves the credit once', async () => {
    const credit = order(500, 1000);
    const owes = order(900, 0);
    const a = await service.transfer(T, USER, credit.id, { toOrderId: owes.id, amount: 100 }, 'ct-key-1');
    const b = await service.transfer(T, USER, credit.id, { toOrderId: owes.id, amount: 100 }, 'ct-key-1');
    expect(b.isIdempotent).toBe(true);
    expect(b.transfer.id).toBe(a.transfer.id);
    expect(owes.advanceReceived).toBe('100.00');
  });
});
