-- ============================================================
-- 0014_credit_notes.sql
-- GST credit notes (section 34): reduce an issued invoice for goods returned, a discount after the sale, a
-- correction or a cancellation. Each is a snapshot with its own gapless number per business per April-March year
-- (CN/2026-27/0001) and, like an invoice, can never be edited or deleted by the application.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0013.
-- ============================================================

CREATE TABLE IF NOT EXISTS "credit_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "credit_note_number" varchar(50) NOT NULL,
  "financial_year" varchar(7) NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id"),
  "order_id" uuid NOT NULL REFERENCES "orders"("id"),
  "customer_id" uuid NOT NULL REFERENCES "customers"("id"),
  "reason" varchar(30) NOT NULL,
  "reason_note" text,
  "supply_type" varchar(10) NOT NULL,
  "place_of_supply" varchar(2) NOT NULL,
  "taxable_value" numeric(12, 2) NOT NULL,
  "cgst_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
  "sgst_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
  "igst_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
  "round_off" numeric(12, 2) DEFAULT 0 NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "supplier" jsonb NOT NULL,
  "buyer" jsonb NOT NULL,
  "issued_by_id" uuid REFERENCES "users"("id"),
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_notes_amount_positive" CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_notes_tenant_number_idx" ON "credit_notes" ("tenant_id", "credit_note_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_notes_invoice_idx" ON "credit_notes" ("tenant_id", "invoice_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "credit_note_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "credit_note_id" uuid NOT NULL REFERENCES "credit_notes"("id") ON DELETE cascade,
  "invoice_item_id" uuid NOT NULL REFERENCES "invoice_items"("id"),
  "line_no" integer NOT NULL,
  "item_name" varchar(200) NOT NULL,
  "description" text,
  "hsn_code" varchar(8) NOT NULL,
  "quantity" numeric(10, 2) DEFAULT 0 NOT NULL,
  "unit" varchar(30) NOT NULL,
  "unit_price" numeric(12, 2) NOT NULL,
  "tax_percent" numeric(5, 2) NOT NULL,
  "taxable_value" numeric(12, 2) NOT NULL,
  "cgst_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
  "sgst_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
  "igst_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
  "line_total" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_note_items_note_idx" ON "credit_note_items" ("tenant_id", "credit_note_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_note_items_invoice_item_idx" ON "credit_note_items" ("tenant_id", "invoice_item_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "credit_note_counters" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "financial_year" varchar(7) NOT NULL,
  "last_number" integer DEFAULT 0 NOT NULL,
  PRIMARY KEY ("tenant_id", "financial_year")
);
--> statement-breakpoint

ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_note_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_note_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_note_counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_note_counters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_credit_notes ON credit_notes;
  CREATE POLICY tenant_isolation_credit_notes ON credit_notes
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_credit_note_items ON credit_note_items;
  CREATE POLICY tenant_isolation_credit_note_items ON credit_note_items
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_credit_note_counters ON credit_note_counters;
  CREATE POLICY tenant_isolation_credit_note_counters ON credit_note_counters
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "credit_notes", "credit_note_items", "credit_note_counters" TO friendly_app_runtime;
    -- Issued credit notes cannot be edited or deleted by the application.
    REVOKE UPDATE, DELETE ON "credit_notes" FROM friendly_app_runtime;
    REVOKE UPDATE, DELETE ON "credit_note_items" FROM friendly_app_runtime;
  END IF;
END $$;
