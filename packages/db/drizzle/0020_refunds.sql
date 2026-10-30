-- ============================================================
-- 0020_refunds.sql
-- Money paid BACK to a customer. A credit note lowers an order's total; when the customer had already paid more than the
-- new total, the order is in credit (its balance is negative). A refund records the money handed back, which brings that
-- credit down towards zero (advance_received falls by the amount).
-- Append-only like a receipt: the app role can read and add refunds, never change or delete one.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0019.
-- ============================================================

CREATE TABLE IF NOT EXISTS "refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "refund_number" varchar(50) NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "order_id" uuid NOT NULL REFERENCES "orders"("id"),
  "amount" numeric(12, 2) NOT NULL CHECK ("amount" > 0),
  "mode" varchar(30) NOT NULL,
  "reference_no" varchar(100),
  "refunded_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "refunded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_tenant_number_idx" ON "refunds" ("tenant_id", "refund_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_order_reference_idx" ON "refunds" ("tenant_id", "order_id", "reference_no") WHERE "reference_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_order_idx" ON "refunds" ("tenant_id", "order_id");
--> statement-breakpoint

ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_refunds ON refunds;
  CREATE POLICY tenant_isolation_refunds ON refunds
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT SELECT, INSERT ON "refunds" TO friendly_app_runtime;
  END IF;
END $$;
