-- ============================================================
-- 0022_credit_transfers.sql
-- Using the credit on one order against what another order of the SAME customer still owes. An order is in credit when the
-- customer paid more than it now comes to (after a credit note). Instead of handing that money back (refunds, 0020), the
-- business can move it to another open order. The two orders' advance_received change by the same amount; this table is the
-- record of the move.
-- Append-only like a receipt: the app role can read and add transfers, never change or delete one.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0021.
-- ============================================================

CREATE TABLE IF NOT EXISTS "credit_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "transfer_number" varchar(50) NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "from_order_id" uuid NOT NULL REFERENCES "orders"("id"),
  "to_order_id" uuid NOT NULL REFERENCES "orders"("id"),
  "amount" numeric(12, 2) NOT NULL CHECK ("amount" > 0),
  "transferred_by_id" uuid NOT NULL REFERENCES "users"("id"),
  "transferred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_transfers_two_orders" CHECK ("from_order_id" <> "to_order_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_transfers_tenant_number_idx" ON "credit_transfers" ("tenant_id", "transfer_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_transfers_from_idx" ON "credit_transfers" ("tenant_id", "from_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_transfers_to_idx" ON "credit_transfers" ("tenant_id", "to_order_id");
--> statement-breakpoint

ALTER TABLE "credit_transfers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_transfers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_credit_transfers ON credit_transfers;
  CREATE POLICY tenant_isolation_credit_transfers ON credit_transfers
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT SELECT, INSERT ON "credit_transfers" TO friendly_app_runtime;
  END IF;
END $$;
