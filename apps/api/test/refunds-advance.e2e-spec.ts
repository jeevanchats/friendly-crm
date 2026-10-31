import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RefundsService } from '../src/modules/orders/refunds.service';
import { globalMemoryCustomers, globalMemoryRefunds } from '../src/modules/crm/memory-store';

/** Paying back a customer's advance: money they paid before Friendly CRM, held as a negative opening balance (no order). */
describe('Refunds of a customer advance', () => {
  const service = new RefundsService();
  const T = `t-adv-refund-${randomUUID()}`;
  const USER = randomUUID();
  const customer = (opening: string, over: Record<string, unknown> = {}) => {
    const c: any = {
      id: randomUUID(),
      tenantId: T,
      name: 'Advance Co',
      phone: `+9198${Math.floor(Math.random() * 1e8)}`.slice(0, 13),
      openingBalance: opening,
      creditLimit: '0.00',
      activeOrdersCount: 0,
      totalReceivable: '0',
      createdAt: new Date(),
      ...over,
    };
    globalMemoryCustomers.push(c);
    return c;
  };
  const dto = (amount: number, extra: Record<string, unknown> = {}) => ({ amount, mode: 'UPI' as const, ...extra });

  it('refunds part of the advance, then the rest, and the balance comes back to zero', async () => {
    const c = customer('-5000.00');
    const first = await service.recordAdvance(T, USER, c.id, dto(2000, { referenceNo: 'UTR-A1' }));
    expect(first.refund).toMatchObject({ amount: '2000.00', mode: 'UPI', orderId: null, customerId: c.id, refundedById: USER });
    expect(first.refund.refundNumber).toMatch(/^RFD-\d{4}-\d{4}$/);
    expect(first.advanceRemaining).toBe('3000.00');
    expect(c.openingBalance).toBe('-3000.00');

    const second = await service.recordAdvance(T, USER, c.id, dto(3000));
    expect(second.advanceRemaining).toBe('0.00');
    expect(c.openingBalance).toBe('0.00');
    const listed = await service.listAdvance(T, c.id);
    expect(listed.creditRemaining).toBe('0.00');
    expect(listed.data).toHaveLength(2);
  });

  it('never refunds more than the advance, and nothing to a customer who owes us or has no advance', async () => {
    const c = customer('-1000.00');
    await expect(service.recordAdvance(T, USER, c.id, dto(1000.01))).rejects.toMatchObject({ response: { error: 'RefundTooLarge', available: '1000.00' } });
    const owes = customer('800.00');
    await expect(service.recordAdvance(T, USER, owes.id, dto(1))).rejects.toMatchObject({ response: { error: 'NoAdvance' } });
    const nothing = customer('0.00');
    await expect(service.recordAdvance(T, USER, nothing.id, dto(1))).rejects.toBeInstanceOf(BadRequestException);
    expect([c.openingBalance, owes.openingBalance, nothing.openingBalance]).toEqual(['-1000.00', '800.00', '0.00']); // the refused ones changed nothing
  });

  it('refuses a zero or part-paisa amount and a repeated reference; a repeated request (idempotency key) pays once', async () => {
    const c = customer('-1000.00');
    for (const amount of [0, -1, 5.001]) await expect(service.recordAdvance(T, USER, c.id, dto(amount))).rejects.toBeInstanceOf(BadRequestException);
    await service.recordAdvance(T, USER, c.id, dto(100, { referenceNo: 'UTR-X' }));
    await expect(service.recordAdvance(T, USER, c.id, dto(100, { referenceNo: 'UTR-X' }))).rejects.toBeInstanceOf(BadRequestException);

    const a = await service.recordAdvance(T, USER, c.id, dto(50), 'adv-key-1');
    const b = await service.recordAdvance(T, USER, c.id, dto(50), 'adv-key-1');
    expect(b.isIdempotent).toBe(true);
    expect(b.refund.id).toBe(a.refund.id);
    expect(c.openingBalance).toBe('-850.00'); // 1000 - 100 - 50
  });

  it('cannot reach another business customer, and the refund has no order', async () => {
    const other = customer('-500.00', { tenantId: 't-someone-else' });
    await expect(service.recordAdvance(T, USER, other.id, dto(10))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listAdvance(T, other.id)).rejects.toBeInstanceOf(NotFoundException);

    const c = customer('-500.00');
    await service.recordAdvance(T, USER, c.id, dto(100));
    expect(globalMemoryRefunds.filter((r) => r.customerId === c.id).every((r) => r.orderId === null)).toBe(true);
  });
});
