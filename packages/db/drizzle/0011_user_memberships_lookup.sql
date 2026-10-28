-- ============================================================
-- 0011_user_memberships_lookup.sql
-- Lets the restricted runtime role list ONE signed-in user's businesses.
--
-- `memberships` has FORCE ROW LEVEL SECURITY keyed on app.current_tenant_id, so before a business is chosen
-- (the business switcher, GET /auth/me, "which business is my default") the restricted role sees no rows at all.
-- This SECURITY DEFINER function exposes exactly one narrow, read-only capability: the membership rows of the
-- user id passed in, which the API takes from the verified session, never from the request body.
--
-- REQUIREMENT: run as a role that bypasses RLS (superuser / DATABASE_ADMIN_URL), like 0003-0010.
-- ============================================================

CREATE OR REPLACE FUNCTION list_user_memberships(p_user_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  user_id uuid,
  role text,
  is_active boolean,
  tenant_name text,
  industry_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.tenant_id,
         m.user_id,
         m.role::text,
         m.is_active,
         t.name::text,
         t.industry_key::text
  FROM memberships m
  JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id
  ORDER BY t.name;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION list_user_memberships(uuid) FROM PUBLIC;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'friendly_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION list_user_memberships(uuid) TO friendly_app_runtime;
  END IF;
END $$;
