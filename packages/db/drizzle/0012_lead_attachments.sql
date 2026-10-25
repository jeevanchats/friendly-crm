-- ============================================================
-- 0012_lead_attachments.sql
-- Voice notes and files attached to an enquiry (a customer's requirement spoken or photographed), so whoever
-- prepares the quote can listen to and open them. Stored in the database to keep the first version free of
-- extra infrastructure; the bytes live in their own table so enquiry lists never load them.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0011.
-- ============================================================

CREATE TABLE IF NOT EXISTS "lead_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "lead_id" uuid NOT NULL REFERENCES "leads"("id") ON DELETE cascade,
  "kind" varchar(10) NOT NULL,
  "file_name" varchar(120) NOT NULL,
  "mime_type" varchar(100) NOT NULL,
  "size_bytes" integer NOT NULL,
  "duration_seconds" integer,
  "data" bytea NOT NULL,
  "created_by_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_attachments_lead_idx" ON "lead_attachments" ("tenant_id", "lead_id");
--> statement-breakpoint

ALTER TABLE "lead_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "lead_attachments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_lead_attachments ON lead_attachments;
  CREATE POLICY tenant_isolation_lead_attachments ON lead_attachments
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "lead_attachments" TO friendly_app_runtime;
  END IF;
END $$;
