# Architecture Closure — Branch D: Direct Postgres Repository

## Summary

Branch D introduced the first wave of direct SQL repository methods in `postgresDb.js`,
bypassing the compatibility adapter for the auth / user-lifecycle domain.

## Phase 0 — Audit

Audit document: `docs/postgres-repository-migration-audit.md`

Key findings:
- 28 tables hydrated by the compat path on every write via `loadState`
- Global advisory lock serialises all compat-path transactions
- `workspace_members` has `joined_at` not `created_at` — `loadState` ORDER BY was wrong
- `user_households` in TABLES referenced a non-existent raf schema table
- `buildDirectTransaction` already covered: token blacklist, workspace/membership reads,
  financial accounts, reconciliations, transactions, workspace activity

## Phase 1 — Auth Domain Direct SQL

Methods added to `buildDirectTransaction` in `lib/server/postgresDb.js`:

| Method | SQL target |
|--------|-----------|
| `createUser` | `raf.app_users` (email uniqueness check + insert) |
| `createWorkspace` | `raf.workspaces` + `raf.households` + 7 allocation categories + 3 surplus split rules |
| `createHousehold` | delegates to `createWorkspace` |
| `createUserHousehold` | delegates to `createWorkspaceMember` (already direct) |
| `listHouseholdsForUser` | delegates to `listWorkspacesForUser` (already direct) |

Signup now executes entirely in direct SQL — no compat-path advisory lock acquired,
no full-table hydration, no `loadState` called.

## Bugs fixed in this branch

1. **`loadState` ORDER BY** — `workspace_members` has `joined_at` not `created_at`.
   Fixed by adding `sortColumn` field to TABLES entries and using it in `loadState`.

2. **Dead `user_households` TABLES entry** — referenced `raf.user_households` which does
   not exist in the Postgres schema. `userHouseholds` stateKey is never read by any
   inMemoryDb method. Entry removed.

## Test results

```
POST /auth/signup    → 201  (user + workspace + household + seeded data in Postgres)
POST /auth/signup    → 409  (duplicate email correctly rejected)
POST /auth/login     → 200  (JWT issued)
GET  /transactions   → 200  (auth context resolves, householdId set correctly)
GET  /allocation-categories → 200, 7 items (seed data present)
POST /auth/logout    → 200  (token blacklisted)
GET  /transactions   → 401  (revoked token correctly rejected)
```

## Remaining compat-path methods (Branch D Phase 2+)

These still go through `getLegacyTx` → advisory lock → `loadState`:
workspace invitations, fixed bills, goals, merchant rules, debts, allocation categories
(write), income, monthly reviews, workspace activity list.

Suggested pilot order (lowest risk first):
1. `workspace_activity` list (insert already direct)
2. `workspace_invitations`
3. `fixed_bills` / `goals` / `debts`
4. `allocation_categories` (write)
5. Income entries + allocations
6. Monthly reviews

Advisory lock removal: after ALL methods have direct SQL implementations.

---

ARCHITECTURE CLOSURE D: READY
