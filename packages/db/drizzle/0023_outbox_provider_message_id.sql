-- ============================================================
-- 0023_outbox_provider_message_id.sql
-- Remember the id the WhatsApp provider (Twilio, Meta...) gives a message when it accepts it. Delivered / read / failed
-- reports name that id, not ours, so without it a report could never be matched to the queued message.
-- Same table, same (absent) row-level security as 0008: the background worker drains the queue for all businesses.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0022.
-- ============================================================

ALTER TABLE "notification_outbox" ADD COLUMN IF NOT EXISTS "provider_message_id" varchar(100);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_outbox_provider_message_idx" ON "notification_outbox" ("provider_message_id");
