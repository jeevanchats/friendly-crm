import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RefundsService, creditOf } from '../src/modules/orders/refunds.service';
import { ReportsService } from '../src/modules/crm/reports.service';
import { globalMemoryOrders, globalMemoryRefunds, globalMemoryCustomers } from '../src/modules/crm/memory-store';

/** Paying money back to a customer whose order a credit note left in credit (in-memory lane; refunds-db covers Postgres). */
describe('Refunds', () => {
  const service = new RefundsService();
  const T = `t-refund-${randomUUID()}`;
  const USER = randomUUID();

  /** An order worth `total` that the customer has paid `paid` towards (paid > total means in credit, as after a credit note). */
  const order = (total: number, paid: number, over: Record<string, unknown> = {}) => {
    const o: any = {
      id: randomUUID(),
      tenantId: T,
      customerId: randomUUID(),
      orderNumber: `ORD-2026-${Math.floor(Math.random() * 9000 + 1000)}`,
      totalAmount: total.toFixed(2),
      advanceReceived: paid.toFixed(2),
      balanceDue: (total - paid).toFixed(2),
      productionStage: 'DELIVERED',
      ...over,
    };
    globalMemoryOrders.push(o);
    return o;
  };
  const dto = (amount: number, extra: Record<string, unknown> = {}) => ({ amount, mode: 'BANK_TRANSFER' as const, ...extra });

  it('works out the credit: what was paid beyond what the order now comes to', () => {
    expect(creditOf({ totalAmount: '500.00', advanceReceived: '1000.00' })).toBe(50000);
    expect(creditOf({ totalAmount: '500.00', advanceReceived: '500.00' })).toBe(0);
    expect(creditOf({ totalAmount: '500.00', advanceReceived: '200.00' })).toBe(0); // owes money: no credit
  });

  it('refunds part of the credit, then the rest, and the order comes back to zero', async () => {
    const o = order(500, 1000); // paid 1000, order now worth 500: owed back 500
    const first = await service.record(T, USER, o.id, dto(200, { referenceNo: 'UTR-1' }));
    expect(first.refund).toMatchObject({ amount: '200.00', mode: 'BANK_TRANSFER', referenceNo: 'UTR-1', refundedById: USER });
    expect(first.refund.refundNumber).toMatch(/^RFD-\d{4}-\d{4}$/);
    expect(o).toMatchObject({ advanceReceived: '800.00', balanceDue: '-300.00' }); // still 300 in credit

    expect((await service.list(T, o.id)).creditRemaining).toBe('300.00');
    const second = await service.record(T, USER, o.id, dto(300));
    expect(second.refund.refundNumber).not.toBe(first.refund.refundNumber);
    expect(o).toMatchObject({ advanceReceived: '500.00', balanceDue: '0.00' });
    const listed = await service.list(T, o.id);
    expect(listed.creditRemaining).toBe('0.00');
    expect(listed.data).toHaveLength(2);
  });

  it('never refunds more than the credit, and nothing when the order is not in credit', async () => {
    const o = order(500, 1000);
    await expect(service.record(T, USER, o.id, dto(500.01))).rejects.toMatchObject({ response: { error: 'RefundTooLarge', available: '500.00' } });
    const owes = order(500, 200);
    await expect(service.record(T, USER, owes.id, dto(1))).rejects.toMatchObject({ response: { error: 'NotInCredit' } });
    const settled = order(500, 500);
    await expect(service.record(T, USER, settled.id, dto(1))).rejects.toBeInstanceOf(BadRequestException);
    expect(o.advanceReceived).toBe('1000.00'); // the refused ones changed nothing
    expect(owes.advanceReceived).toBe('200.00');
  });

  it('refuses a zero, negative or part-paisa amount', async () => {
    const o = order(500, 1000);
    for (const amount of [0, -5, 10.005]) await expect(service.record(T, USER, o.id, dto(amount))).rejects.toBeInstanceOf(BadRequestException);
    expect(o.advanceReceived).toBe('1000.00');
  });

  it('refuses the same reference twice for an order, and a repeated request (idempotency key) pays once', async () => {
    const o = order(500, 1000);
    await service.record(T, USER, o.id, dto(100, { referenceNo: 'UTR-9' }));
    await expect(service.record(T, USER, o.id, dto(100, { referenceNo: 'UTR-9' }))).rejects.toBeInstanceOf(BadRequestException);

    const again = await service.record(T, USER, o.id, dto(50), 'key-abc');
    const retry = await service.record(T, USER, o.id, dto(50), 'key-abc');
    expect(retry.isIdempotent).toBe(true);
    expect(retry.refund.id).toBe(again.refund.id);
    expect(o.advanceReceived).toBe('850.00'); // 1000 - 100 - 50, not 800
  });

  it('cannot reach another business\'s order or one that is not there', async () => {
    const o = order(500, 1000, { tenantId: 't-someone-else' });
    await expect(service.record(T, USER, o.id, dto(10))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.record(T, USER, randomUUID(), dto(10))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.list(T, o.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(globalMemoryRefunds.some((r) => r.orderId === o.id)).toBe(false);
  });

  it('business totals count only money owed to us; credit is shown on its own', async () => {
    const T2 = `t-totals-${randomUUID()}`;
    const c = { id: randomUUID(), tenantId: T2, name: 'Credit Co', phone: '+919800000099', openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0', createdAt: new Date() } as any;
    globalMemoryCustomers.push(c);
    order(500, 1000, { tenantId: T2, customerId: c.id }); // in credit by 500
    order(800, 200, { tenantId: T2, customerId: c.id }); // owes 600
    const report: any = await new ReportsService().getBusinessInsights(T2, 'OWNER' as any);
    expect(report.financials.totalPendingReceivables).toBe('600.00'); // not 100.00: the credit does not hide what is owed
    expect(report.financials.totalCustomerCredits).toBe('500.00');
  });
});
