import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { CustomerContactsService } from '../src/modules/crm/customer-contacts.service';
import { globalMemoryContacts, globalMemoryCustomers } from '../src/modules/crm/memory-store';

/** Sending a customer's WhatsApp messages to one of its contacts' numbers (in-memory lane; contact-whatsapp-db covers Postgres). */
describe('Use a contact\'s number for WhatsApp', () => {
  const service = new CustomerContactsService();
  const T = `t-wa-${randomUUID()}`;
  const customer = (over: Record<string, unknown> = {}) => {
    const c: any = { id: randomUUID(), tenantId: T, name: 'Chris Studio', phone: '+919840000001', openingBalance: '0', creditLimit: '0', activeOrdersCount: 0, totalReceivable: '0', createdAt: new Date(), ...over };
    globalMemoryCustomers.push(c);
    return c;
  };
  const contact = (customerId: string, phone: string, name = 'Jeevan') => {
    const c = { id: randomUUID(), tenantId: T, customerId, name, phone, designation: null, email: null };
    globalMemoryContacts.push(c);
    return c;
  };

  it('makes the contact\'s number the WhatsApp number and removes it from the people list', async () => {
    const c = customer();
    const ct = contact(c.id, '+919840000002');
    expect(await service.numbers(T, c.id)).toEqual({ phone: c.phone, whatsappNumber: c.phone }); // defaults to the main phone
    const out = await service.useForWhatsApp(T, null, c.id, ct.id);
    expect(out).toEqual({ phone: '+919840000001', whatsappNumber: '+919840000002' });
    expect(c.whatsappNumber).toBe('+919840000002');
    expect(globalMemoryContacts.some((x) => x.id === ct.id)).toBe(false);
  });

  it('keeps a different earlier WhatsApp number as a contact, so it is still recognised', async () => {
    const c = customer({ phone: '+919840000011', whatsappNumber: '+919840000012' });
    const ct = contact(c.id, '+919840000013');
    await service.useForWhatsApp(T, 'actor', c.id, ct.id);
    const mine = globalMemoryContacts.filter((x) => x.customerId === c.id);
    expect(mine.map((x) => x.phone)).toEqual(['+919840000012']);
    expect(mine[0]).toMatchObject({ name: 'Chris Studio', designation: 'Earlier WhatsApp number' });
    expect(c.whatsappNumber).toBe('+919840000013');
  });

  it('does not add a contact when the earlier WhatsApp number was the main phone', async () => {
    const c = customer({ phone: '+919840000021', whatsappNumber: '+919840000021' });
    const ct = contact(c.id, '+919840000022');
    await service.useForWhatsApp(T, null, c.id, ct.id);
    expect(globalMemoryContacts.filter((x) => x.customerId === c.id)).toHaveLength(0);
  });

  it('refuses a contact of another customer or business, or one that is not there', async () => {
    const a = customer({ phone: '+919840000031' });
    const b = customer({ phone: '+919840000032' });
    const bContact = contact(b.id, '+919840000033');
    await expect(service.useForWhatsApp(T, null, a.id, bContact.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.useForWhatsApp(T, null, a.id, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.useForWhatsApp('t-other', null, a.id, bContact.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(b.whatsappNumber).toBeUndefined();
  });
});
