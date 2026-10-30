import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomerMergeService } from '../src/modules/crm/customer-merge.service';
import {
  globalMemoryContacts,
  globalMemoryCustomers,
  globalMemoryLeads,
  globalMemoryOrders,
  globalMemoryPayments,
  globalMemoryQuotations,
} from '../src/modules/crm/memory-store';

/** Merging two customers that are really one business (in-memory lane; customer-merge-db covers Postgres). */
describe('Customer merge', () => {
  const service = new CustomerMergeService();
  const T = `t-merge-${randomUUID()}`;
  const mk = (over: Record<string, unknown> = {}) => {
    const c: any = { id: randomUUID(), tenantId: T, name: 'X', phone: `+9199${Math.floor(Math.random() * 1e8)}`.slice(0, 13), openingBalance: '0.00', creditLimit: '0.00', activeOrdersCount: 0, totalReceivable: '0.00', createdAt: new Date(), ...over };
    globalMemoryCustomers.push(c);
    return c;
  };

  it('moves everything to the kept customer, keeps the duplicate\'s numbers as contacts, fills blanks and removes it', async () => {
    const keep = mk({ name: 'CHRIS GRAPHIC DESIGN STUDIO', phone: '+919840000001', openingBalance: '100.00', creditLimit: '5000.00' });
    const gone = mk({ name: 'chris graphic', phone: '+919840000002', whatsappNumber: '+919840000003', email: 'c@x.in', gstin: '33ABCDE1234F1Z5', openingBalance: '50.50', creditLimit: '9000.00' });
    globalMemoryLeads.push({ id: randomUUID(), tenantId: T, customerId: gone.id });
    globalMemoryQuotations.push({ id: randomUUID(), tenantId: T, customerId: gone.id });
    globalMemoryOrders.push({ id: randomUUID(), tenantId: T, customerId: gone.id });
    globalMemoryPayments.push({ id: randomUUID(), tenantId: T, customerId: gone.id });
    globalMemoryContacts.push({ id: randomUUID(), tenantId: T, customerId: gone.id, name: 'Ravi', phone: '+919840000009', designation: null, email: null });

    const out = await service.merge(T, null, keep.id, gone.id);
    expect(out.moved).toMatchObject({ enquiries: 1, quotations: 1, orders: 1, payments: 1 });
    expect(out.moved.contacts).toBe(3); // Ravi + the duplicate's phone + its WhatsApp number

    expect(globalMemoryCustomers.find((c) => c.id === gone.id)).toBeUndefined();
    expect(globalMemoryLeads.every((l) => l.customerId !== gone.id)).toBe(true);
    const mine = globalMemoryContacts.filter((c) => c.customerId === keep.id).map((c) => c.phone).sort();
    expect(mine).toEqual(['+919840000002', '+919840000003', '+919840000009']);
    expect(keep).toMatchObject({ email: 'c@x.in', gstin: '33ABCDE1234F1Z5', openingBalance: '150.50', creditLimit: '9000.00' });
  });

  it('refuses two customers with different GSTINs (they are different businesses)', async () => {
    const a = mk({ gstin: '33ABCDE1234F1Z5' });
    const b = mk({ gstin: '33ZZZZZ9999Z1Z9' });
    await expect(service.merge(T, null, a.id, b.id)).rejects.toBeInstanceOf(ConflictException);
    expect(globalMemoryCustomers.find((c) => c.id === b.id)).toBeDefined();
  });

  it('refuses the same customer twice, a missing one, and another business\'s customer', async () => {
    const a = mk();
    const b = mk();
    const other = mk({ tenantId: 't-other' });
    await expect(service.merge(T, null, a.id, a.id)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.merge(T, null, a.id, '')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.merge(T, null, a.id, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.merge(T, null, a.id, other.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(globalMemoryCustomers.find((c) => c.id === b.id)).toBeDefined();
  });

  it('refuses a merge that would give one customer more than 20 contacts', async () => {
    const a = mk();
    const b = mk();
    for (let i = 0; i < 20; i++) globalMemoryContacts.push({ id: randomUUID(), tenantId: T, customerId: i < 10 ? a.id : b.id, name: `P${i}`, phone: `+91970000${String(i).padStart(4, '0')}` });
    await expect(service.merge(T, null, a.id, b.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(globalMemoryCustomers.find((c) => c.id === b.id)).toBeDefined();
  });
});
