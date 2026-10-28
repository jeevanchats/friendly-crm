-- ============================================================
-- 0018_bot_sessions.sql
-- WhatsApp bot conversation state, kept in Postgres instead of API memory, so a restart or a second API instance
-- does not drop people mid-conversation (the in-memory store said to replace it before running more than one instance).
--
-- No tenant_id and no row-level security on purpose: the key is the sender's phone number, and one number can be
-- staff in one business and a customer in another. The value holds only the conversation step and which businesses
-- the sender has verified; expired rows are deleted on read and swept by the API.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0017.
-- ============================================================

CREATE TABLE IF NOT EXISTS "bot_sessions" (
  "key" varchar(64) PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_sessions_expires_idx" ON "bot_sessions" ("expires_at");
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "bot_sessions" TO friendly_app_runtime;
  END IF;
END $$;
