# Branch E — Security Architecture Audit

**Phase 0 | Audit date: 2026-09-08**
**Status: READ-ONLY — implementation begins in Phase 1**

---

## 1. Request Lifecycle Trace

```
HTTP request (Express)
        │
        ▼
routerLoader.js — resolveTrustedContext()
        │
        ├─ [public routes: /auth/signup, /auth/login, /invitations/:token GET/decline]
        │       └─ returns { db, householdId: null, workspaceId: null }
        │
        ├─ [RAF_AUTH_REQUIRED=false — dev mode]
        │       └─ returns { db, householdId: header_value ?? defaultHouseholdId, ... }
        │              ← NO membership verification; any workspace ID accepted ⚠
        │
        ├─ [auth-only routes: /auth/logout, /workspaces GET, etc.]
        │       ├─ verifyToken(bearerToken, { db })         → claims.userId ✓
        │       └─ returns { db, userId, ... }
        │              ← workspaceId = null; householdId = null
        │
        └─ [workspace-scoped routes: everything else]
                ├─ verifyToken(bearerToken, { db })         → claims.userId ✓
                ├─ db.transaction(tx => getWorkspace + getWorkspaceMember)
                │         ← THIS TRANSACTION HAS NO SECURITY CONTEXT ⚠
                ├─ buildWorkspaceContext({ workspace, membership, userId })
                │         → null if no membership or status != 'active'
                ├─ roleHasPermission(role, requiredPermission)   ✓
                └─ returns { db, userId, workspaceId, householdId, role, ... }
                          ← trusted JS context built; never passed to db.transaction ⚠
                          │
                          ▼
              route handler(webRequest, trustedContext)
                          │
                          ▼
              db.transaction(callback)   ← no securityContext arg
                          │
                          ▼
              BEGIN
              [set_config skipped — securityContext = {} by default]  ⚠
                          │
                          ▼
              buildDirectTransaction(client) → repository methods
              or getLegacyTx() → compat path
                          │
                          ▼
              COMMIT / ROLLBACK
              client.release()
```

---

## 2. Answers to Phase 0 Questions

### Q1: Where is authenticated `userId` established?

`lib/server/routerLoader.js` → `resolveTrustedContext()` → `verifyToken(token, { db })` → returns `claims.userId`.

`verifyToken` performs:
1. HMAC-SHA256 signature verification (timing-safe comparison)
2. Expiry check (`claims.exp < now`)
3. Blacklist check: `isTokenBlacklisted({ jti })` via `db.transaction((tx) => tx.isTokenBlacklisted(...))`

`JWT_SECRET` is required when `NODE_ENV === 'production'` or `RAF_AUTH_REQUIRED === 'true'`. In dev without `JWT_SECRET`, a random per-process secret is generated — tokens do not survive server restarts.

**Established at:** `lib/auth/jwt.js:verifyToken`, result consumed in `routerLoader.js:160-167`.

---

### Q2: Where is trusted `workspaceId` established?

`resolveTrustedContext()` reads the workspace header (`x-workspace-id` / `x-household-id` / `x-household_id`) as a **selector only**. The trusted value is established via:

```js
db.transaction(async (tx) => {
  const workspace = await tx.getWorkspace({ workspaceId: headerValue });
  const membership = await tx.getWorkspaceMember({ workspaceId: headerValue, userId: claims.userId });
  return buildWorkspaceContext({ workspace, membership, userId: claims.userId });
})
```

`buildWorkspaceContext` returns `null` unless `membership.status === 'active'`. When null, the request is rejected 403.

**Established at:** `routerLoader.js:181-185` — from the database membership row, not from the header directly.

---

### Q3: Where is membership verified?

`buildWorkspaceContext({ workspace, membership, userId })` → returns null when `!workspace || !membership || membership.status !== 'active'`.

Live membership is fetched per-request via `tx.getWorkspaceMember({ workspaceId, userId })` (direct SQL, `raf.workspace_members`). The result reflects the current database state — not a cached or JWT-embedded role.

**Verified at:** `lib/workspaces/permissions.js:buildWorkspaceContext` using a fresh DB query per request.

---

### Q4: Where is permission verified?

`routerLoader.js:requiredPermissionForRoute(routePath, method)` maps routes to permission strings:

| Route prefix | GET | Other |
|---|---|---|
| `/workspaces` | `workspace:read` | `members:manage` |
| `/reports` | `reports:read` | `reports:read` |
| `/remi` | `remi:invoke` | `remi:invoke` |
| `/imports`, `/import-rules`, `/merchant-rules` | `imports:read` | `imports:write` |
| `/exports` | `financial:read` | `financial:read` |
| Everything else | `financial:read` | `financial:write` |

Then: `roleHasPermission(workspaceContext.role, requiredPermission)` → static lookup against `PERMISSIONS_BY_ROLE`.

**Verified at:** `routerLoader.js:193-198`. Role is from the database membership row.

---

### Q5: Where is `securityContext` constructed?

The trusted context object `{ userId, workspaceId, householdId, role, permissions, workspace }` is constructed in `resolveTrustedContext()` and spread into the trustedContext passed to each route handler.

**There is no explicit `securityContext` struct.** The values exist as a plain JS object property bag returned from `resolveTrustedContext`.

---

### Q6: Where is it lost or not propagated?

**The securityContext is lost at every `db.transaction()` call site.**

`createPostgresDb().transaction(callback, securityContext = {})` accepts a second argument for PostgreSQL session variables, but:

- Zero production call sites pass a second argument.
- Every `db.transaction(callback)` call in route handlers, domain libs, and auth code omits the securityContext.
- The values `userId` and `workspaceId` live in the JS trustedContext object but are never forwarded to the Postgres transaction.

**Every single PostgreSQL transaction executes with `securityContext = {}`, meaning:**
```sql
-- Never executed in production:
SELECT set_config('raf.user_id', $1, true);
SELECT set_config('raf.workspace_id', $2, true);
```

**Lost at:** every `db.transaction(callback)` call — approximately 60+ call sites across route handlers and domain libraries.

---

### Q7: Where are PostgreSQL transaction-local settings initialized?

**They are defined** in `postgresDb.js:1088-1099`:
```js
async transaction(callback, securityContext = {}) {
  const client = await pool.connect();
  await client.query('begin');
  if (securityContext.userId) {
    await client.query("select set_config('raf.user_id', $1, true)", [securityContext.userId]);
  }
  if (securityContext.workspaceId ?? securityContext.householdId) {
    await client.query("select set_config('raf.workspace_id', $1, true)", [securityContext.workspaceId ?? securityContext.householdId]);
  }
  // ...
}
```

**They are never initialized in practice** because `securityContext` is always the default `{}`.

The `true` flag (transaction-local) is correct: it would prevent context leak across pooled connections. The design is sound; the gap is purely the missing call-site propagation.

---

### Q8: Which production paths execute without them?

**All of them.** Every production PostgreSQL transaction runs without `raf.user_id` or `raf.workspace_id` being set. This includes:

- Income, debt, goal, fixed-bill, and allocation-category CRUD (direct SQL repos)
- Transactions (direct SQL)
- Financial accounts and reconciliations (direct SQL)
- Workspace membership operations (direct SQL)
- Monthly reviews, import pipeline, invitations (compat path)
- Auth operations: login, signup, token blacklist (direct SQL)

---

### Q9: Which tables currently rely only on SQL scoping / application-layer checks?

**All 28 tenant-owned `raf.*` tables.** The three-layer model is currently:

| Layer | Status |
|---|---|
| Application authorization (membership + permission check) | ✓ Active |
| Workspace-scoped SQL (`WHERE workspace_id = $N`) | ✓ Active in direct-SQL repos and compat path |
| PostgreSQL RLS (`set_config` + policy evaluation) | ✗ Inactive — securityContext never propagated |

**RLS is defined and structurally sound but not enforced for any production request.**

**Why queries still work:** The application connects with a role that is either a PostgreSQL superuser or has `BYPASSRLS`. Without RLS enforcement, the direct SQL `WHERE workspace_id = $N` clause provides the only tenant isolation guarantee at the database layer.

---

### Q10: Which operations intentionally do not have workspace context?

| Operation | Context | Reason |
|---|---|---|
| `POST /auth/signup` | None | Public route — user not yet authenticated |
| `POST /auth/login` | None | Public route — `getUserByEmail` needs no workspace |
| `POST /auth/forgot-password` | None | Public route |
| `GET /invitations/:token` | None | Public route — invitation lookup by token |
| `POST /invitations/:token/decline` | None | Public route |
| `POST /auth/logout` | userId only | Blacklist token — no workspace needed |
| `GET /workspaces` | userId only | List own workspaces — no specific workspace yet |
| `insertBlacklistedToken` | None | System-level write; no tenant scope |
| `isTokenBlacklisted` | None | System-level read; no tenant scope |
| `cleanupExpiredBlacklistedTokens` | None | Maintenance; no tenant scope |

---

## 3. RLS Helper Analysis

### `raf.has_workspace_membership` security gap

```sql
SELECT EXISTS (
  SELECT 1 FROM raf.workspace_members wm
  WHERE wm.workspace_id = target_workspace_id
    AND (raf.current_workspace_id() IS NULL OR target_workspace_id = raf.current_workspace_id())
    AND wm.user_id = raf.current_app_user_id()
    AND wm.status = 'active'
)
```

**Null workspace_id gap:** If `raf.workspace_id` is not set (NULL), the condition `(NULL IS NULL OR ...)` evaluates to `TRUE`, removing the workspace-lock. The check degrades to: "is the current user an active member of `target_workspace_id`?" — meaning a user's RLS policy permits access to **all their workspaces simultaneously**, not just the currently selected one.

**Combined null case:** When BOTH are NULL (current production state), `user_id = NULL` → always false → RLS blocks everything. This is actually safe (fail-closed) but only because the connecting role must be BYPASSRLS/superuser for any queries to succeed.

**Fix required:** Once securityContext propagation is implemented, BOTH `raf.user_id` AND `raf.workspace_id` must be set for tenant-scoped transactions. The `IS NULL` escape clause should be removed from `has_workspace_membership` — it was likely a development convenience that creates a defense-in-depth gap.

### `raf.app_users` policy gap

```sql
CREATE POLICY app_users_self_policy ON raf.app_users
USING (id = raf.current_app_user_id())
WITH CHECK (id = raf.current_app_user_id());
```

`app_users` has `ENABLE ROW LEVEL SECURITY` but NOT `FORCE ROW LEVEL SECURITY`. This means the table owner is NOT subject to this policy. Additionally, `getUserByEmail` (used during login) runs with no `raf.user_id` set — once we enforce RLS, this query would return no rows because the queried user's id ≠ the (unset) current user id.

**Fix required:** Auth operations (`getUserByEmail`, `createUser`) must execute under a mechanism that bypasses or excludes the user-identity policy. Options:
1. Do not set `raf.user_id` for auth transactions (already the case for login/signup — just must stay that way)
2. Add a separate database role for auth operations with a policy exception
3. Rely on BYPASSRLS for the application role (simplest, requires non-superuser application role with explicit BYPASSRLS)

---

## 4. Dev-Mode Bypass Analysis

When `RAF_AUTH_REQUIRED` ≠ `'true'` / `'1'`:
- `routeNeedsAuth()` → false → JWT not verified
- `routeNeedsWorkspace()` → false → no membership verification
- `householdId` / `workspaceId` = `selectedWorkspaceId(req) ?? defaultHouseholdId`
- **Any workspace ID in the header is trusted with no verification**

This means:
- User A (dev) can set `x-workspace-id: workspace-b-uuid` and get full access to Workspace B's data
- No application-layer isolation in dev mode at all
- This cannot be "accidentally" activated if `RAF_AUTH_REQUIRED` is always set in production deployments

**Current risk:** If a staging or CI deployment omits `RAF_AUTH_REQUIRED=true`, it silently runs with zero tenant isolation. There is no startup warning for this condition.

**Additionally:** `defaultHouseholdId` is passed from `index.js` only when `!authRequired`. In the SQLite adapter, `db.defaultHouseholdId` was the first household loaded from the database. In the Postgres adapter, `defaultHouseholdId: null` — so in dev Postgres mode with no header, the householdId is null.

---

## 5. Repository Transaction Safety

All five direct-SQL repositories (`allocationCategoriesRepository`, `incomeRepository`, `debtsRepository`, `goalsRepository`, `fixedBillsRepository`) and all inline methods in `postgresDb.js:buildDirectTransaction` receive a `client` parameter that is the checked-out, transaction-bearing pool client.

No repository uses `pool.query()` or opens an independent connection. All use `client.query()`.

**Classification: All direct-SQL operations are TRANSACTION_SAFE.**

The compat path (`getLegacyTx`) uses the same `client` for the advisory lock, `loadState`, and `flushTableDiff`. Also TRANSACTION_SAFE.

---

## 6. Token Blacklist Security Model

`raf.token_blacklist` (created in `20260905000000_add_token_blacklist.sql`):
- No `ENABLE ROW LEVEL SECURITY` — intentional
- Not tenant-owned — JTIs are per-user, not per-workspace
- Only `insertBlacklistedToken`, `isTokenBlacklisted`, `cleanupExpiredBlacklistedTokens` — all server-internal
- No route handler exposes direct token blacklist queries to clients
- No cross-tenant risk: JTI is a random UUID; a user cannot enumerate or predict another user's JTI

**Classification: Intentionally global (no RLS). Acceptable for server-only access.**

---

## 7. Connection Pool Context Leak

The `set_config(..., true)` uses PostgreSQL's transaction-local setting semantics. When a transaction commits or rolls back, these settings are cleared. The `client.release()` in the `finally` block returns the connection to the pool after the transaction ends.

**With current implementation (no context set), pool leakage cannot occur** because nothing is ever set.

**Once securityContext propagation is implemented:** The transaction-local flag (`true`) prevents leakage. A raw query run after `client.release()` and re-acquire would start fresh. The design is correct; no additional fix is needed here beyond ensuring the `true` flag remains.

---

## 8. Public Route Inventory

| Route | Method | Data exposed | Risk |
|---|---|---|---|
| `/auth/signup` | POST | None — creates user | Low |
| `/auth/login` | POST | JWT + workspace list for authenticated user | Low |
| `/auth/forgot-password` | POST | None (stub?) | Low |
| `/invitations/:token` | GET | Invitation metadata (workspace name, inviter) | Medium — see note |
| `/invitations/:token/decline` | POST | None | Low |

**Invitation route risk:** `GET /invitations/:token` is public and returns invitation metadata. If the invitation object exposes workspace financial data (account balances, member list), this is a data leak. The invitation token must be opaque and the response must contain only invitation-specific fields (workspace name, role, inviter name/email). Requires audit in Phase 16.

---

## 9. Branch E Gap Summary

| # | Gap | Severity | Phase |
|---|---|---|---|
| G1 | securityContext never propagated to `db.transaction()` | **P0** | Phase 1+2 |
| G2 | RLS effectively disabled — `raf.user_id`/`raf.workspace_id` never set | **P0** | Phase 2 |
| G3 | `has_workspace_membership` IS NULL escape allows all-workspace access when only user_id set | High | Phase 2 |
| G4 | `app_users_self_policy` incompatible with login/signup unless auth txns excluded from RLS context | High | Phase 2+5 |
| G5 | Dev-mode (`RAF_AUTH_REQUIRED` unset) disables all tenant isolation silently | High | Phase 6 |
| G6 | Connecting role is likely superuser/BYPASSRLS — RLS never evaluated in practice | High | Phase 4 |
| G7 | Workspace membership check transaction (lines 181-185) itself has no securityContext | Medium | Phase 2 |
| G8 | `token_blacklist` has no RLS — intentional but undocumented | Low | Phase 5 |
| G9 | Production startup does not fail-fast on missing `RAF_AUTH_REQUIRED` | Low | Phase 19 |

---

## 10. Implementation Plan Summary

| Phase | Action | Touches |
|---|---|---|
| 1 | Establish canonical SecurityContext struct | `routerLoader.js` |
| 2 | Propagate securityContext into `db.transaction` at router layer | `routerLoader.js`, `postgresDb.js` |
| 2 | Fix `has_workspace_membership` IS NULL escape (schema migration) | migration |
| 3 | Verify repositories are TRANSACTION_SAFE (already verified above) | none needed |
| 4 | Produce RLS table matrix with live DB verification | test |
| 5 | Document token_blacklist security model | docs |
| 6 | Harden dev-mode: warn or fail on missing auth in Postgres mode | `index.js` / env |
| 7-8 | Adversarial API + repository tests | tests |
| 9-11 | Direct RLS tests, missing-context, pool-leakage tests | tests |
| 12 | Cross-tenant FK matrix | schema/tests |
| 13 | Role escalation tests | tests |
| 14 | Membership lifecycle tests | tests |
| 15 | Auth boundary tests (no token, bad token, revoked, expired) | tests |
| 16 | Public route audit (invitation token response scope) | code + tests |
| 17 | Compat path security verification | tests |
| 18 | Consolidated security regression suite | tests |
| 19 | Production config fail-fast verification | `index.js` / env |
| 20 | Update `docs/tenant-security.md` | docs |
| 21 | Final adversarial report + closure declaration | docs |

---

## 11. Files Read for This Audit

- `lib/server/routerLoader.js` — full read
- `lib/server/postgresDb.js` — full read (transaction function, buildDirectTransaction, TABLES)
- `lib/server/db.js` — full read
- `lib/auth/jwt.js` — full read
- `lib/workspaces/permissions.js` — full read
- `lib/repositories/postgres/allocationCategoriesRepository.js` — partial (client.query pattern)
- `lib/repositories/postgres/incomeRepository.js` — partial
- `lib/repositories/postgres/debtsRepository.js` — partial
- `lib/repositories/postgres/goalsRepository.js` — partial
- `lib/repositories/postgres/fixedBillsRepository.js` — partial
- `db/migrations/20260903090000_workspace_postgres_persistence.sql` — RLS policies, helper functions
- `db/migrations/20260904000000_collaboration.sql` — RLS for invitations/activity
- `db/migrations/20260905000000_add_token_blacklist.sql` — token_blacklist (no RLS)
- `tests/postgresRlsIsolation.integration.test.js` — existing RLS test structure
- `docs/tenant-security.md` — existing security documentation
- `docs/architecture-closure-d.md` — Branch D closure
- `index.js` — server startup, defaultHouseholdId wiring
