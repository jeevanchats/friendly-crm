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
    const c = { id: randomUUID(), tenantId: T, customerId, name, phone, designation: 'Accounts', email: 'j@x.in' };
    globalMemoryContacts.push(c);
    return c;
  };

  it('makes the contact\'s number the WhatsApp number and keeps the person, with their role', async () => {
    const c = customer();
    const ct = contact(c.id, '+919840000002');
    expect(await service.numbers(T, c.id)).toEqual({ phone: c.phone, whatsappNumber: c.phone }); // defaults to the main phone
    const out = await service.useForWhatsApp(T, null, c.id, ct.id);
    expect(out).toEqual({ phone: '+919840000001', whatsappNumber: '+919840000002' });
    expect(c.whatsappNumber).toBe('+919840000002');
    expect(globalMemoryContacts.find((x) => x.id === ct.id)).toMatchObject({ name: 'Jeevan', designation: 'Accounts', phone: '+919840000002' });
  });

  it('keeps a different earlier WhatsApp number as a contact, so it is still recognised', async () => {
    const c = customer({ phone: '+919840000011', whatsappNumber: '+919840000012' });
    const ct = contact(c.id, '+919840000013');
    await service.useForWhatsApp(T, 'actor', c.id, ct.id);
    const mine = globalMemoryContacts.filter((x) => x.customerId === c.id);
    expect(mine.map((x) => x.phone).sort()).toEqual(['+919840000012', '+919840000013']);
    expect(mine.find((x) => x.phone === '+919840000012')).toMatchObject({ name: 'Chris Studio', designation: 'Earlier WhatsApp number' });
    expect(mine.find((x) => x.phone === '+919840000013')).toMatchObject({ name: 'Jeevan', designation: 'Accounts' }); // the person is untouched
    expect(c.whatsappNumber).toBe('+919840000013');
  });

  it('adds no extra contact when the earlier WhatsApp number was the main phone', async () => {
    const c = customer({ phone: '+919840000021', whatsappNumber: '+919840000021' });
    const ct = contact(c.id, '+919840000022');
    await service.useForWhatsApp(T, null, c.id, ct.id);
    expect(globalMemoryContacts.filter((x) => x.customerId === c.id).map((x) => x.id)).toEqual([ct.id]);
  });

  it('editing the number of the person whose number is the WhatsApp number moves the WhatsApp number with it', async () => {
    const c = customer({ phone: '+919840000061' });
    const ct = contact(c.id, '+919840000062');
    await service.useForWhatsApp(T, null, c.id, ct.id);
    await service.update(T, c.id, ct.id, { phone: '+919840000063' });
    expect(c.whatsappNumber).toBe('+919840000063');
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

  it('goes back to the main phone, keeping the number it leaves as a contact; and can switch again', async () => {
    const c = customer({ phone: '+919840000041' });
    const ct = contact(c.id, '+919840000042');
    await service.useForWhatsApp(T, null, c.id, ct.id);
    expect(await service.numbers(T, c.id)).toEqual({ phone: '+919840000041', whatsappNumber: '+919840000042' });

    const back = await service.useMainForWhatsApp(T, null, c.id);
    expect(back).toEqual({ phone: '+919840000041', whatsappNumber: '+919840000041' });
    const mine = globalMemoryContacts.filter((x) => x.customerId === c.id);
    expect(mine).toHaveLength(1); // no duplicate: the person is still there
    expect(mine[0]).toMatchObject({ name: 'Jeevan', designation: 'Accounts', phone: '+919840000042' });

    await service.useForWhatsApp(T, null, c.id, mine[0].id);
    expect(c.whatsappNumber).toBe('+919840000042');
  });

  it('does nothing when WhatsApp already goes to the main phone', async () => {
    const c = customer({ phone: '+919840000051' });
    expect(await service.useMainForWhatsApp(T, null, c.id)).toEqual({ phone: c.phone, whatsappNumber: c.phone });
    expect(globalMemoryContacts.filter((x) => x.customerId === c.id)).toHaveLength(0);
  });
});
