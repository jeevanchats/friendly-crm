-- ============================================================
-- 0017_bank_details.sql
-- The business's bank account, shown to customers (with its UPI ID as text and a QR code on printed documents) so they
-- can pay directly. There is no payment gateway: staff record each payment when it arrives.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0016.
-- ============================================================

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "bank_account_name" varchar(160);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "bank_name" varchar(120);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "bank_account_number" varchar(18);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "bank_ifsc" varchar(11);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "bank_branch" varchar(120);
