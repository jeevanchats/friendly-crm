-- ============================================================
-- 0005_tenant_customer_self_service.sql
-- Per-business opt-out for WhatsApp customer self-service.
--  * tenants.customer_self_service_enabled (default true = on, owner can switch it off)
--  * lookup_customer_by_phone now also returns the flag, so the bot can tell a customer of a
--    business that switched it off to contact the business directly (instead of "not registered").
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003/0004.
-- ============================================================

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "customer_self_service_enabled" boolean DEFAULT true NOT NULL;
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
  self_service_enabled boolean
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
         t.customer_self_service_enabled
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
