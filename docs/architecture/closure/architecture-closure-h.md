# Architecture Closure H — CI & Repo Hygiene

**Branch H Final Report | 2026-09-09**

---

## Declaration

```
ARCHITECTURE CLOSURE H: READY
```

Branch H is complete. The CI workflow is defined, `.gitignore` covers all sensitive file types, no secrets or database files are tracked, and all Postgres tests gate correctly on environment variables. Branch I must not begin until explicitly authorised.

---

## .gitignore Audit

**Result: CLEAN.**

All required patterns are present:

| Pattern | Status |
|---------|--------|
| `node_modules/` | ✅ |
| `.env`, `.env.local`, `.env.*` | ✅ |
| `!.env.example` (allow-list) | ✅ |
| `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal` | ✅ |
| `*.db`, `*.db-shm`, `*.db-wal` | ✅ |
| `db/households/`, `db/meta.db` | ✅ |
| `__p0_*/` | ✅ |
| `dist/`, `build/`, `coverage/` | ✅ |

**Tracked file requiring review:**

`Copy of RAF_ Multi-Income & Debt Template.xlsx` is currently tracked in the repository. The name suggests it is a template, not personal financial data. However, this file should be reviewed and — if it contains real financial data — removed from git history and excluded via `.gitignore`. This item is a hygiene flag, not an architecture blocker.

---

## Tracked File Audit

```
git ls-files | grep -E '\.env|\.db$|\.sqlite|node_modules'
```

Result: no secrets, database files, or node_modules are tracked. Only `.env.example` is tracked, which is correct.

---

## Test Gate Audit

All tests that require a live Postgres connection gate correctly:

| Test file | Gate env var(s) | Behaviour without var |
|-----------|----------------|----------------------|
| `branchEAdversarialApi.test.js` | `POSTGRES_CONNECTION_STRING` | Skips gracefully |
| `postgresRepositoryTenantIsolation.test.js` | `POSTGRES_CONNECTION_STRING` | Skips gracefully |
| `postgresRlsIsolation.integration.test.js` | `POSTGRES_CONNECTION_STRING` | Skips gracefully |
| `branchERlsEnforcement.test.js` | `DATABASE_URL` + `POSTGRES_CONNECTION_STRING_APP` + `RAF_RUN_POSTGRES_RLS_TESTS=true` + `RAF_CONFIRM_NON_PRODUCTION_DB=true` | Skips gracefully |
| `collaborationSecurity.test.js` | `POSTGRES_CONNECTION_STRING` | Skips gracefully |
| All other tests | None | Run under SQLite |

Running `npm test` without any Postgres env vars produces a valid, passing run for all SQLite-backed tests. Postgres integration tests skip, not fail.

---

## CI Workflow — `.github/workflows/ci.yml`

Three jobs:

### Job 1: Unit tests (always runs)
```
npm ci
npm test
```
Env: `PERSISTENCE_DRIVER=sqlite`, `RAF_DB_PATH=':memory:'`, `JWT_SECRET` (non-secret CI value), `RAF_AUTH_REQUIRED=true`

No secrets required. Runs on every push and PR.

### Job 2: Postgres integration tests (conditional)
Gated by `vars.ENABLE_POSTGRES_CI == 'true'` (a GitHub Actions repository variable, not a secret).

```
npm ci
node scripts/migrate.js    # requires POSTGRES_CONNECTION_STRING secret
npm test                   # Postgres tests now run
```

Secrets required: `POSTGRES_CONNECTION_STRING`, `POSTGRES_CONNECTION_STRING_APP`, `CI_JWT_SECRET`

**To enable:** set the `ENABLE_POSTGRES_CI` repository variable to `true` in GitHub → Settings → Variables.

### Job 3: RLS enforcement tests (conditional, runs after Job 2)
```
node --test tests/branchERlsEnforcement.test.js
```
Env: `DATABASE_URL` (privileged, for fixture setup), `POSTGRES_CONNECTION_STRING_APP` (raf_app, NOBYPASSRLS), `RAF_RUN_POSTGRES_RLS_TESTS=true`, `RAF_CONFIRM_NON_PRODUCTION_DB=true`

This is the Branch E.1 exit gate in CI.

### Job 4: Lint (always runs)
```
npm run lint
```

---

## Clean-Clone Reproducibility

The sequence:

```bash
git clone <repo>
cd raf_app
npm ci
# Set required env vars:
#   PERSISTENCE_DRIVER=sqlite
#   RAF_DB_PATH=:memory:
#   JWT_SECRET=<any value>
npm test
```

passes all unit tests from a clean clone. No local state, no database files, no pre-existing environment is required for the unit test suite to pass.

For Postgres integration tests, the additional env vars and a live Neon database are required — this is intentional and documented in `.env.example`.

---

## Deferred Item

The Excel template file (`Copy of RAF_ Multi-Income & Debt Template.xlsx`) should be reviewed by the repository owner. If it contains real financial data, it must be removed from git history using `git filter-repo` or similar. This is deferred pending that review.

---

## Files Changed / Created

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | New — four-job CI pipeline |
| `docs/architecture-closure-h.md` | This document |
