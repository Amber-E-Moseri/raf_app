# RAF Postgres Persistence Migration

Read [RAF_PRODUCT_CONSTITUTION.md](RAF_PRODUCT_CONSTITUTION.md) before changing persistence or financial behavior. See [architecture.md](architecture.md) and [phase-2.5-validation.md](phase-2.5-validation.md) for the current SaaS persistence validation gate.

## Current Persistence Audit

RAF currently has three persistence shapes:

- `meta.db`: cross-tenant SQLite metadata for users, households, workspace compatibility rows, and memberships.
- `db/households/*.db`: per-household SQLite databases for financial records. These rows include `householdId` in their `raw_json` payloads even though each file is tenant-specific.
- `db/migrations/*.sql`: older Postgres migrations that create `public.*` household-scoped tables using `household_id` and owner-only RLS.

Phase 2 keeps SQLite for local/demo/test use and introduces production Postgres persistence in a dedicated `raf` schema. The older `public.*` migrations are not destructively reshaped in this phase.

Provider-specific SQL audit:

- `db/migrations/20260313170000_harden_backend_integrity.sql` contains legacy `auth.uid()` policies for the old `public.*` schema path.
- `db/migrations/20260903090000_workspace_postgres_persistence.sql` is the active shared `raf` schema migration and uses provider-neutral transaction-local RAF settings instead of Supabase Auth helpers.
- Do not apply the old `public.*` RLS migration as the production SaaS schema target.

## Production Target

Production API requests should use:

```text
RAF API -> server-side RAF services -> persistence adapter -> PostgreSQL
```

The frontend must not call database tables directly for financial writes. The server-side RAF domain/service layer remains the authority for deterministic allocation, debt, income, review, and reporting behavior.

During Phase 2.5, `lib/server/postgresDb.js` is explicitly treated as a Postgres compatibility adapter. It preserves existing RAF financial behavior by hydrating `raw_json` rows into the in-memory adapter inside a transaction, then flushing diffs back to Postgres. This bridge is transitional and should be replaced incrementally by direct repository SQL for hot/high-risk paths.

## Money Representation

Postgres uses `NUMERIC(12,2)` for money and `NUMERIC(6,4)` for allocation percentages.

This matches current RAF API behavior, which accepts and returns money as decimal strings such as `"1250.00"`. Integer minor units would be a reasonable future option, but switching representation in this phase would create avoidable risk across existing decimal-string calculations and tests.

## Migration Path

1. Apply `db/migrations/20260903090000_workspace_postgres_persistence.sql`.
2. Configure production with `RAF_PERSISTENCE_DRIVER=postgres` and `DATABASE_URL`.
3. Export SQLite metadata:
   - `users`
   - `workspaces`
   - `workspace_members`
   - `households`
   - `user_households`
4. Export each per-household SQLite database and map `householdId` to `workspace_id`.
5. Insert into the matching `raf.*` tables inside a single transaction per workspace.
6. Run reconciliation checks before cutting traffic to Postgres.

## Reconciliation Checks

Use `verifyMigrationReconciliation` from `lib/server/migrationVerification.js` after loading SQLite source and Postgres target adapters.

For each workspace, verify:

- record counts for income, income allocations, transactions, debts, debt payments, debt adjustments, goals, fixed bills, imports, merchant/import rules, monthly reviews, Remi conversations/messages, email preferences, subscriptions/quotas, and logs
- every tenant-owned row has the expected `workspace_id`
- income totals by month reconcile exactly
- income allocation totals equal income entry amounts
- active allocation percentages sum to `1.0000 +/- 0.0001`
- active surplus split percentages sum to `1.0000 +/- 0.0001`
- debt balances derived from starting balance, payments, and adjustments reconcile
- goal progress derived from transactions and bucket linkage reconciles
- monthly review net surplus and distributions reconcile
- reports return the same financial values for representative periods

## RLS Model

All tenant-owned `raf.*` tables enable RLS. Policies call `raf.has_workspace_membership(workspace_id)` and write policies call `raf.has_workspace_role(...)`.

The helper functions are `SECURITY DEFINER` and read provider-neutral transaction-local settings plus `raf.workspace_members` directly to avoid recursive RLS policy evaluation. They must use an explicit `search_path` and must not call provider-specific functions such as `auth.uid()` or `auth.jwt()`.

## Phase 2.5 Validation

Validate a non-production PostgreSQL database with:

```powershell
$env:DATABASE_URL = "postgres://..."
$env:RAF_CONFIRM_NON_PRODUCTION_DB = "true"
$env:RAF_VALIDATE_APPLY_MIGRATIONS = "true"
node scripts/validatePostgresPhase25.js
```

Run database-level RLS isolation tests with:

```powershell
$env:DATABASE_URL = "postgres://..."
$env:RAF_CONFIRM_NON_PRODUCTION_DB = "true"
$env:RAF_RUN_POSTGRES_RLS_TESTS = "true"
node --test tests/postgresRlsIsolation.integration.test.js
```

`SUPABASE_DATABASE_URL` is retained only as a deprecated compatibility fallback. New environments should use `DATABASE_URL`.

## Rollback

Because Phase 2 writes to a separate `raf` schema, rollback is operationally simple:

1. Set `RAF_PERSISTENCE_DRIVER=sqlite`.
2. Restart the API.
3. Keep the `raf` schema intact for forensic comparison until reconciliation is complete.

If the migration must be removed after validation:

```sql
DROP SCHEMA raf CASCADE;
```

Do not drop the old SQLite files or old `public.*` tables until financial reconciliation has passed and a backup has been retained.
