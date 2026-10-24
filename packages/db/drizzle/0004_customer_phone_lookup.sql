-- ============================================================
-- 0004_customer_phone_lookup.sql
-- Lets the WhatsApp bot recognise a CUSTOMER texting the business number.
--
-- Same pattern and same requirement as 0003: `customers` is protected by FORCE ROW LEVEL
-- SECURITY keyed on app.current_tenant_id, so the runtime role cannot search across tenants.
-- This SECURITY DEFINER function exposes one narrow read: the customer rows whose phone or
-- WhatsApp number is EXACTLY the given number, with just enough tenant info to reply.
-- It returns no order, balance, address, GSTIN or contact-list data.
--
-- REQUIREMENT: run as a role that bypasses RLS (the superuser / DATABASE_ADMIN_URL role).
-- ============================================================

CREATE OR REPLACE FUNCTION lookup_customer_by_phone(p_phone text)
RETURNS TABLE (
  customer_id uuid,
  customer_name text,
  tenant_id uuid,
  tenant_name text,
  tenant_phone text,
  industry_key text,
  default_language text
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
         t.default_language::text
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
