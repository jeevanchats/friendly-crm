// Row-level-security check: proves the whole API works when it connects as the RESTRICTED database role.
//
//   1. Start the API as that role, with its output saved to a file, e.g. (PowerShell, from apps/api):
//        $env:PORT='4100'; $env:DATABASE_URL='postgresql://friendly_app_runtime:<password>@localhost:5432/friendly_crm'
//        $env:ENABLE_DEV_SMS_GATEWAY='true'; $env:WHATSAPP_WEBHOOK_SECRET='dev-secret'; $env:DEV_LOG_MESSAGE_BODIES='true'
//        npx nest start *> api.log
//   2. node scripts/rls/rls-smoke.cjs 4100 apps/api/api.log     (every step should be 2xx; 403 and 401 are expected twice)
//   3. node scripts/rls/rls-clean.cjs                           (removes what the run created)
//   Also read api.log afterwards: there must be no WARN/ERROR lines about row-level security or a memory fallback.
// Local development only: it writes demo data to the seeded Senthaamarai business.
//
// Walks the whole API as the seed owner of Senthaamarai and prints one line per step. Run it against the
// normal API (port 4000, superuser) and the restricted-role API (port 4100) and compare.
const fs = require('fs');
const { createHmac, randomUUID } = require('crypto');
const postgres = require('../../node_modules/postgres');
const port = process.argv[2];
const out = process.argv[3];
const B = `http://localhost:${port}/api`;
const T = '5af19273-0e20-409e-bd15-202b4cd1c138';
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0, 200); } };
const sql = postgres(process.env.DB_ADMIN_URL || 'postgresql://postgres:postgres@localhost:5432/friendly_crm', { max: 1 });
let h;
const results = [];
const step = async (name, fn) => {
  try {
    const r = await fn();
    const status = r && r.s !== undefined ? r.s : 'ok';
    results.push([name, status]);
    console.log(String(status).padEnd(4), name, r && r.note ? '- ' + r.note : '');
    return r;
  } catch (e) {
    results.push([name, 'EXC']);
    console.log('EXC ', name, '-', e.message);
  }
};
const call = async (m, p, b, hdr) => {
  const r = await fetch(B + p, { method: m, headers: { ...h, ...(hdr || {}) }, body: b ? JSON.stringify(b) : undefined });
  const body = await j(r);
  return { s: r.status, b: body, r, note: r.status >= 400 ? JSON.stringify(body).slice(0, 110) : '' };
};

async function chat(phone, text) {
  const before = (fs.readFileSync(out, 'utf8').match(/\[DEV MESSAGE to/g) || []).length;
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'D', changes: [{ value: { messages: [{ id: `wamid.${randomUUID()}`, from: phone.replace(/\D/g, ''), type: 'text', text: { body: text } }] } }] }] });
  const sig = 'sha256=' + createHmac('sha256', 'dev-secret').update(body).digest('hex');
  const res = await fetch(`${B}/notifications/whatsapp/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body });
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 700));
    if ((fs.readFileSync(out, 'utf8').match(/\[DEV MESSAGE to/g) || []).length > before) break;
  }
  await new Promise((r) => setTimeout(r, 800));
  const all = [...fs.readFileSync(out, 'utf8').matchAll(/\[DEV MESSAGE to ([^\]]+)\]\r?\n([\s\S]*?)\r?\n(?:@friendly-crm\/api:dev: )?\[\/DEV MESSAGE\]/g)];
  const mine = all.slice(before).map((m) => m[2].replace(/@friendly-crm\/api:dev: /g, ''));
  return { s: res.status, replies: mine };
}

(async () => {
  // ---- auth
  for (let i = 0; i < 20; i++) {
    const r = await fetch(B + '/auth/otp/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', countryCode: '+91' }) });
    if (r.status < 300) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  await new Promise((r) => setTimeout(r, 1500));
  const codes = [...fs.readFileSync(out, 'utf8').matchAll(/DEV OTP for \+919876543210: (\d+)/g)];
  const v = await j(await fetch(B + '/auth/otp/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '9876543210', code: codes[codes.length - 1][1] }) }));
  if (!v.token) { console.log('LOGIN FAILED', JSON.stringify(v)); process.exit(1); }
  h = { authorization: 'Bearer ' + v.token, 'x-tenant-id': T, 'content-type': 'application/json' };

  await step('auth/me lists the businesses', async () => { const r = await call('GET', '/auth/me'); r.note = 'memberships=' + (r.b.memberships || []).length; return r; });
  await step('tenant/current', () => call('GET', '/tenant/current'));
  await step('tenant/settings get', () => call('GET', '/tenant/settings'));
  await step('tenant/settings patch', () => call('PATCH', '/tenant/settings', { legalName: 'RLS Smoke Co', address: 'Coimbatore', gstNumber: '33AABCS1234A1Z8', upiId: 'rls@okhdfc' }));
  await step('other business is refused', async () => { const r = await call('GET', '/crm/customers', null, { 'x-tenant-id': '00000000-0000-4000-8000-000000000000' }); r.note = ''; return r; });

  // ---- crm
  await step('crm/dashboard', () => call('GET', '/crm/dashboard'));
  await step('crm/customers list', () => call('GET', '/crm/customers'));
  await step('crm/reports', () => call('GET', '/crm/reports'));
  await step('crm/activities', () => call('GET', '/crm/activities'));
  await step('crm/audit-logs', () => call('GET', '/crm/audit-logs'));
  await step('crm/leads', () => call('GET', '/crm/leads'));
  const lead = await step('quick add enquiry (intake-lead)', () => call('POST', '/crm/intake-lead', { phone: '90000 00021', name: 'ZZRLS Lead', customerName: 'ZZRLS Lead', title: '1000 wall calendars', source: 'PHONE', customData: { job_type: 'CALENDAR' } }));
  const leadId = lead && lead.b && (lead.b.lead ? lead.b.lead.id : lead.b.id);
  if (leadId) await step('lead stage change', () => call('PATCH', `/crm/leads/${leadId}/stage`, { stage: 'QUALIFIED' }));
  const cust = await step('add customer', () => call('POST', '/crm/customers', { name: 'ZZRLS Customer', phone: '9000000022', openingBalance: '1500', state: 'Tamil Nadu' }));
  const custId = cust && cust.b && cust.b.id;
  await step('import dry-run', () => call('POST', '/crm/customers/import', { rows: [{ name: 'ZZRLS Imp', phone: '9000000023', openingBalance: '700' }] }));
  await step('import commit', () => call('POST', '/crm/customers/import', { rows: [{ name: 'ZZRLS Imp', phone: '9000000023', openingBalance: '700' }], dryRun: false }));
  if (custId) {
    await step('customer 360', () => call('GET', `/crm/customers/${custId}`));
    await step('customer billing patch', () => call('PATCH', `/crm/customers/${custId}/billing`, { billingAddress: '12 Test St', remindersOptOut: false }));
  }

  // ---- products
  const prod = await step('add product', () => call('POST', '/products', { name: 'ZZRLS Calendar', hsnCode: '4910', unitPrice: 85, taxPercent: 12 }));
  await step('products list/search', () => call('GET', '/products?search=zzrls'));
  await step('products import', () => call('POST', '/products/import', { rows: [{ name: 'ZZRLS Card', unitPrice: 350 }], dryRun: false }));
  if (prod && prod.b && prod.b.id) await step('product edit', () => call('PATCH', `/products/${prod.b.id}`, { unitPrice: 90 }));

  // ---- quotes, orders, payments, invoices
  let quote;
  if (custId) {
    quote = await step('create quote', () => call('POST', '/sales/quotations', { customerId: custId, items: [{ itemName: 'ZZRLS Calendar', quantity: 100, unit: 'Nos', unitPrice: 90, taxPercent: 12, hsnCode: '4910' }] }));
    await step('quotes list', () => call('GET', '/sales/quotations'));
    await step('quote detail', () => call('GET', `/sales/quotations/${quote.b.id}`));
    await step('quote pdf (staff)', async () => { const r = await fetch(`${B}/sales/quotations/${quote.b.id}/pdf`, { headers: h }); return { s: r.status, note: r.headers.get('content-type') }; });
    await step('public quote link (no login)', async () => { const r = await fetch(quote.b.pdfUrl.replace(/^http:\/\/localhost:\d+/, `http://localhost:${port}`)); return { s: r.status, note: 'v' + r.headers.get('x-quote-version') }; });
    const rev = await step('revise quote', () => call('POST', `/sales/quotations/${quote.b.id}/revise`, { items: [{ itemName: 'ZZRLS Calendar', quantity: 100, unit: 'Nos', unitPrice: 85, taxPercent: 12, hsnCode: '4910' }] }));
    await step('old link now opens newest', async () => { const r = await fetch(quote.b.pdfUrl.replace(/^http:\/\/localhost:\d+/, `http://localhost:${port}`)); return { s: r.status, note: 'v' + r.headers.get('x-quote-version') }; });
    await step('inbox', () => call('GET', '/sales/inbox'));
    const conv = await step('convert to order', () => call('POST', `/sales/quotations/${rev.b.id}/convert`, { industryKey: 'printing' }));
    const orderId = conv && conv.b && conv.b.orderId;
    await step('orders list', () => call('GET', '/orders'));
    if (orderId) {
      await step('order detail', () => call('GET', `/orders/${orderId}`));
      await step('order stage', () => call('PATCH', `/orders/${orderId}/stage`, { nextStageId: 'PLATE_CTP' }));
      await step('record payment', () => call('POST', `/orders/${orderId}/payments`, { amount: 500, mode: 'CASH', referenceNo: 'ZZRLS-PAY-1' }));
      await step('invoice prepare', () => call('POST', '/invoices/prepare', { orderId }));
      const inv = await step('invoice issue', () => call('POST', '/invoices', { orderId }));
      if (inv && inv.b && inv.b.id) {
        await step('invoice get', () => call('GET', `/invoices/${inv.b.id}`));
        await step('invoice by order', () => call('GET', `/invoices/by-order/${orderId}`));
        await step('invoice pdf', async () => { const r = await fetch(`${B}/invoices/${inv.b.id}/pdf`, { headers: h }); return { s: r.status, note: r.headers.get('content-type') }; });
      }
      await step('invoices list', () => call('GET', '/invoices'));
    }
  }

  // ---- receivables
  const dues = await step('receivables list', () => call('GET', '/receivables'));
  if (custId) {
    await step('opening-balance payment', () => call('POST', `/receivables/customers/${custId}/payments`, { amount: 500, mode: 'UPI', referenceNo: 'ZZRLS-OPEN-1' }));
    await step('send reminder', () => call('POST', `/receivables/customers/${custId}/remind`));
  }

  // ---- notifications and workflow
  await step('outbox list', () => call('GET', '/notifications/outbox'));
  await step('outbox process', () => call('POST', '/notifications/outbox/process'));
  await step('workflow custom-fields', () => call('GET', '/workflow/custom-fields?entityType=LEAD'));
  await step('workflow pipelines', () => call('GET', '/workflow/pipelines'));

  // ---- WhatsApp bot (customer and staff)
  const c1 = await step('bot: customer says hi', async () => { const r = await chat('+919000000022', 'hi'); return { s: r.s, note: (r.replies[0] || '(no reply)').slice(0, 60).replace(/\n/g, ' ') }; });
  await step('bot: customer verifies by name', async () => { const r = await chat('+919000000022', 'ZZRLS Customer'); return { s: r.s, note: (r.replies[0] || '(no reply)').slice(0, 60).replace(/\n/g, ' ') }; });
  await step('bot: customer asks for dues', async () => { const r = await chat('+919000000022', 'dues'); return { s: r.s, note: (r.replies[0] || '(no reply)').slice(0, 70).replace(/\n/g, ' ') }; });
  await step('bot: staff says hi', async () => { const r = await chat('+919876543210', 'hi'); return { s: r.s, note: (r.replies[0] || '(no reply)').slice(0, 60).replace(/\n/g, ' ') }; });

  // ---- background workers
  await new Promise((r) => setTimeout(r, 6000));
  await step('outbox worker delivered everything', async () => { const [x] = await sql`select count(*) filter (where status='SENT')::int sent, count(*) filter (where status in ('PENDING','FAILED','SENDING'))::int waiting, count(*)::int total from notification_outbox where tenant_id=${T}`; return { s: x.waiting === 0 ? 'ok' : 'WAIT', note: JSON.stringify(x) }; });
  await step('logout', () => call('POST', '/auth/logout'));
  await step('token revoked after logout', async () => { const r = await call('GET', '/auth/me'); r.note = ''; return r; });

  console.log('\nSUMMARY:', results.filter(([, s]) => s !== 'ok' && !(s >= 200 && s < 300)).map(([n, s]) => `${n}=${s}`).join('; ') || 'all steps 2xx/ok');
  await sql.end();
})().catch((e) => { console.error('ERR', e); process.exit(1); });
