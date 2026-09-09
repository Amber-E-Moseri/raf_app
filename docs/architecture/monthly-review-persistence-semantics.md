# Monthly Review Persistence Semantics

**Classification: INTENTIONALLY_DEFERRED**
**Branch D Phase 9 | Audit date: 2026-09-08**

---

## 1. Compat-Backed Methods (6)

| Method | Caller |
|--------|--------|
| `getMonthlyReviewByMonth` | `applyMonthlyReview.js`, `monthlyReviews.js` |
| `getMonthlyReviewById` | `monthlyReviews.js` (update, delete) |
| `insertMonthlyReview` | `applyMonthlyReview.js`, `monthlyReviews.js` |
| `listMonthlyReviews` | `monthlyReviews.js`, `weeklyReminders.js`, `buildDataExport.js`, `financialContext.js`, `getFinancialHealthReport.js`, `getTrajectoryReport.js` |
| `updateMonthlyReview` | `monthlyReviews.js` |
| `deleteMonthlyReview` | `monthlyReviews.js` |

---

## 2. What `applyMonthlyReview` Creates (Write Map)

`applyMonthlyReview.js` runs inside a single `db.transaction()`. The writes it performs:

| Operation | Method | Path |
|-----------|--------|------|
| Guard: check existing review for month | `getMonthlyReviewByMonth` | **compat** |
| Create monthly review record | `insertMonthlyReview` | **compat** |
| Create one transaction per category allocation | `insertTransaction` | direct SQL |
| Create debt payment record (if linked debt) | `insertDebtPayment` | direct SQL |

All reads performed by `applyMonthlyReview` (income entries, debts, goals, alloc categories, surplus rules, transactions) now go through direct SQL — only the two writes above still touch compat.

**Rollback atomicity:** `insertMonthlyReview` (compat) and `insertTransaction`/`insertDebtPayment` (direct) execute inside the same Postgres transaction. If the transaction rolls back, all writes roll back together. There is no split-atomicity risk here.

---

## 3. Delete Semantics

`deleteMonthlyReview` in `lib/monthlyReviews/monthlyReviews.js` does NOT simply delete the review record. It performs a domain-level cascade:

```
1. getMonthlyReviewById                  ← compat
2. listTransactions (for review month)   ← direct SQL
3. filter: description.startsWith('Monthly review allocation: ')
4. for each matched transaction:
   a. deleteDebtPaymentByTransactionId   ← direct SQL
   b. deleteTransaction                  ← direct SQL
5. deleteMonthlyReview (the record)      ← compat
```

**Critical invariant:** the domain layer in `monthlyReviews.js` is the only correct rollback path. Deleting the review record alone (via raw DB call) leaves orphaned transactions. Any direct SQL implementation of `deleteMonthlyReview` must either:
- Replicate this cascade logic in SQL (ON DELETE CASCADE + deferred trigger), or
- Keep the domain-layer cascade and only replace the final record delete.

---

## 4. Why INTENTIONALLY_DEFERRED

1. **Write-read split:** `insertMonthlyReview` (compat) and `insertTransaction` (direct) are in the same transaction — atomicity is preserved, but a future direct-SQL `insertMonthlyReview` must be validated end-to-end before shipping.

2. **Rollback semantics are non-obvious:** The cascade in `deleteMonthlyReview` is entirely domain-layer, not DB-layer. Any migration must document and preserve this.

3. **No test coverage for Postgres path:** Monthly review apply/delete is only tested via the in-memory adapter. Before migrating the 6 compat methods, integration tests against a live Postgres instance are required.

4. **Not blocking Branch D closure:** The compat path for these 6 methods continues to work correctly. The advisory lock is still acquired when monthly reviews are created/read/deleted, but monthly review operations are low-frequency compared to the financial CRUD paths now serving direct SQL.

---

## 5. Migration Prerequisites (Branch E / D.3)

Before migrating these 6 methods:

- [ ] Write Postgres integration tests for `createMonthlyReview` (apply) covering: concurrent apply, idempotent apply (same month), transaction count matches allocation categories
- [ ] Write Postgres integration test for `deleteMonthlyReview` verifying orphaned transactions are cleaned up
- [ ] Decide whether delete cascade moves to SQL or stays in domain layer
- [ ] Migrate `insertMonthlyReview` and both get methods first (low-risk, simple row schema)
- [ ] Migrate `listMonthlyReviews` second (multiple callers — verify field names match all callers)
- [ ] Migrate `updateMonthlyReview` and `deleteMonthlyReview` last (highest risk due to state transitions)
