// Removes everything the smoke test created in Senthaamarai and restores the demo tenant.
const postgres = require('../../node_modules/postgres');
const T = '5af19273-0e20-409e-bd15-202b4cd1c138';
// Test customers and products are named with this prefix (ZZRLS from rls-smoke; pass another to clean other test data)
const PREFIX = process.env.NAME_PREFIX || process.argv[2] || 'ZZRLS';
(async () => {
  const sql = postgres(process.env.DB_ADMIN_URL || 'postgresql://postgres:postgres@localhost:5432/friendly_crm', { max: 1 });
  const custs = (await sql`select id from customers where tenant_id=${T} and name like ${PREFIX + '%'}`).map((x) => x.id);
  if (custs.length) {
    const orders = (await sql`select id from orders where customer_id in ${sql(custs)}`).map((x) => x.id);
    const quotes = (await sql`select id from quotations where customer_id in ${sql(custs)}`).map((x) => x.id);
    const invs = (await sql`select id from invoices where customer_id in ${sql(custs)}`).map((x) => x.id);
    const leads = (await sql`select id from leads where customer_id in ${sql(custs)}`).map((x) => x.id);
    const ids = [...custs, ...orders, ...quotes, ...invs, ...leads];
    await sql`delete from eway_bills where invoice_id in (select id from invoices where customer_id in ${sql(custs)})`;
    await sql`delete from credit_note_items where credit_note_id in (select id from credit_notes where customer_id in ${sql(custs)})`;
    await sql`delete from credit_notes where customer_id in ${sql(custs)}`;
    await sql`delete from invoices where customer_id in ${sql(custs)}`;
    await sql`delete from payments where customer_id in ${sql(custs)}`;
    await sql`delete from tasks where customer_id in ${sql(custs)}`;
    await sql`delete from activities where entity_id in ${sql(ids)}`;
    await sql`delete from audit_logs where tenant_id=${T} and entity_id in ${sql(ids)}`;
    await sql`delete from orders where customer_id in ${sql(custs)}`;
    await sql`update quotations set parent_quote_id=null where customer_id in ${sql(custs)}`;
    await sql`delete from quotations where customer_id in ${sql(custs)}`;
    await sql`delete from leads where customer_id in ${sql(custs)}`;
    await sql`delete from customers where id in ${sql(custs)}`;
  }
  await sql`delete from products where name like ${PREFIX + '%'}`;
  await sql`delete from invoice_counters where tenant_id=${T}`;
  await sql`delete from credit_note_counters where tenant_id=${T}`;
  await sql`delete from notification_outbox where tenant_id=${T}`;
  // Only the smoke test's own settings changes are undone, and only when asked: a person may have entered real settings.
  if (process.env.RESET_TENANT_SETTINGS === '1') {
    await sql`delete from audit_logs where tenant_id=${T} and action='SETTINGS_UPDATED'`;
    await sql`update tenants set gst_number=null, legal_name=null, address=null, state_code=null, upi_id=null, auto_reminders_enabled=false where id=${T}`;
  }
  console.log(JSON.stringify(await sql`select (select count(*)::int from customers where tenant_id=${T}) customers, (select count(*)::int from orders where tenant_id=${T}) orders, (select count(*)::int from quotations where tenant_id=${T}) quotes, (select count(*)::int from payments where tenant_id=${T}) payments, (select count(*)::int from products where tenant_id=${T}) products, (select count(*)::int from leads where tenant_id=${T}) leads, (select count(*)::int from tasks where tenant_id=${T}) tasks`));
  console.log(JSON.stringify(await sql`select order_number, total_amount, advance_received, balance_due, production_stage from orders where tenant_id=${T}`));
  await sql.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
