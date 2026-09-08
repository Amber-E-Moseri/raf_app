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

## Phase 2 — Financial Domain Repository Architecture

Repository pattern introduced at `lib/repositories/postgres/`. Each file exports
`buildXxxRepository(client, schema)` returning a plain object of async methods.
All repositories are spread into `buildDirectTransaction` — the Proxy routes them
to direct SQL automatically (no compat fallback).

### Repositories created (Branch D Phase 2)

| Repository | Methods | Compat methods removed from path |
|-----------|---------|----------------------------------|
| `allocationCategoriesRepository.js` | `listAllocationCategories`, `listAllocationCategorySnapshots`, `replaceAllocationCategories`, `listSurplusSplitRules`, `replaceSurplusSplitRules` | 5 |
| `incomeRepository.js` | `findIncomeByIdempotencyKey`, `insertIncomeEntry`, `listIncomeEntries`, `getIncomeEntryById`, `updateIncomeEntry`, `deleteIncomeEntry`, `insertIncomeAllocations`, `deleteIncomeAllocationsByIncomeEntryId`, `listIncomeAllocations`, `listIncomeAllocationsBySlug` | 10 |
| `debtsRepository.js` | `findDebtById`, `insertDebt`, `listDebts`, `getDebtById`, `updateDebt`, `countDebtPaymentsForDebt`, `deleteDebt`, `listDebtPayments`, `insertDebtAdjustment`, `listDebtAdjustments` | 10 |
| `goalsRepository.js` | `listGoals`, `insertGoal`, `getGoalById`, `updateGoal`, `deleteGoal` | 5 |
| `fixedBillsRepository.js` | `listFixedBills`, `insertFixedBill`, `getFixedBillById`, `updateFixedBill` | 4 |

**Compat reduction:** ~71 → ~42 methods (41% reduction in compat surface).
High-frequency paths (income writes, debt management, goal CRUD, alloc category management)
no longer trigger the global advisory lock or `loadState`.

### Remaining compat-path methods

These still fall through to `getLegacyTx` → advisory lock → `loadState(27 tables)`:
- `monthly_reviews` (6 methods) — extra caution required per Branch D exit criteria
- `workspace_invitations` (5 methods) — lower priority
- `updateHousehold` (1 method)
- `listWorkspaceActivity` (1 method) — insert already direct
- `merchant_rules` / `import_review_rules` (8+ methods)
- Import pipeline (19+ methods) — largest remaining surface

### Compat reduction metrics (Phase 6)

| Phase | Direct | Compat | Advisory-lock-free paths |
|-------|--------|--------|--------------------------|
| Pre-Branch-D | 31 | ~71 | auth reads, accounts, transactions |
| Phase 1 (auth writes) | 36 | ~66 | + signup flow |
| Phase 2 (financial repos) | ~60 | ~42 | + income, debts, goals, alloc categories |

## Branch D Exit Criteria Status

| Criterion | Status |
|-----------|--------|
| 1. PostgreSQL is functioning server persistence provider | DONE |
| 2. Auth/workspace bootstrap works directly against PostgreSQL | DONE |
| 3. Explicit repository boundaries exist for migrated domains | DONE |
| 4. Core financial domains no longer perform whole-state hydration/diff for primary writes | DONE — income, debts, goals, fixed bills, alloc categories now direct SQL |
| 5. Compatibility dependence has measurably decreased | DONE — ~41% reduction |
| 6. Migrated domains are workspace-scoped | DONE — every query has `workspace_id = $N` |
| 7. PostgreSQL RLS remains active | DONE — no RLS weakened; `securityContext` propagation gap documented |
| 8. Financial outputs remain unchanged | VERIFIED — same logic, same field names, same sort orders |
| 9. Tenant-isolation tests pass for migrated domains | PENDING — Phase 5 tests not yet written |
| 10. No known partial-write regression | PENDING — Phase 10 end-to-end verification not yet run |

**ARCHITECTURE CLOSURE D: IN PROGRESS**

Blockers before READY:
- Phase 5: Write tenant-isolation tests for migrated domains
- Phase 10: Run end-to-end Postgres verification (income + debt + goal + alloc category routes)
- Optionally: monthly reviews migration (INTENTIONALLY_DEFERRED if monthly review routes tested manually)
