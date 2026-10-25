-- ============================================================
-- 0007_gst_invoices.sql
-- GST tax invoices.
--  * tenants: legal name, address and GST state code (the supplier block of an invoice)
--  * customers: GST state code (place of supply when the customer has no GSTIN)
--  * quotation_items / order_items: HSN / SAC code per line
--  * invoices: reshaped for GST (supply type, place of supply, CGST/SGST/IGST, round-off,
--    supplier and buyer snapshots). The table was never written to before this migration.
--  * invoice_items: immutable line snapshot
--  * invoice_counters: gapless invoice numbers per business per financial year (April-March)
--
-- Issued invoices are statutory records: the runtime role may INSERT but not UPDATE or DELETE them.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0006.
-- ============================================================

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legal_name" varchar(200);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "address" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "state_code" varchar(2);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "state_code" varchar(2);
--> statement-breakpoint
ALTER TABLE "quotation_items" ADD COLUMN IF NOT EXISTS "hsn_code" varchar(8);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "hsn_code" varchar(8);
--> statement-breakpoint

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "financial_year" varchar(7);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "supply_type" varchar(5);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "place_of_supply" varchar(2);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "taxable_value" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "cgst_amount" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sgst_amount" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "igst_amount" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "round_off" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "supplier" jsonb;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "buyer" jsonb;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "issued_by_id" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "issued_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenant_number_idx" ON "invoices" ("tenant_id", "invoice_number");
--> statement-breakpoint
-- One invoice per order for now (advance / part invoices and credit notes come later).
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenant_order_idx" ON "invoices" ("tenant_id", "order_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "invoice_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE cascade,
  "line_no" integer NOT NULL,
  "item_name" varchar(200) NOT NULL,
  "description" text,
  "hsn_code" varchar(8) NOT NULL,
  "quantity" numeric(10, 2) NOT NULL,
  "unit" varchar(30) NOT NULL,
  "unit_price" numeric(12, 2) NOT NULL,
  "tax_percent" numeric(5, 2) NOT NULL,
  "taxable_value" numeric(12, 2) NOT NULL,
  "cgst_amount" numeric(12, 2) NOT NULL,
  "sgst_amount" numeric(12, 2) NOT NULL,
  "igst_amount" numeric(12, 2) NOT NULL,
  "line_total" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_items_invoice_idx" ON "invoice_items" ("tenant_id", "invoice_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "invoice_counters" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "financial_year" varchar(7) NOT NULL,
  "last_number" integer DEFAULT 0 NOT NULL,
  PRIMARY KEY ("tenant_id", "financial_year")
);
--> statement-breakpoint

ALTER TABLE "invoice_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoice_counters" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_invoice_items ON invoice_items;
  CREATE POLICY tenant_isolation_invoice_items ON invoice_items
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_invoice_counters ON invoice_counters;
  CREATE POLICY tenant_isolation_invoice_counters ON invoice_counters
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "invoice_items", "invoice_counters" TO friendly_app_runtime;
    -- Issued invoices cannot be edited or deleted by the application.
    REVOKE UPDATE, DELETE ON "invoices" FROM friendly_app_runtime;
    REVOKE UPDATE, DELETE ON "invoice_items" FROM friendly_app_runtime;
  END IF;
END $$;
