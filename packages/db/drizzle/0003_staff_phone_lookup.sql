-- ============================================================
-- 0003_staff_phone_lookup.sql
-- Cross-tenant "who is this phone number?" lookup for the WhatsApp bot.
--
-- Why a function: `memberships` has FORCE ROW LEVEL SECURITY keyed on
-- app.current_tenant_id, so the restricted runtime role cannot list a person's
-- memberships across businesses before a tenant is chosen. This SECURITY DEFINER
-- function exposes exactly one narrow, read-only capability (active staff rows for
-- ONE exact phone number) instead of weakening the policies.
--
-- REQUIREMENT: run this migration as a role that bypasses RLS (the superuser /
-- DATABASE_ADMIN_URL role). A function owned by a plain table owner is still
-- subject to FORCE RLS and would return zero rows.
-- ============================================================

CREATE OR REPLACE FUNCTION lookup_staff_by_phone(p_phone text)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  preferred_language text,
  tenant_id uuid,
  tenant_name text,
  industry_key text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id,
         u.full_name::text,
         u.preferred_language::text,
         t.id,
         t.name::text,
         t.industry_key::text,
         m.role::text
  FROM users u
  JOIN memberships m ON m.user_id = u.id
  JOIN tenants t ON t.id = m.tenant_id
  WHERE u.phone = p_phone
    AND m.is_active = true
    AND t.is_active = true
  ORDER BY t.name;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION lookup_staff_by_phone(text) FROM PUBLIC;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION lookup_staff_by_phone(text) TO friendly_app_runtime;
  END IF;
END $$;
