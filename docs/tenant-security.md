# RAF Tenant Security

Read [RAF_PRODUCT_CONSTITUTION.md](RAF_PRODUCT_CONSTITUTION.md) before changing tenant isolation, authorization, persistence, or financial behavior.

## Decision

RAF uses Option A:

```text
Application authorization + PostgreSQL RLS
```

The RAF Node/Express API remains the application boundary. The browser never connects directly to financial database tables.

Request flow:

```text
React/Vite
-> RAF Node/Express API
-> authenticated identity
-> workspace authorization
-> RAF domain services
-> persistence layer
-> PostgreSQL
-> RLS defense in depth
```

## Authorization Model

The requested workspace ID is only a selector. It is never proof of access.

Authorization is:

```text
authenticated identity
-> workspace membership
-> role/permission
-> domain operation
```

Every tenant-scoped repository/query must include workspace ownership. Direct-object-reference access by ID alone is forbidden.

Required pattern:

```sql
SELECT *
FROM transactions
WHERE id = $1
AND workspace_id = $2;
```

## Provider-Neutral RLS Context

PostgreSQL RLS is retained as defense in depth because it is a PostgreSQL capability, not a Supabase requirement.

RAF does not use Supabase `auth.uid()`, `auth.jwt()`, `request.jwt.*`, service-role semantics, or browser-to-database access for RLS.

Within a trusted server transaction, the persistence layer may set transaction-local context:

```sql
SELECT set_config('raf.user_id', $1, true);
SELECT set_config('raf.workspace_id', $2, true);
```

The third argument, `true`, makes the values transaction-local so pooled connections do not leak request context across users.

RLS helper functions read:

- `raf.current_app_user_id()` from `current_setting('raf.user_id', true)`
- `raf.current_workspace_id()` from `current_setting('raf.workspace_id', true)`
- `raf.has_workspace_membership(workspace_id)` from `raf.workspace_members`
- `raf.has_workspace_role(workspace_id, allowed_roles)` from `raf.workspace_members`

The helpers are `SECURITY DEFINER` only so policies can inspect membership rows without recursive RLS evaluation. They use `SET search_path = raf, pg_catalog`.

## Trust Boundary

Only the RAF API may set database tenant context. Browser headers such as `x-workspace-id` select a workspace for the API request but do not authorize database access.

The API must verify:

```text
token/session identity -> workspace membership -> permission
```

before a route receives trusted workspace context or before a scoped Postgres transaction is opened.

## Function Grants

The provider-neutral migration revokes helper execute privileges and grants them to `PUBLIC` because generic PostgreSQL deployments do not have a portable built-in application role name.

This is acceptable only under RAF's architecture because:

- the database is not exposed to browsers
- the helper functions return only the current configured UUID or a boolean
- direct database clients are trusted operational clients, not end users
- the server still performs primary authorization before opening scoped transactions

For stricter deployments, create a dedicated database role such as `raf_app`, grant table access and helper execute only to that role, and revoke helper execute from `PUBLIC`.

## Security Context Propagation

Branch E resolved a P0 gap: `db.transaction()` accepted a `securityContext` parameter but no call site passed it, so `raf.user_id` / `raf.workspace_id` were never set in production.

The fix is in `lib/server/routerLoader.js`. After `resolveTrustedContext()` verifies the JWT and workspace membership, it returns a scoped `db` object whose `transaction()` method is wrapped to auto-inject the confirmed identity:

```js
function withSecurityContext(db, securityContext) {
  if (!securityContext?.userId && !securityContext?.workspaceId) return db;
  return {
    ...db,
    transaction: (callback) => db.transaction(callback, securityContext),
  };
}
```

Route handlers call `db.transaction(callback)` as before. The wrapper supplies `{ userId, workspaceId }` transparently. No domain code changes were required.

## RLS Policy Requirement

Financial table policies require both session variables to be set (Phase 2 tightened policies):

```sql
CREATE POLICY income_entries_workspace_policy ON raf.income_entries
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);
```

The explicit `workspace_id = raf.current_workspace_id()` check eliminates the IS NULL escape that was present in `has_workspace_membership()` — a session with only `raf.user_id` set (no `raf.workspace_id`) receives zero rows from all 22 financial tables.

Workspace coordination tables (`workspaces`, `workspace_members`, `workspace_invitations`, `workspace_activity`) retain the original policy (IS NULL escape allowed) because they must be readable during the membership verification step, before `raf.workspace_id` is confirmed.

## FORCE ROW LEVEL SECURITY

All 22 financial tables have `FORCE ROW LEVEL SECURITY`. This ensures RLS applies even when the connecting database role is the table owner.

**Important:** `FORCE ROW LEVEL SECURITY` does not override `BYPASSRLS`. If the application connects as a superuser or a role with `BYPASSRLS`, RLS is still skipped. Production deployments must use a dedicated `raf_app` role without `BYPASSRLS`. See `docs/architecture-closure-e.md` for the role setup SQL.

## Tests

Coverage:

- `tests/tenantIsolation.test.js` exercises the production router and confirms headers alone do not authorize access.
- `tests/postgresMigrationSchema.test.js` rejects Supabase-specific RLS helpers and verifies provider-neutral helper configuration.
- `tests/postgresRlsIsolation.integration.test.js` runs against a real non-production PostgreSQL database when `DATABASE_URL`, `RAF_CONFIRM_NON_PRODUCTION_DB=true`, and `RAF_RUN_POSTGRES_RLS_TESTS=true` are present.
- `tests/postgresRepositoryTenantIsolation.test.js` creates two live users and workspaces, populates Workspace A, and verifies Workspace B cannot see any of its data. Requires `POSTGRES_CONNECTION_STRING`. All 8 tests pass.
- `tests/branchEAdversarialApi.test.js` covers selector attacks, IDOR attacks, payload injection, role escalation, membership lifecycle, auth boundary, public routes, and compat path security. Requires `POSTGRES_CONNECTION_STRING`.
- `tests/branchERlsEnforcement.test.js` proves PostgreSQL-level RLS enforcement via direct SQL without going through the application layer. Requires `DATABASE_URL`, `RAF_RUN_POSTGRES_RLS_TESTS=true`, `RAF_CONFIRM_NON_PRODUCTION_DB=true`.

## Transitional Limits

`lib/server/postgresDb.js` is still a Postgres compatibility adapter. It sets provider-neutral transaction-local context and uses an advisory transaction lock, but it hydrates rows into the in-memory adapter and flushes diffs.

Direct SQL repositories should replace the compatibility adapter first for:

- workspace memberships
- financial accounts
- transactions
- imports
- allocation configuration
