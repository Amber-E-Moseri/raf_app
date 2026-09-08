# RAF Stabilization PostgreSQL Isolation Validation

Date: 2026-09-05

Status: BLOCKED for live database execution. Harness and source-level checks are in place, but no non-production PostgreSQL credentials were available in this environment.

## Environment Used

Local repository validation only.

Observed environment:

| Variable | State |
| --- | --- |
| `DATABASE_URL` | missing |
| `RAF_CONFIRM_NON_PRODUCTION_DB` | missing |
| `RAF_RUN_POSTGRES_RLS_TESTS` | missing |

`SUPABASE_DATABASE_URL` remains a deprecated compatibility fallback. New provider-neutral validation must use `DATABASE_URL`.

## Migration Validation

The repeatable validation command is:

```powershell
$env:DATABASE_URL = "postgres://..."
$env:RAF_CONFIRM_NON_PRODUCTION_DB = "true"
$env:RAF_VALIDATE_APPLY_MIGRATIONS = "true"
node scripts/validatePostgresPhase25.js
```

The script now discovers every SQL file in `db/migrations` and applies them in filename order:

1. `20260313120000_create_raf_schema.sql`
2. `20260313133000_add_import_workflow_tables.sql`
3. `20260313143000_add_monthly_reviews.sql`
4. `20260313150000_extend_import_review_metadata.sql`
5. `20260313152000_update_merchant_rules_shape.sql`
6. `20260313170000_harden_backend_integrity.sql`
7. `20260903090000_workspace_postgres_persistence.sql`
8. `20260903120000_financial_accounts.sql`
9. `20260904000000_collaboration.sql`

The authoritative production SaaS schema is the `raf.*` workspace schema. The older `public.*` migrations remain compatibility history and should not be treated as the target tenant model.

## Tables Covered

Validation checks the expected `raf.*` tables, including:

- `workspaces`
- `workspace_members`
- `households`
- `financial_accounts`
- `account_reconciliations`
- `transactions`
- `income_entries`
- `income_allocations`
- `allocation_categories`
- `surplus_split_rules`
- `debts`
- `debt_payments`
- `debt_adjustments`
- `fixed_bills`
- `goals`
- `monthly_reviews`
- `import_batches`
- `imported_transaction_rows`
- `imported_transactions`
- `merchant_rules`
- `import_review_rules`
- `remi_conversations`
- `remi_messages`
- `pdf_import_quotas`
- `email_preferences`
- `email_send_log`
- `workspace_invitations`
- `workspace_activity`

## Attack Scenarios

The live integration test command is:

```powershell
$env:DATABASE_URL = "postgres://..."
$env:RAF_CONFIRM_NON_PRODUCTION_DB = "true"
$env:RAF_RUN_POSTGRES_RLS_TESTS = "true"
node --test tests/postgresRlsIsolation.integration.test.js
```

The harness creates Workspace A and Workspace B with separate principals and representative financial records.

Expected blocked scenarios:

- Workspace A principal cannot select Workspace B tenant rows.
- Workspace A principal cannot insert rows into Workspace B.
- Workspace A principal cannot update Workspace B rows.
- Workspace A principal cannot delete Workspace B rows.
- Workspace A principal cannot associate Workspace A transactions/imports/reconciliations with Workspace B accounts.
- Workspace A principal cannot discover Workspace B data through joins.
- Guessed UUID access returns no private rows.
- Workspace membership, not `x-workspace-id` style selection, determines database access.
- Transaction-local RLS context does not leak through a reused pooled connection.

## Fixes Made

- Added `FORCE ROW LEVEL SECURITY` to workspace-owned RAF financial/support tables so table-owner connections cannot silently bypass tenant policies.
- Added forced-RLS assertions to source-level migration tests.
- Expanded `scripts/validatePostgresPhase25.js` to apply all migrations in deterministic filename order and validate forced RLS on tenant-owned tables.
- Expanded `tests/postgresRlsIsolation.integration.test.js` to cover additional tenant-owned tables, financial account tenancy, cross-workspace foreign-key association attempts, workspace membership mutation attempts, and pooled connection context leakage.

## Source-Level Verification

Commands run locally:

```powershell
node --test tests\postgresMigrationSchema.test.js tests\postgresAdapterHardening.test.js tests\postgresRlsIsolation.integration.test.js
node scripts\validatePostgresPhase25.js
```

Results:

- Source-level Postgres migration/adapter tests passed.
- Live RLS tests were skipped because the required env vars were not present.
- Validation script failed closed with `DATABASE_URL is required.`

## Actual Live Result

Not executed. No `DATABASE_URL` was available, and non-production database confirmation was not set.

## Remaining Risks

- P0: Real PostgreSQL RLS isolation is still unproven until the live test runs against a disposable non-production database.
- P1: The app must ensure production connects through a role subject to RLS and uses transaction-local RAF context for every tenant-scoped operation.
- P1: Compatibility `public.*` migrations still exist as historical artifacts; operators must treat `raf.*` as the production target.
- P2: The Postgres compatibility adapter remains transitional for unmigrated domains.

## Gate

`PHASE 2 POSTGRES TENANT ISOLATION VALIDATION: BLOCKED`

Do not declare PostgreSQL tenant isolation validated until the live commands above pass against a real non-production PostgreSQL database.
