-- ============================================================
-- 0008_notification_outbox.sql
-- The notification outbox table. It was defined in schema.ts but no earlier migration created it, so every
-- environment fell back to an in-memory outbox that loses queued messages on restart and cannot be shared
-- between API instances.
--
-- No row-level security on purpose: the background worker drains the queue for ALL businesses, and a tenant
-- policy would hide every row from it. Application code always filters by tenant_id when reading for a user.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0007.
-- ============================================================

CREATE TABLE IF NOT EXISTS "notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "channel" varchar(20) NOT NULL,
  "recipient" varchar(50) NOT NULL,
  "template_key" varchar(50),
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "rendered_message" text NOT NULL,
  "media_url" text,
  "status" varchar(20) DEFAULT 'PENDING' NOT NULL, -- PENDING | SENDING | SENT | FAILED | DEAD_LETTER
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "last_error" text,
  "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_outbox_tenant_idx" ON "notification_outbox" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_outbox_status_idx" ON "notification_outbox" ("status");
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_outbox" TO friendly_app_runtime;
  END IF;
END $$;
