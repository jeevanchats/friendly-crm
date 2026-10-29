-- ============================================================
-- 0018_customer_contacts.sql
-- A customer is a business; the people who deal with us for it are its contacts (owner, accounts, purchase...).
-- customers.phone stays the PRIMARY contact (reminders, invoices and quotes still go there); other people go here.
--
--  1. customer_contacts (one row per extra person), tenant isolated like every business table.
--     A mobile number identifies ONE customer in a business: unique here, and the application also refuses a number
--     that is already a customer's primary phone.
--  2. lookup_customer_by_phone() also recognises a contact's number, so the WhatsApp bot and Quick Add resolve a
--     contact to their customer.
--  3. One GSTIN, one customer per business (a second person at the same GSTIN is a contact, not a second customer).
--     The unique index is only created when no business already has a GSTIN twice; otherwise merge those customers
--     first and run this index by hand (the notice says so).
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0017.
-- ============================================================

CREATE TABLE IF NOT EXISTS "customer_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "designation" varchar(80),
  "phone" varchar(20) NOT NULL,
  "email" varchar(160),
  "created_by_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_contacts_tenant_phone_idx" ON "customer_contacts" ("tenant_id", "phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_contacts_customer_idx" ON "customer_contacts" ("tenant_id", "customer_id");
--> statement-breakpoint

ALTER TABLE "customer_contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_contacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_customer_contacts ON customer_contacts;
  CREATE POLICY tenant_isolation_customer_contacts ON customer_contacts
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_contacts" TO friendly_app_runtime;
  END IF;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION lookup_customer_by_phone(p_phone text)
RETURNS TABLE (
  customer_id uuid,
  customer_name text,
  tenant_id uuid,
  tenant_name text,
  tenant_phone text,
  industry_key text,
  default_language text,
  self_service_enabled boolean,
  upi_id text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (t.name, c.id)
         c.id,
         c.name::text,
         t.id,
         t.name::text,
         t.phone::text,
         t.industry_key::text,
         t.default_language::text,
         t.customer_self_service_enabled,
         t.upi_id::text
  FROM customers c
  JOIN tenants t ON t.id = c.tenant_id
  LEFT JOIN customer_contacts cc ON cc.customer_id = c.id AND cc.phone = p_phone
  WHERE (c.phone = p_phone OR c.whatsapp_number = p_phone OR cc.id IS NOT NULL)
    AND t.is_active = true
  ORDER BY t.name, c.id
  LIMIT 10;
$$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customers WHERE gstin IS NOT NULL AND gstin <> '' GROUP BY tenant_id, gstin HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_gstin_idx" ON "customers" ("tenant_id", "gstin")
      WHERE "gstin" IS NOT NULL AND "gstin" <> '';
  ELSE
    RAISE NOTICE 'customers_tenant_gstin_idx NOT created: some business has the same GSTIN on more than one customer. Merge them, then create the index (see 0018).';
  END IF;
END $$;
