-- ============================================================
-- 0009_auto_reminders.sql
-- Automatic payment reminders.
--  * tenants: opt-in switch and the schedule (first reminder after N days, repeat every N days, at most N)
--  * customers: reminders_opt_out, so a customer who asks to stop is never reminded automatically
-- Off by default: nothing is sent to customers automatically until the owner turns it on.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0008.
-- ============================================================

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "auto_reminders_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "reminder_after_days" integer DEFAULT 7 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "reminder_repeat_days" integer DEFAULT 7 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "reminder_max_count" integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "reminders_opt_out" boolean DEFAULT false NOT NULL;
