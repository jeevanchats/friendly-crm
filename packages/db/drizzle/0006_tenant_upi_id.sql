-- ============================================================
-- 0006_tenant_upi_id.sql
-- The business's UPI ID, so the WhatsApp dues summary can include UPI payment links.
--  * tenants.upi_id (nullable; null = no payment links are offered)
--  * lookup_customer_by_phone also returns it, so the bot has it after the customer is verified.
--    It is the business's own public payee address, not a secret, and the bot only shows it
--    after the sender passes the ownership check.
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0005.
-- ============================================================

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "upi_id" varchar(100);
--> statement-breakpoint

-- Return type changes, so the function must be dropped and recreated.
DROP FUNCTION IF EXISTS lookup_customer_by_phone(text);
--> statement-breakpoint

CREATE FUNCTION lookup_customer_by_phone(p_phone text)
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
  SELECT c.id,
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
  WHERE (c.phone = p_phone OR c.whatsapp_number = p_phone)
    AND t.is_active = true
  ORDER BY t.name
  LIMIT 10;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION lookup_customer_by_phone(text) FROM PUBLIC;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION lookup_customer_by_phone(text) TO friendly_app_runtime;
  END IF;
END $$;
