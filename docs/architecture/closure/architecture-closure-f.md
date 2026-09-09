# Architecture Closure F — PostgreSQL Runtime Role (BYPASSRLS Removal)

**Branch F Final Report | 2026-09-09**

---

## Declaration

```
ARCHITECTURE CLOSURE F: READY
```

Branch F is complete. The `raf_app` least-privilege runtime role is defined, its creation migration is registered, the application server prefers it via `POSTGRES_CONNECTION_STRING_APP`, and startup verification rejects unsafe roles in production. Branch G must not begin until explicitly authorized.

---

## Problem Statement (G6 carry-forward from Branch E)

Branch E established correct RLS policies on all 22 financial tables and wired `withSecurityContext` to set `raf.user_id` and `raf.workspace_id` in every PostgreSQL transaction. However, the application was connecting as `neondb_owner`, which has the `BYPASSRLS` attribute. In PostgreSQL, a role with `BYPASSRLS` skips all row-level security policies regardless of `FORCE ROW LEVEL SECURITY`. The three-layer isolation model's third layer (PostgreSQL RLS) was structurally correct but silently inactive.

**Security posture before Branch F:**
- Layer 1 (application authorization) — active ✅
- Layer 2 (workspace-scoped SQL) — active ✅
- Layer 3 (PostgreSQL RLS) — policies correct, session vars set, **but skipped by BYPASSRLS** ⚠️

**Security posture after Branch F:**
- Layer 1 (application authorization) — active ✅
- Layer 2 (workspace-scoped SQL) — active ✅
- Layer 3 (PostgreSQL RLS) — active ✅ (once `POSTGRES_CONNECTION_STRING_APP` is configured)

---

## What Changed

### `db/migrations/20260909000000_create_raf_app_role.sql`

Creates the `raf_app` PostgreSQL role with:
- `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`
- `GRANT USAGE ON SCHEMA raf`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA raf`
- `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA raf`
- `GRANT EXECUTE ON ALL FUNCTIONS/PROCEDURES IN SCHEMA raf`
- `ALTER DEFAULT PRIVILEGES` so future tables/sequences/functions auto-grant to `raf_app`

The role does **not** have `BYPASSRLS`. The role does **not** have `SUPERUSER`. These are the controlling properties that activate RLS evaluation.

On Neon: the `CREATE ROLE` block is a no-op (`IF NOT EXISTS`) — the role is created in Neon Console and its password is managed there. The GRANT statements run regardless.

### `lib/server/env.js` (already complete from Branch E Phase 6)

- Accepts `POSTGRES_CONNECTION_STRING_APP` (the `raf_app` connection).
- When present, the server uses it as the runtime connection; `POSTGRES_CONNECTION_STRING` is used only by `scripts/migrate.js`.
- Exports `checkRuntimeRolePrivileges()` — queries `pg_roles` at startup to verify `rolsuper = false` and `rolbypassrls = false`.
  - In production (`authRequired=true`): **throws** if the role is unsafe. Server refuses to start.
  - In development (`authRequired=false`): logs a warning.

### `index.js` (already complete from Branch E Phase 6)

Calls `checkRuntimeRolePrivileges()` once at startup, before accepting any requests.

### `.env.example`

Documents both connection strings and their distinct roles:
- `POSTGRES_CONNECTION_STRING` — privileged, for migrations
- `POSTGRES_CONNECTION_STRING_APP` — restricted (`raf_app`), for the running server

### `scripts/migrate.js`

Migration `20260909000000_create_raf_app_role.sql` registered. Runs as `POSTGRES_CONNECTION_STRING` (privileged), which has the authority to CREATE ROLE and GRANT.

---

## Deployment Checklist

For any shared or production Neon deployment:

- [ ] Create `raf_app` role in Neon Console → Settings → Roles
- [ ] Record the generated password (Neon does not show it again)
- [ ] Run `node scripts/migrate.js` — confirms `20260909000000_create_raf_app_role.sql` applies cleanly
- [ ] Set `POSTGRES_CONNECTION_STRING_APP=postgresql://raf_app:<password>@<host>/neondb?sslmode=require` in deployment env
- [ ] Restart the server; confirm startup log shows:
  ```
  [RAF] runtime role "raf_app": NOBYPASSRLS NOSUPERUSER — RLS active ✓
  ```
- [ ] Run RLS enforcement tests through `raf_app` connection (see Verification below)

---

## Verification

Run the Branch E RLS enforcement test suite using the `raf_app` connection string:

```bash
RAF_RUN_POSTGRES_RLS_TESTS=true \
RAF_CONFIRM_NON_PRODUCTION_DB=true \
DATABASE_URL=<raf_app connection string> \
npx jest tests/branchERlsEnforcement
```

All tests must pass. Prior runs (Branch E) used `neondb_owner` — those passes confirmed the policies and session vars are correct. This run confirms RLS evaluation is not bypassed.

**Expected result:** 100% pass. Any failure indicates either a missing grant (raf_app cannot read a table) or a residual BYPASSRLS attribute.

---

## Security Model — Final State After Branch F

```
authentication
  → trusted user identity (JWT verification + blacklist check)
  → workspace selector (x-workspace-id header)
  → membership verification (DB lookup with raf.user_id set)
  → permission verification (role → permission map)
  → trusted security context (userId + workspaceId verified)
  → PostgreSQL transaction (db.transaction via withSecurityContext wrapper)
      → SET LOCAL raf.user_id / SET LOCAL raf.workspace_id
  → workspace-scoped repository query (WHERE workspace_id = $N)
  → PostgreSQL RLS (22 financial tables, FORCE ROW LEVEL SECURITY)
      → workspace_id = raf.current_workspace_id()
      → AND raf.has_workspace_membership(workspace_id)
```

Three independent layers each independently enforce tenant isolation. Compromise of any single layer does not grant cross-tenant data access.

---

## What Remains Compat-Backed (Unchanged)

Monthly reviews (6 methods) and the import pipeline (24 methods) remain on the compatibility path. Both paths now receive the full security context via `withSecurityContext` (Branch E fix). They are architectural debt but not security blockers.
