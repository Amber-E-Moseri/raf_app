# RAF Phase 2.5 Validation

Read [RAF_PRODUCT_CONSTITUTION.md](RAF_PRODUCT_CONSTITUTION.md) before changing architecture, persistence, authorization, UI, AI, or financial logic.

Phase 2.5 validates the Phase 1 multi-tenant architecture and Phase 2 Postgres persistence before production authentication work proceeds. It must not introduce new financial behavior.

## Current Architecture

```text
React/Vite
-> RAF Node/Express API
-> authentication context
-> workspace membership
-> domain services
-> persistence adapter
-> Postgres
-> RLS
```

Authentication identifies the user. RAF authorization resolves workspace membership and permissions. Postgres RLS independently enforces workspace membership for tenant-owned tables as defense in depth. See [tenant-security.md](tenant-security.md).

## Component Readiness

- Product Constitution: Production Ready
- Workspace permission model: Production Ready, pending broader route cleanup from legacy naming
- API workspace context: Transitional, centralized in the router but some tests and services still accept direct trusted context
- Postgres migrations: Transitional until validated against a real non-production PostgreSQL database
- RLS helper functions: Production Ready for the current schema, with narrow `SECURITY DEFINER` functions and explicit `search_path`
- Postgres compatibility adapter: Transitional
- SQLite persistence: Development Only, retained for local/demo/tests
- Direct repository SQL: Not Yet Implemented for most financial entities
- Supabase Auth prototype code: Not part of the Phase 2.5B target architecture and should not be expanded before a separate authentication decision

## Real Postgres Validation

No production data should be used. The validation script refuses to run unless a non-production database is explicitly confirmed.

PowerShell:

```powershell
$env:DATABASE_URL = "postgres://..."
$env:RAF_CONFIRM_NON_PRODUCTION_DB = "true"
$env:RAF_VALIDATE_APPLY_MIGRATIONS = "true"
node scripts/validatePostgresPhase25.js
```

Run database-level RLS integration tests:

```powershell
$env:DATABASE_URL = "postgres://..."
$env:RAF_CONFIRM_NON_PRODUCTION_DB = "true"
$env:RAF_RUN_POSTGRES_RLS_TESTS = "true"
node --test tests/postgresRlsIsolation.integration.test.js
```

The tests create Workspace A and Workspace B data inside a transaction and roll it back. They verify that Workspace A cannot read, insert, update, delete, join into, or discover Workspace B financial rows by guessed UUID.

If credentials are absent, do not mark live validation complete. Keep the scripts and skipped integration test as the exact commands to run.

## RLS Helper Safety

`raf.current_app_user_id`, `raf.current_workspace_id`, `raf.has_workspace_membership`, and `raf.has_workspace_role` are `SECURITY DEFINER` functions because tenant table policies need to inspect transaction-local RAF context and `raf.workspace_members` without recursive policy evaluation.

Rules:

- read provider-neutral transaction-local context from `current_setting('raf.user_id', true)` and `current_setting('raf.workspace_id', true)`
- set `search_path = raf, pg_catalog`
- keep functions read-only and narrow
- revoke default public execute
- grant execute to the provider-neutral application role; the portable migration uses `PUBLIC` because PostgreSQL has no universal app-role name
- do not expose membership row details through helper return values

Regression coverage: `tests/postgresMigrationSchema.test.js`.

## Postgres Compatibility Adapter

`lib/server/postgresDb.js` is a compatibility bridge. It hydrates `raf.*.raw_json` into the existing in-memory adapter, runs domain logic, then flushes diffs inside one Postgres transaction.

This preserves financial semantics, but it is not the final persistence architecture.

Current hardening:

- compatibility-adapter transactions take a Postgres advisory transaction lock
- writes run inside a database transaction
- migration reconciliation compares source and target financial snapshots

Remaining risks:

- full-state hydration cost increases with workspace size
- the coarse advisory lock reduces concurrency across the adapter
- diff flushing can amplify writes beyond the changed entity
- conflict responses are not yet precise
- multiple API instances rely on the same database lock for serialized adapter writes

Direct SQL repositories should replace the adapter first for workspace memberships, transactions, financial accounts, imports, and allocation configuration.

## Monetary Precision Policy

Database:

- money: `NUMERIC(12,2)`
- allocation and surplus percentages: `NUMERIC(6,4)`
- API money responses: decimal strings such as `"1250.00"`
- API percentage responses: string fractions such as `"0.1000"`

Domain:

- deterministic RAF calculations remain in `lib/raf/`
- do not use Postgres `float`, `real`, `double precision`, or `money` types for financial truth
- do not prematurely round intermediate allocation/debt/projection calculations unless the existing RAF engine already does so
- rounding remainders continue to follow RAF rules: allocation remainder to `buffer`, surplus remainder to `emergency_fund`

Frontend:

- treat server money and percentage values as financial strings
- formatting for display must not become source-of-truth arithmetic

Regression coverage: `tests/postgresMigrationSchema.test.js`, allocation/debt/report tests, and migration reconciliation tests.

## Migration Reconciliation

Use `verifyMigrationReconciliation` from `lib/server/migrationVerification.js` to compare SQLite source adapters with the Postgres target adapter.

The reconciliation report includes:

- transactions and transaction sums
- financial accounts and reconciliations
- income and income allocations
- allocation categories and surplus rules
- debts and derived debt summaries
- goals and goal progress
- fixed bills
- monthly reviews
- merchant/import rules
- imports
- dashboard and financial-health report values

Expected financial differences are zero. Rounding differences are bugs unless a separate migration note explains the intentional numeric decision.

## Environment Safety

Production fails closed:

- `RAF_PERSISTENCE_DRIVER=postgres` requires `DATABASE_URL`
- `SUPABASE_DATABASE_URL` is a deprecated compatibility fallback and should not be used for new environments
- local JWT auth is blocked in production
- SQLite persistence is blocked in production unless `RAF_ALLOW_PRODUCTION_SQLITE=true` is set deliberately

Regression coverage: `tests/serverEnvValidation.test.js`.

## Dependency Audit

`npm audit fix --package-lock-only` was run without `--force`. A targeted npm override pins `qs` to patched 6.x versions because the vulnerable copies were pulled through Express/body-parser dependency ranges.

Remaining audit findings require breaking upgrades:

- `vite` / `esbuild`: high/moderate development-server issues; npm recommends `vite@8.x`
- `react-router-dom` / `react-router`: moderate runtime router issues; npm recommends `react-router-dom@7.x`

Production-only audit status:

- 2 moderate findings remain in `react-router` / `react-router-dom`
- no high or critical production-only findings remain after the safe `qs` override

Do not use `npm audit fix --force` inside Phase 2.5. Schedule those framework upgrades as a separate compatibility pass with frontend route regression testing.

## Validation Status

Local validation completed:

- Phase 2.5 focused tests: pass locally, with the live Postgres RLS test skipped until credentials are supplied
- Production build: pass
- `npm audit`: reduced from 18 findings to 4 findings after safe non-forced fixes

Local validation not complete:

- Full `node --test` still has pre-existing failures outside the Phase 2.5 focused gate, primarily allocation category contract drift and monthly review deletion expectations. These must be resolved before release qualification, but they were not introduced or redesigned in this phase.

Live validation not complete:

- No `DATABASE_URL` was available in the local environment. Run the non-production Postgres validation commands above before treating Phase 2.5 as production-auth ready.

## Provider Portability Report

RAF's Phase 2.5B persistence target is provider-neutral PostgreSQL.

Removed from active Postgres persistence/RLS assumptions:

- Supabase `auth.uid()`
- Supabase `auth.jwt()`
- `request.jwt.*` database settings
- Supabase role names as required RLS app roles
- direct browser-to-database access

Retained and documented:

- `SUPABASE_DATABASE_URL` remains a deprecated compatibility fallback only; new environments must use `DATABASE_URL`
- Supabase Auth prototype code exists from prior work, but it is not part of the Phase 2.5B persistence architecture and should not be expanded automatically
- PostgreSQL RLS remains as defense in depth, using provider-neutral transaction-local settings set by the trusted RAF API

Normal PostgreSQL features used:

- schemas
- enums
- foreign keys
- check constraints
- unique constraints
- indexes
- `NUMERIC`
- Row Level Security
- `current_setting` / `set_config`
- transaction-level advisory locks

Provider-specific features not required:

- Supabase JS client for persistence
- Supabase Auth for RLS
- Supabase service-role credentials
- Supabase Storage
- Supabase HTTP APIs

## Known Risks

P0:

- None known in the checked-in code after Phase 2.5 hardening.

P1:

- Live PostgreSQL validation is incomplete until non-production credentials are supplied and the validation scripts pass.
- The Postgres compatibility adapter is serialized and safe from silent concurrent overwrites, but it is too coarse for production scale.

P2:

- Many service parameters still use `householdId` as tenant context. This is acceptable for compatibility but should keep moving toward `workspaceId` in auth and infrastructure code.
- Full `node --test` may include pre-existing product-behavior failures unrelated to Phase 2.5; do not use focused hardening tests as a substitute for release qualification.

P3:

- Direct repository SQL and precise optimistic-lock conflict responses are not yet implemented for most entities.
- Account/reconciliation UI is still incomplete relative to the new account persistence model.
