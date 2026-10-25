-- ============================================================
-- 0010_products.sql
-- Product / service master: the items a business sells, with the defaults that fill a quotation line
-- (unit, rate, GST %, HSN/SAC). A quotation line is a COPY of these values, so changing a product later
-- never alters a quote or invoice that was already made. Products are archived, not deleted.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0009.
-- ============================================================

CREATE TABLE IF NOT EXISTS "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "name" varchar(200) NOT NULL,
  "code" varchar(50),
  "description" text,
  "hsn_code" varchar(8),
  "unit" varchar(30) DEFAULT 'Nos' NOT NULL,
  "unit_price" numeric(12, 2) DEFAULT 0 NOT NULL,
  "tax_percent" numeric(5, 2) DEFAULT 18 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A business cannot have two products with the same name (ignoring case) or the same code.
CREATE UNIQUE INDEX IF NOT EXISTS "products_tenant_name_idx" ON "products" ("tenant_id", lower("name"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_tenant_code_idx" ON "products" ("tenant_id", lower("code")) WHERE "code" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_tenant_active_idx" ON "products" ("tenant_id", "is_active");
--> statement-breakpoint

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_products ON products;
  CREATE POLICY tenant_isolation_products ON products
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "products" TO friendly_app_runtime;
  END IF;
END $$;
