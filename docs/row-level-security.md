# Row-level security (tenant isolation) and the database roles

Every business's rows live in the same tables. PostgreSQL **row-level security (RLS)** is the last line of defence
that keeps one business from ever reading another's: a policy on each table only lets a connection see rows whose
`tenant_id` equals `app.current_tenant_id`, which the API sets at the start of every request's transaction.

RLS only protects you if the API connects as a role that does **not** bypass it.

| Role | Used for | Bypasses RLS? |
|---|---|---|
| `postgres` (superuser) / `DATABASE_ADMIN_URL` | running migrations, local development | **Yes** |
| `friendly_app_runtime` / `DATABASE_URL` in production | the running API | No |

## What to do for production

1. Run **all migrations as the admin role** (they create tables, policies and `SECURITY DEFINER` functions).
2. **Change the runtime role's password.** Migration 0002 creates `friendly_app_runtime` with the placeholder password
   `change_in_production_runtime_pw`: `ALTER ROLE friendly_app_runtime PASSWORD '<long random>';`
3. Point the API's `DATABASE_URL` at `friendly_app_runtime`. (Locally it defaults to the `postgres` superuser, which is
   why RLS problems never showed up in development.)
4. Set the other production settings from `.env.example` (`PUBLIC_API_URL`, `QUOTE_LINK_SECRET`, WhatsApp keys).

## Verifying it (do this after any change to database code)

`scripts/rls/rls-smoke.cjs` walks the whole API (login, customers, products, quotes, orders, payments, invoices,
receivables, WhatsApp bot, background workers) against an API that is connected as the restricted role, and
`scripts/rls/rls-clean.cjs` removes what it created. The instructions are at the top of the script. A passing run
means: every step is 2xx (the 403 and 401 lines are deliberate checks) **and** the API's log has no WARN/ERROR lines.

That second condition matters: much of the code falls back to an in-memory store when the database refuses a query,
so a request can look successful while its data was silently dropped. The log is where that shows.

## Rules for code that touches the database

- A query on an RLS table (`customers`, `orders`, `quotations`, `payments`, `invoices`, `memberships`, `audit_logs`,
  `products`, ...) must run inside `db.transaction` after `SELECT set_config('app.current_tenant_id', <id>, true)`.
  Request handlers get this from `TenantRlsInterceptor`; background jobs and public routes must do it themselves.
- Anything that has to look **across** businesses (find a person by phone, list one user's businesses) goes through a
  narrow `SECURITY DEFINER` function: `lookup_staff_by_phone`, `lookup_customer_by_phone`, `list_user_memberships`.
- `notification_outbox` has no RLS on purpose (the background sender serves every business).
