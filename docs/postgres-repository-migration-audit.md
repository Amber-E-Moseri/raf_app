# PostgreSQL Repository Migration Audit
## Branch D — Phase 0 (Read-Only)

**Audit date:** 2026-09-08
**Working directory:** `C:\Users\moser\Downloads\raf\raf_app`

---

## 1. Does `postgresDb.js` Exist?

**Yes.** `/lib/server/postgresDb.js` exists and is fully implemented (1042 lines). It imports `Pool` from `pg` and defines `createPostgresDb()`, `buildDirectTransaction()`, `createHybridTransaction()`, and all diff/flush helpers.

**Critical gap:** `pg` is **not listed** in `package.json` dependencies. `package.json` lists only `better-sqlite3` as a DB driver. The Postgres path cannot execute at runtime unless `pg` is installed separately. `index.js` does not call `createPostgresDb()` at all — it always calls `createSqliteDb()`. The factory in `lib/server/db.js` exists and can route between drivers, but is never called from `index.js`.

---

## 2. DB Driver(s) in `package.json`

```
dependencies:
  better-sqlite3: ^12.9.0   ← only DB driver present
  (no pg, no postgres, no @neondatabase/serverless)
```

`lib/server/postgresDb.js` has `import { Pool } from 'pg'` at line 3. This is a latent import that would throw at module-load time if reached, but the production server startup sequence never reaches it.

---

## 3. Migration Schema Shape

Two parallel migration lineages coexist — an early `public` schema (Supabase-era) and the current `raf` schema. Only the `raf` schema is used by `postgresDb.js`.

| File | Schema | What it adds |
|---|---|---|
| `20260313120000_create_raf_schema.sql` | `public` | Original household-centric schema. RLS via `auth.uid()`. |
| `20260313133000_add_import_workflow_tables.sql` | `public` | `import_batches`, `imported_transaction_rows`, `merchant_rules`. |
| `20260313143000_add_monthly_reviews.sql` | `public` | `monthly_reviews`. |
| `20260313150000_extend_import_review_metadata.sql` | `public` | Import review workflow columns. |
| `20260313152000_update_merchant_rules_shape.sql` | `public` | Alters `merchant_rules` shape. |
| `20260313170000_harden_backend_integrity.sql` | `public` | CHECK constraints, triggers, enables RLS on all tables. |
| `20260903090000_workspace_postgres_persistence.sql` | `raf` | **Primary production schema.** Full `raf.*` schema: `app_users`, `workspaces`, `workspace_members`, `households`, `allocation_categories`, `surplus_split_rules`, `income_entries`, `income_allocations`, `debts`, `goals`, `import_batches`, `transactions`, `debt_payments`, `debt_adjustments`, `fixed_bills`, `imported_transaction_rows`, `imported_transactions`, `merchant_rules`, `import_review_rules`, `monthly_reviews`, `pdf_import_quotas`, `remi_conversations`, `remi_messages`, `email_preferences`, `email_send_log`. Enables RLS with `raf.has_workspace_membership()` policies. Defines `raf.current_app_user_id()`, `raf.current_workspace_id()`, `raf.has_workspace_membership()`, `raf.has_workspace_role()`. |
| `20260903120000_financial_accounts.sql` | `raf` | `financial_accounts`, `account_reconciliations`. Adds `account_id` FK to transactions/import tables. |
| `20260904000000_collaboration.sql` | `raf` | `workspace_invitations`, `workspace_activity`. Both with RLS. |
| `20260905000000_add_token_blacklist.sql` | `raf` | `raf.token_blacklist` (jti, expires_at). **No RLS policy defined — gap.** |
| `20260905010000_enable_rls_policies.sql` | `public` | Adds `raf.current_workspace_id()` function and isolation policies on legacy `public.*` tables. |

**Schema divergence:** The `public` schema uses `household_id` as tenant key and `auth.uid()` for user identity. The `raf` schema uses `workspace_id` and `raf.current_app_user_id()`. Only the `raf` schema is active for the Postgres adapter.

---

## 4. Every Operation Routed Through the Compatibility Adapter

The Proxy in `createHybridTransaction()` intercepts any method call not in `buildDirectTransaction(client)`. The following fall through to in-memory hydration:

| Domain | Compatibility-routed `tx.*` methods |
|---|---|
| Auth/user lifecycle | `createUser`, `getUserById`, `createHousehold`, `createWorkspace`, `createUserHousehold`, `listHouseholdsForUser`, `updateWorkspace`, `deleteUserOwnedWorkspaces`, `deleteUser`, `getHousehold` (fallback) |
| Invitations | `createWorkspaceInvitation`, `getWorkspaceInvitationByToken`, `getWorkspaceInvitationById`, `listWorkspaceInvitations`, `updateWorkspaceInvitation` |
| Workspace activity | `listWorkspaceActivity` |
| Household settings | `updateHousehold` |
| Allocation categories | `listAllocationCategories`, `replaceAllocationCategories`, `listAllocationCategorySnapshots`, `listSurplusSplitRules`, `replaceSurplusSplitRules` |
| Income | `findIncomeByIdempotencyKey`, `insertIncomeEntry`, `listIncomeEntries`, `getIncomeEntryById`, `updateIncomeEntry`, `deleteIncomeEntry`, `insertIncomeAllocations`, `deleteIncomeAllocationsByIncomeEntryId`, `listIncomeAllocations`, `listIncomeAllocationsBySlug` |
| Fixed bills | `listFixedBills`, `insertFixedBill`, `getFixedBillById`, `updateFixedBill` |
| Goals | `listGoals`, `insertGoal`, `getGoalById`, `updateGoal`, `deleteGoal` |
| Debts | `insertDebt`, `listDebts`, `getDebtById`, `updateDebt`, `deleteDebt`, `countDebtPaymentsForDebt`, `findDebtById`, `listDebtPayments`, `insertDebtAdjustment`, `listDebtAdjustments` |
| Merchant rules | `listMerchantRules`, `insertMerchantRule`, `getMerchantRuleById`, `updateMerchantRule`, `deleteMerchantRule` |
| Import workflow | `insertImportBatch`, `getImportBatch`, `updateImportBatch`, `insertImportedRows`, `listImportedRows`, `updateImportedRow`, `getImportedRow`, `insertImportedTransactions`, `listImportedTransactions`, `getImportedTransactionById`, `updateImportedTransaction`, `findDuplicateTransaction`, `listImportReviewRules`, `getImportReviewRuleById`, `findImportReviewRuleByNormalizedDescription`, `upsertImportReviewRule`, `updateImportReviewRule`, `deleteImportReviewRule`, `touchImportReviewRule` |
| Monthly reviews | `getMonthlyReviewByMonth`, `insertMonthlyReview`, `listMonthlyReviews`, `getMonthlyReviewById`, `updateMonthlyReview`, `deleteMonthlyReview` |

**Directly implemented** methods in `buildDirectTransaction` (bypass compatibility):

`getWorkspace`, `getHousehold`, `getUserByEmail`, `insertBlacklistedToken`, `isTokenBlacklisted`, `cleanupExpiredBlacklistedTokens`, `logWorkspaceActivity`, `listWorkspacesForUser`, `getUserWorkspaceAccess`, `createWorkspaceMember`, `listWorkspaceMembers`, `getWorkspaceMember`, `updateWorkspaceMember`, `removeWorkspaceMember`, `updateWorkspaceOwner`, `deleteWorkspaceById`, `insertFinancialAccount`, `listFinancialAccounts`, `getFinancialAccountById`, `updateFinancialAccount`, `insertAccountReconciliation`, `listAccountReconciliations`, `getAccountReconciliationById`, `updateAccountReconciliation`, `insertTransaction`, `listTransactions`, `getTransactionById`, `updateTransaction`, `deleteTransaction`, `deleteDebtPaymentByTransactionId`, `insertDebtPayment`

---

## 5. How State Is Hydrated Into Memory

### Production path (SQLite)

Every `db.transaction()` call operates in-process. At startup, `createSqliteDb()` calls `loadStateFromSqlite(sqlite)` — `SELECT raw_json FROM <table>` for all 24 tables — building a single shared JS `state` object. All `tx.*` calls in `inMemoryDb.js` read and mutate this object. After each transaction, `persistStateToSqlite()` does a full `DELETE FROM <table>` + re-INSERT for every row in every table. **All workspace data coexists in one JS object with no JS-layer isolation between tenants.**

### Postgres compatibility path

On the first call to any method not in `buildDirectTransaction`, the Proxy fires `getLegacyTx()`:
1. Acquires `pg_advisory_xact_lock(hashtext('raf.postgres_compatibility_adapter'))` — a single global lock.
2. Calls `loadState(client)` — `SELECT raw_json FROM raf.<table>` for all tables.
3. Builds a fresh `createInMemoryDb()` state object and overlays it.
4. Runs the in-memory method.
5. After callback returns, calls `flushTableDiff()` to compute deltas and write them back.

---

## 6. Diff-and-Flush Mechanism

Only the **Postgres compatibility path** diffs. `diffRows()` compares:
```
oldRows (hydrated from DB) vs newRows (in-memory state after mutation)
→ upserted: rows where id is new OR JSON has changed
→ deleted: ids in old but not in new
→ flush: DELETE WHERE id = any(deleted), UPSERT via ON CONFLICT (id) DO UPDATE
```

This fires for **all 28 TABLES entries** on every compatibility-path transaction, even if only one table was touched. The SQLite adapter never diffs — full DELETE + re-INSERT for all 24 tables on every transaction.

---

## 7. Advisory Lock Usage

Exactly one advisory lock exists:

```sql
SELECT pg_advisory_xact_lock(hashtext('raf.postgres_compatibility_adapter'))
```

Acquired lazily in `getLegacyTx()` at the start of any transaction falling back to the compatibility path. **This is a single global lock** — not per-workspace, not per-table. Any two simultaneous compatibility-path transactions across any workspace serialize globally. Direct-SQL operations (transactions, accounts, workspace membership) never take this lock.

---

## 8. Direct SQL Operations That Already Exist

Already bypassing in-memory hydration in `buildDirectTransaction`:

- **Identity/auth:** `getUserByEmail`, `getWorkspace`, `getHousehold` (by workspace_id)
- **Token blacklist:** `insertBlacklistedToken`, `isTokenBlacklisted`, `cleanupExpiredBlacklistedTokens`
- **Workspace membership:** `createWorkspaceMember`, `listWorkspaceMembers`, `getWorkspaceMember`, `updateWorkspaceMember`, `removeWorkspaceMember`, `updateWorkspaceOwner`, `deleteWorkspaceById`, `listWorkspacesForUser`, `getUserWorkspaceAccess`
- **Workspace activity:** `logWorkspaceActivity` (insert only)
- **Financial accounts:** `insertFinancialAccount`, `listFinancialAccounts`, `getFinancialAccountById`, `updateFinancialAccount`
- **Account reconciliations:** `insertAccountReconciliation`, `listAccountReconciliations`, `getAccountReconciliationById`, `updateAccountReconciliation`
- **Transactions:** `insertTransaction`, `listTransactions`, `getTransactionById`, `updateTransaction`, `deleteTransaction`, `deleteDebtPaymentByTransactionId`, `insertDebtPayment`

---

## 9. Transaction Boundaries

### SQLite

`snapshot = clone(state)` → run callback (async, spans event loop ticks — state is inconsistent mid-callback) → `persistStateToSqlite()` → on error: `replaceState(snapshot)`. Full DELETE + re-INSERT for all tables on every transaction. No isolation between concurrent requests.

### Postgres

Standard `BEGIN`/`COMMIT`/`ROLLBACK` ACID semantics. `set_config('raf.user_id', ..., true)` and `set_config('raf.workspace_id', ..., true)` establish transaction-local RLS context. All direct SQL and compatibility flush occur inside the same transaction. Read-committed isolation by default.

---

## 10. Workspace Scoping Mechanism

### Header ingestion (three aliases)

```
x-workspace-id  → preferred
x-household-id  → accepted
x-household_id  → accepted
```

All three map to the same `householdId` concept in the current codebase.

### Trust boundary

**Without auth (dev mode):** Header value accepted as-is — any client can pass any household ID.

**With auth (`RAF_AUTH_REQUIRED=true`):** Bearer token verified → `userId` from JWT claims → workspace membership verified via `getUserWorkspaceAccess` → `workspaceContext.householdId` passed to all domain calls. **The header value is never trusted directly in authenticated mode.** The domain layer always receives the server-resolved `householdId`.

### `workspaceId === householdId`

Throughout the codebase these are the same value. `workspaceIdFromHousehold(householdId)` returns `householdId` unchanged.

### RLS context injection (Postgres path only)

```sql
SELECT set_config('raf.user_id', $1, true)
SELECT set_config('raf.workspace_id', $1, true)
```

The `true` (transaction-local) flag prevents context leakage between pooled connections.

---

## 11. RLS Status

**`raf` schema:** RLS is defined in migrations and would provide defense-in-depth if the connecting role is not `BYPASSRLS`. The `token_blacklist` table has **no RLS policy** — gap to address in Branch E.

**Production runtime (SQLite):** RLS has no effect today.

**Legacy `public` schema:** Has RLS via `auth.uid()` (Supabase) — not active with the Node.js direct-connection model.

---

## 12. Candidate Migration Order

| Rank | Domain | Justification |
|---|---|---|
| 1 | **Token blacklist** | Already fully direct SQL. 1 table, no workspace scoping, 3 operations. Zero-impact extraction. |
| 2 | **Workspace activity — list** | Only `listWorkspaceActivity` falls back. Simple append-only table. |
| 3 | **Workspace invitations** | Isolated collaboration domain. 1 table, no financial calculations. |
| 4 | **Financial accounts + reconciliations** | Already fully direct SQL. 2 tables, no cross-domain writes. |
| 5 | **Fixed bills** | Simple CRUD. 1 table, no cross-domain writes. |
| 6 | **Goals** | Simple CRUD. 1 table. Referenced by transactions FK but doesn't write to others. |
| 7 | **Merchant rules / import review rules** | Simple CRUD. 2 tables. Read during import, written independently. |
| 8 | **Debts** | Moderate. `debt_payments` and `debt_adjustments` are sub-tables. `insertDebtPayment` already direct. DB trigger `trg_prevent_debt_delete_with_payments` must be respected. |
| 9 | **Allocation categories + surplus split rules** | Complex snapshot mechanism (`snapshotId`, `effectiveFrom`, `supersededAt`). DB triggers enforce percent sums. `replaceAllocationCategories` touches many rows atomically. |
| 10 | **Transactions** | Cross-domain writes (debt payment sync). Core CRUD already direct. |
| 11 | **Income** | Complex: `createIncome` must atomically insert `income_entry` + all `income_allocations`. DB trigger enforces total. |
| 12 | **Monthly review — apply** | Most complex transaction in system. Reads 7 tables, inserts `monthly_review` + N transactions + N debt payments atomically. Any partial state is financially inconsistent. |

---

## 13. Behavior That Must Remain Invariant

### Financial invariants

| Invariant | Enforced by |
|---|---|
| Income allocation total equals deposit amount | DB trigger `trg_income_allocations_total` + `computeDepositAllocations.js` |
| Active allocation category percents sum to 1.0000 ± 0.0001 | DB trigger `trg_allocation_categories_percent_sum` |
| Active surplus split percents sum to 1.0000 ± 0.0001 | DB trigger `trg_surplus_split_rules_percent_sum` |
| Debt cannot be deleted with payments | DB trigger `trg_prevent_debt_delete_with_payments` + `countDebtPaymentsForDebt` |
| Allocation rounding: last category absorbs remainder | `computeDepositAllocations.js` — pure JS |
| Net surplus calculation | `computeMonthlyReviewSnapshot` in `lib/raf/reporting.js` — pure JS |
| Transaction amount > 0 | Zod validation + DB CHECK constraint |
| Debt payment amount > 0 | DB CHECK constraint |
| Income amount > 0 | Zod validation + DB CHECK constraint |

### API response shapes that must not change

- `POST /income` → `{ incomeId, allocations: [{ category, slug, amount }] }`
- `GET /income` → `{ items: [...], total }`
- `POST /transactions` → `{ id, transactionDate, description, merchant, amount, direction, categoryId, linkedDebtId, linkedGoalId, source }`
- `GET /transactions` → `{ items: [...], nextCursor }`
- `POST /monthly-reviews` (apply) → `{ review: {...}, appliedTransactions: [{id, ...}] }`
- `GET /workspaces` → `{ items: [{ id, name, type, role, status, defaultCurrency, timezone, country }] }`

---

## 14. Existing Test Coverage

| Test file | What it covers | Requires Postgres? |
|---|---|---|
| `tests/sqliteDbPersistence.test.js` | SQLite data survives restart | No |
| `tests/postgresAdapterHardening.test.js` | Source-code assertions on `postgresDb.js` (advisory lock, set_config, direct methods) | No (source inspection) |
| `tests/postgresMigrationSchema.test.js` | Migration file content/ordering | No (reads SQL files) |
| `tests/postgresRlsIsolation.integration.test.js` | RLS row-level isolation between workspaces | **Yes — requires live Postgres** |
| `tests/tenantIsolation.test.js` | Adapter-level tenant isolation | Against in-memory adapter |
| `tests/tenantCrossAccess.test.js` | Cross-workspace read attempts return empty | Against in-memory adapter |
| `tests/viewerWriteDenial.test.js` | Viewer role cannot call writes | HTTP-level |
| `tests/privilegeEscalation.test.js` | Members cannot escalate via workspace routes | HTTP-level |
| Domain tests (`createTransaction.test.js`, etc.) | Domain logic correctness | No — all against `createInMemoryDb()` |

**No unit tests exercise the diff/flush path or the hybrid proxy without a live Postgres connection.** `postgresAdapterHardening.test.js` inspects source text only.

---

## 15. Other Notable Findings

**`lib/server/db.js` never called:** The factory that routes between SQLite and Postgres exists but `index.js` imports `createSqliteDb` directly. Switching to Postgres requires either updating `index.js` or adding `PERSISTENCE_DRIVER` env var handling.

**`__p0_595b/` directory:** A sibling git worktree containing an earlier copy of the codebase. Not production code. Should not be tracked or distributed.

**`token_blacklist` has no RLS:** Created in `20260905000000_add_token_blacklist.sql` with no `ENABLE ROW LEVEL SECURITY`. Low risk (server-only access) but a gap relative to all other tables — flag for Branch E.

**Allocation category snapshot mechanism:** Non-trivial temporal versioning — each snapshot is a group of rows sharing a `snapshotId`. `pickSnapshotIdForDate()` selects the applicable snapshot for any date. SQL translation must preserve this history or historical income lookups break.

**`workspaceId === householdId`:** These are the same value throughout. `workspaceIdFromHousehold(householdId)` returns `householdId` unchanged.

---

## Summary for Branch D Implementation

**Production runtime today:** SQLite only. `pg` not installed. `createPostgresDb` is dead code.

**Minimum work to enable Postgres path:**
1. Install `pg` package
2. Add `POSTGRES_CONNECTION_STRING` + `PERSISTENCE_DRIVER=postgres` env vars
3. Wire `index.js` to call `createServerDb()` from `lib/server/db.js` instead of `createSqliteDb` directly
4. Run migrations against a live Postgres instance
5. Start migrating methods from compatibility fallback into `buildDirectTransaction`, domain by domain, lowest-risk first
6. Advisory lock can be removed only after all `tx.*` methods have direct SQL implementations
