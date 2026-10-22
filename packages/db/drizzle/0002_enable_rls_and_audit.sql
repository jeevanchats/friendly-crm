-- ============================================================
-- 0002_enable_rls_and_audit.sql
-- Friendly CRM: Phase 3 Database Isolation, Audit & RLS Migration
-- ============================================================

-- 1. Create Sessions Table
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_idx" ON "sessions" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
--> statement-breakpoint

-- 2. Create OTP Verifications Table
CREATE TABLE IF NOT EXISTS "otp_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "otp_verifications_phone_idx" ON "otp_verifications" ("phone", "consumed_at", "expires_at");
--> statement-breakpoint

-- 3. Create Durable Append-Only Audit Logs Table
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(64),
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" varchar(50),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_idx" ON "audit_logs" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" ("tenant_id", "entity_type", "entity_id");
--> statement-breakpoint

-- 4. Enable Row-Level Security on all tenant-owned tables
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotation_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Force RLS even for table owners
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "quotations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "quotation_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 5. Create Parameterized Row-Level Security Policies
-- Anchored strictly to: NULLIF(current_setting('app.current_tenant_id', true), '')::uuid

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_memberships ON memberships;
  CREATE POLICY tenant_isolation_memberships ON memberships
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_customers ON customers;
  CREATE POLICY tenant_isolation_customers ON customers
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_leads ON leads;
  CREATE POLICY tenant_isolation_leads ON leads
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_tasks ON tasks;
  CREATE POLICY tenant_isolation_tasks ON tasks
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_activities ON activities;
  CREATE POLICY tenant_isolation_activities ON activities
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_quotations ON quotations;
  CREATE POLICY tenant_isolation_quotations ON quotations
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_quotation_items ON quotation_items;
  CREATE POLICY tenant_isolation_quotation_items ON quotation_items
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_orders ON orders;
  CREATE POLICY tenant_isolation_orders ON orders
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_order_items ON order_items;
  CREATE POLICY tenant_isolation_order_items ON order_items
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_invoices ON invoices;
  CREATE POLICY tenant_isolation_invoices ON invoices
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_payments ON payments;
  CREATE POLICY tenant_isolation_payments ON payments
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_payment_allocations ON payment_allocations;
  CREATE POLICY tenant_isolation_payment_allocations ON payment_allocations
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
  CREATE POLICY tenant_isolation_audit_logs ON audit_logs
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

-- 6. GIN Indexes on Custom Data JSONB Columns for rapid MSME field lookups
CREATE INDEX IF NOT EXISTS "idx_leads_custom_data_gin" ON "leads" USING GIN ("custom_data");
CREATE INDEX IF NOT EXISTS "idx_orders_custom_data_gin" ON "orders" USING GIN ("custom_data");
CREATE INDEX IF NOT EXISTS "idx_quotations_custom_data_gin" ON "quotations" USING GIN ("custom_data");
CREATE INDEX IF NOT EXISTS "idx_customers_custom_data_gin" ON "customers" USING GIN ("custom_data");
--> statement-breakpoint

-- 7. Restricted Runtime Database Role & Privileges
-- Runtime role is NOBYPASSRLS, NOSUPERUSER, cannot alter schema or tamper with audit trail
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    CREATE ROLE friendly_app_runtime WITH LOGIN PASSWORD 'change_in_production_runtime_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO friendly_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO friendly_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO friendly_app_runtime;

-- Immutable Audit Guard: Prevent UPDATE and DELETE on audit and activity records
REVOKE UPDATE, DELETE ON "audit_logs" FROM friendly_app_runtime;
REVOKE UPDATE, DELETE ON "activities" FROM friendly_app_runtime;
