-- ============================================================
-- 0021_refund_advance.sql
-- A refund can now be paid back out of a customer's ADVANCE (an amount they paid before Friendly CRM, imported as a negative
-- opening balance) as well as out of an order's credit. An advance belongs to the customer, not to an order, so such a
-- refund has no order: order_id becomes optional. A refund with no order is a refund of the customer's advance.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0020.
-- ============================================================

ALTER TABLE "refunds" ALTER COLUMN "order_id" DROP NOT NULL;
--> statement-breakpoint
-- The same reference twice for one customer's advance is refused, like it is for one order (a NULL order never collides)
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_advance_reference_idx" ON "refunds" ("tenant_id", "customer_id", "reference_no") WHERE "order_id" IS NULL AND "reference_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_customer_idx" ON "refunds" ("tenant_id", "customer_id");
