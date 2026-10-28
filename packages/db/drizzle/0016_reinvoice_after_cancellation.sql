-- ============================================================
-- 0016_reinvoice_after_cancellation.sql
-- An order could only ever have one invoice. After a credit note cancels an invoice in full, the order can now be
-- invoiced again (a corrected GSTIN, HSN or place of supply), so the one-invoice-per-order index becomes a plain one.
-- The application takes turns on the order row instead, and refuses a second invoice while one is still in force.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0015.
-- ============================================================

DROP INDEX IF EXISTS "invoices_tenant_order_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_tenant_order_idx" ON "invoices" ("tenant_id", "order_id");
