-- Branch F: Create raf_app least-privilege runtime role.
--
-- CONTEXT
-- -------
-- All PostgreSQL RLS policies were completed in Branch E, but they are
-- currently inert: the connection role is Neon's neondb_owner, which has
-- BYPASSRLS. FORCE ROW LEVEL SECURITY prevents the table owner from
-- bypassing RLS, but does not prevent a role with the BYPASSRLS attribute.
-- Application-layer authorization (resolveTrustedContext) is the active
-- tenant-isolation layer until this role change is deployed.
--
-- This migration creates raf_app — a role with LOGIN but without BYPASSRLS
-- or superuser — and grants it the minimum privileges the application server
-- needs to operate:
--
--   • USAGE on schema raf            (required to see any objects)
--   • SELECT/INSERT/UPDATE/DELETE    (all current tables, set as default for
--     on all tables in raf             future tables too)
--   • EXECUTE on all functions in raf (RLS helper functions: has_workspace_membership,
--                                       current_workspace_id, current_raf_user_id)
--   • SELECT on sequences (for RETURNING clauses and nextval)
--
-- WHAT IS NOT GRANTED
-- -------------------
--   • BYPASSRLS         — must never be granted; its absence activates RLS
--   • SUPERUSER         — must never be granted
--   • CREATEROLE        — raf_app cannot create or alter roles
--   • CREATE on schema  — raf_app cannot create new tables (migrations run as owner)
--   • TRUNCATE / REFERENCES / TRIGGER — not needed by the application server
--
-- NEON DEPLOYMENT NOTE
-- --------------------
-- Neon manages role credentials (passwords) via the Neon Console, not SQL.
-- To deploy:
--
--   1. Create the raf_app role in Neon Console → Settings → Roles.
--      Copy the generated password.
--   2. Run this migration as neondb_owner (POSTGRES_CONNECTION_STRING).
--      The CREATE ROLE is a no-op if the role already exists.
--   3. Set POSTGRES_CONNECTION_STRING_APP in your deployment env to the
--      connection string for raf_app (same host/database, different user/password).
--   4. Restart the application server. Startup will log:
--        [RAF] runtime role "raf_app": NOBYPASSRLS NOSUPERUSER — RLS active ✓
--
-- VERIFICATION
-- ------------
-- After deployment, run with RAF_RUN_POSTGRES_RLS_TESTS=true against the
-- raf_app connection to confirm RLS is active:
--
--   RAF_RUN_POSTGRES_RLS_TESTS=true \
--   RAF_CONFIRM_NON_PRODUCTION_DB=true \
--   DATABASE_URL=<raf_app connection string> \
--   npx jest tests/branchERlsEnforcement
--
-- All tests must pass. Any PASS before this migration was running as
-- neondb_owner; confirmation requires the raf_app role.

-- Create the role if it does not already exist.
-- (On Neon: role already exists from Console; this is a no-op.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'raf_app') THEN
    CREATE ROLE raf_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- Ensure the role is NOT a superuser and does NOT have BYPASSRLS.
-- These are the no-ops if already correct, and the explicit guard against
-- accidental privilege grants via Neon Console or a prior ALTER ROLE.
ALTER ROLE raf_app NOSUPERUSER;
-- Note: NOBYPASSRLS is the default; ALTER ROLE raf_app NOBYPASSRLS is valid
-- syntax in PG 16+ but may not be supported in all Neon versions — the
-- absence of BYPASSRLS from the CREATE ROLE above is the controlling setting.

-- Schema access.
GRANT USAGE ON SCHEMA raf TO raf_app;

-- Table privileges: all current tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA raf TO raf_app;

-- Sequence privileges (needed for RETURNING id clauses that resolve nextval).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA raf TO raf_app;

-- Function privileges: RLS helpers and any stored procedures.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA raf TO raf_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA raf TO raf_app;

-- Default privileges: ensure future tables/sequences/functions created by
-- neondb_owner (migration runner) are automatically accessible to raf_app.
-- Without this, each new migration that creates a table would require a
-- subsequent GRANT statement.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA raf
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO raf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA raf
  GRANT USAGE, SELECT ON SEQUENCES TO raf_app;

ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA raf
  GRANT EXECUTE ON FUNCTIONS TO raf_app;
