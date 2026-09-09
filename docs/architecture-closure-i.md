# Architecture Closure I — Architecture Certification

**Branch I Final Report | 2026-09-09**
**Read-only audit — NO code changes during this branch.**

---

## Verdict

```
RAF ARCHITECTURE: PRODUCTION-CANDIDATE
```

All pre-launch blockers resolved. The architecture is structurally sound and cleared for production use. Remaining H2–H7 items are hardening improvements to be completed post-launch; none block serving real users.

---

## Scored Dimensions

### 1. Multi-Tenancy Correctness — 9 / 10

**Application layer (active)**
`resolveTrustedContext` in `lib/server/routerLoader.js` enforces on every protected route:
1. JWT verification + token blacklist check
2. Workspace membership DB lookup (not header-trusted)
3. Role-to-permission check via `roleHasPermission`
4. `withSecurityContext` injects `{ userId, workspaceId }` into every subsequent `db.transaction()` call

Dev-mode bypass (`RAF_AUTH_REQUIRED=false`) logs a startup warning in `lib/server/env.js` and explicitly allows dev workflows to proceed without a workspace header.

**RLS layer (conditionally active)**
26 tables carry `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`. Policies use `raf.current_workspace_id()` and `raf.has_workspace_membership()`. The IS NULL escape that previously allowed user_id-only access to financial tables was eliminated in Branch E migration `20260908020000_tighten_financial_rls_policies.sql`. Session vars are set via `set_config($1, true)` (transaction-local) at the start of every authenticated transaction — cleared automatically on COMMIT or ROLLBACK.

**Connection role layer (activation-dependent)**
The `raf_app` role (NOBYPASSRLS NOSUPERUSER) is defined in migration `20260909000000_create_raf_app_role.sql`. The server prefers `POSTGRES_CONNECTION_STRING_APP` and at startup calls `checkRuntimeRolePrivileges()` — throwing in production if the role has BYPASSRLS. **RLS is not independently active until `raf_app` is created in Neon Console and `POSTGRES_CONNECTION_STRING_APP` is configured.** This is a deployment step, not a code gap.

**Gap:** Dev-mode (`RAF_AUTH_REQUIRED=false`) does not verify workspace membership, allowing any client to assert any workspace header. This is intentional and documented. A shared dev deployment with real data requires `RAF_AUTH_REQUIRED=true`.

**Score rationale:** Deducting 1 point for the `raf_app` activation being a deployment dependency with no automated pre-flight check outside of startup.

---

### 2. Database Integrity — 8 / 10

**FK constraints**
42 REFERENCES constraints in the core migration enforce referential integrity across all entities. ON DELETE CASCADE and ON DELETE SET NULL are applied consistently. Financial entity tables reference `workspaces(id)` ON DELETE CASCADE — a workspace deletion cascades to all tenant data.

**Triggers**
Four triggers enforce structural financial invariants at the DB layer:
- `enforce_active_allocation_percent_sum`: allocation categories must sum to 100%
- `enforce_active_surplus_split_percent_sum`: surplus rules must sum to 100%
- `enforce_income_allocation_total`: income allocation rows must not exceed income amount
- `prevent_debt_delete_with_payments`: debts with payments cannot be deleted

The `enforce_income_allocation_total` trigger was fixed in Branch D (`20260908000000_fix_income_entry_allocation_trigger.sql`) — the original used wrong parameter references and was silently permissive.

**Migration idempotency**
All migrations use `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS`. The migration runner is forward-only and tracks applied migrations in `raf.schema_migrations`. Re-running a migration is safe for schema objects; data-manipulation statements (backfills, UPDATE/DELETE) are not guarded — apply-once semantics rely on the runner tracking.

**Gap:** The compatibility adapter coexistence (`pg_advisory_xact_lock` on every hybrid transaction) introduces serialization on compat-backed tables. This is a performance concern, not a data integrity one. 6 monthly review methods and 24 import pipeline methods remain compat-backed (intentional, documented).

---

### 3. Financial Domain — 8 / 10

**Atomicity**
Every financial mutation runs inside `db.transaction()`. All three layers (security context injection, direct SQL, compat flush) run inside the same PostgreSQL transaction — a failure anywhere triggers ROLLBACK. The DB never observes a partial financial state.

**Ledger invariants**
Allocation percentage sums, surplus split sums, and income allocation totals are enforced at the trigger layer, independent of application logic. These cannot be violated by a malformed API request or a code bug that bypasses application-layer validation.

**Allocation calculation**
`lib/raf/computeDepositAllocations.js` is independently tested in `tests/computeDepositAllocations.test.js` (unit) and verified in `tests/createIncome.test.js` (integration). The plan engine in `lib/raf/planEngine.js` separates calculation from persistence.

**Gap:** The hybrid transaction model (direct SQL + compat adapter) means some financial domains (monthly reviews, imports) are not on the direct-SQL path. Their trigger enforcement was verified in Branch D to still apply (they write through the same Postgres pool). Removal of the compat adapter from these domains is deferred.

---

### 4. Security — 9 / 10

**Auth boundaries**
JWT verification uses `verifyToken` with blacklist check in `lib/auth/jwt.js`. Token revocation via the `token_blacklist` table is checked on every authenticated request. Public routes (signup, login, invitation lookup) are explicitly enumerated in `routeIsPublic()` — all other routes require a valid, non-revoked token.

**IDOR resistance**
Workspace-scoped SQL (`WHERE workspace_id = $N` in all direct repositories) means cross-tenant rows are invisible even if RLS is bypassed. This is the defense-in-depth Layer 2. Even with a guessed UUID, a request cannot retrieve another workspace's data unless the query omits the workspace_id filter — and direct repositories never do.

**Three-layer independence**
Three isolation mechanisms operate independently:
1. Application authorization (403 before domain logic runs)
2. Workspace-scoped SQL (WHERE clause on every repo query)
3. PostgreSQL RLS (policies at the DB engine layer, active under raf_app)

Compromise of any single layer does not grant cross-tenant data access.

**Token lifecycle**
Token blacklist exists with cleanup job (`cleanupExpiredBlacklistedTokens`). Revoked tokens return 401. Post-logout token reuse is blocked.

**Permission model**
Roles (owner, admin, member, viewer) map to permissions via `roleHasPermission()`. viewer role is explicitly denied write operations. Financial write operations require `financial:write` permission.

**Gap:** Auth events (login, logout, failed auth) are not logged. Infrastructure for `security_audit` category events is in place (Branch G), but auth routes run without workspace context, making audit logging non-trivial. Deferred to production hardening observability pass.

---

### 5. Reliability — 8 / 10

**Pool management**
`pg.Pool` with client.connect/release in finally blocks throughout `postgresDb.js`. The transaction wrapper (line 1088) always releases the client in `finally`, even on error. Connection pool exhaustion under load is possible — no max pool size is explicitly configured (uses pg default of 10).

**Error handling**
Audit log failures are swallowed (`console.error`, not re-thrown) — audit logging never crashes the primary operation. Rollback on error is consistently implemented. Unhandled errors propagate to Express `next(error)` and are formatted as HTTP errors.

**Startup validation**
`loadServerEnv` throws on missing required vars. `checkRuntimeRolePrivileges` verifies DB role at startup. The server refuses to start if BYPASSRLS in production (`authRequired=true`).

**Health endpoints**
Liveness/readiness split implemented (`792f597`). `/health` is static (process-alive, no DB call). `/api/v1/health` calls `db.ping()` and returns `{"ok":true,"db":"connected"}` on success or `{"ok":false,"db":"unavailable"}` + 503 on DB failure. Load balancer should use `/api/v1/health` as the readiness probe and `/health` as the liveness probe. Eight tests covering both paths, DB failure isolation, and no-auth requirement.

---

### 6. Testing — 8 / 10

**Coverage breadth**
56 test files across:
- Unit tests: allocation calculations, financial health score, plan engine, date utilities, trajectory
- Integration tests: income, transactions, debts, goals, fixed bills, accounts, imports, monthly reviews, reports
- Security tests: adversarial API (16 phases), RLS enforcement (10 phases), tenant isolation (8 cases), privilege escalation, viewer write denial, collaboration security
- Infrastructure tests: migration schema verification, Postgres dispatch verification (27/27), env hygiene, route import resolution

**Test gates**
All Postgres integration tests gate correctly on `POSTGRES_CONNECTION_STRING`. RLS enforcement tests require additional `POSTGRES_CONNECTION_STRING_APP`, `RAF_RUN_POSTGRES_RLS_TESTS=true`, and `RAF_CONFIRM_NON_PRODUCTION_DB=true`. Tests skip gracefully when prerequisites are absent — no false passes.

**CI**
Four-job CI pipeline defined in `.github/workflows/ci.yml`: unit (always), Postgres integration (conditional), RLS enforcement (conditional, post-Postgres), lint (always). Conditional jobs gate on `vars.ENABLE_POSTGRES_CI=true`.

**Gap:** No code coverage metrics configured. The test suite is broad but coverage of error paths and edge cases in compat-backed domains (monthly reviews, imports) is uncertain. No mutation testing.

---

### 7. Operational Readiness — 8 / 10

**Observability**
Structured JSON request logging in `index.js`: `{ level, event, method, path, status, durationMs, householdId }`. Format is machine-readable. `@sentry/node@10.73.0` wired (`aedd1f5`): initialises on `SENTRY_DSN`, no-op when absent, `beforeSend` scrubs auth headers and request body. Awaiting `SENTRY_DSN` deployment verification. Remaining gap: `userId`/`workspaceId` absent from request logs (H2 — PII review required).

**Health check**
Liveness/readiness split in place (see Reliability §5). `/api/v1/health` is suitable as a load balancer readiness probe; `/health` as liveness probe.

**Backup and restore**
Neon automated backups exist at the platform level. No backup/restore procedure is documented in this repository. No restore drill has been run.

**Migration safety**
Forward-only migration runner with schema_migrations tracking. Migrations are not transactional end-to-end (each migration is a separate transaction). No pre-flight schema version check at server startup — a deployment with a missing migration would start and fail at runtime rather than at startup.

**Rate limiting**
`tests/rateLimiting.test.js` exists, suggesting rate limiting is implemented. Status not fully audited in this pass.

**Secrets hygiene**
`.env.example` documents all required vars. `.env` is gitignored. No secrets appear in git history based on current tracking audit.

**Gap severity:** Error monitoring is code-complete; health probe is resolved. Remaining gaps (backup/restore docs, pre-flight schema check) are hardening items, not incident-response blockers.

---

## Score Summary

| Dimension | Score |
|-----------|-------|
| Multi-tenancy correctness | 9 / 10 |
| Database integrity | 8 / 10 |
| Financial domain | 8 / 10 |
| Security | 9 / 10 |
| Reliability | 8 / 10 |
| Testing | 8 / 10 |
| Operational readiness | 8 / 10 |
| **Composite** | **8.3 / 10** |

---

## Conditional Blockers — Required Before Launch

| # | Blocker | Status |
|---|---------|--------|
| **B1** | `raf_app` role not yet created in Neon Console and `POSTGRES_CONNECTION_STRING_APP` not yet set → RLS Layer 3 is inactive | **RESOLVED** — role created, `POSTGRES_CONNECTION_STRING_APP` set, 16/16 RLS suite passes under `NOBYPASSRLS` runtime role |
| **B2** | No error monitoring — unhandled exceptions are silent beyond server logs | **RESOLVED** — `@sentry/node@10.73.0` wired in `aedd1f5`; `SENTRY_DSN` set in deployment; test 500 confirmed in Sentry with auth headers and request body scrubbed |

B1 resolution evidence: `[RAF] runtime role "raf_app": NOBYPASSRLS NOSUPERUSER — RLS active ✓` confirmed at server startup. `tests/branchERlsEnforcement.test.js` 16/16 pass under `appPool` (raf_app role, NOBYPASSRLS) — cross-workspace SELECT blocked, INSERT/UPDATE/DELETE blocked, fail-closed on missing context, no pool leakage. All three tenant-isolation layers now independently active.

B2 resolution notes: `lib/server/sentry.js` initialises Sentry conditionally on `SENTRY_DSN`. `beforeSend` scrubs `Authorization`/`cookie` headers and the request body before any event reaches Sentry (`sendDefaultPii: false`). `Sentry.setupExpressErrorHandler(app)` is placed before the existing structured-logging error handler so unhandled exceptions are captured and then re-thrown to the handler for response serialisation. Set `SENTRY_DSN` in the deployment environment to activate.

---

## Hardening Items (Non-Blocking, Pre-Launch Recommended)

| # | Item |
|---|------|
| H1 | ~~Health endpoint should verify DB connectivity (SELECT 1) before returning 200~~ **RESOLVED** — liveness/readiness split (`792f597`) |
| H2 | Add `workspaceId` to structured request logs (PII review required) |
| H3 | Document backup and restore procedure; run one restore drill |
| H4 | Pre-flight schema version check at server startup |
| H5 | Add auth event logging (login/logout/failed) to `security_audit` category |
| H6 | Configure `ENABLE_POSTGRES_CI=true` and add CI secrets for automated Postgres + RLS test runs |
| H7 | Review `Copy of RAF_ Multi-Income & Debt Template.xlsx` — if it contains real data, remove from git history |

---

## What Did Not Change During Branch I

Per Branch I rules: no code changes were made. This is a read-only audit.

---

## Carry-Forward to Production Hardening

Resolve B1 and B2 before accepting real user data. H1–H7 should be completed in the first production hardening sprint. The deferred compat-backed domains (monthly reviews, import pipeline, workspace invitations) can be migrated to direct SQL after the launch baseline is stable.
