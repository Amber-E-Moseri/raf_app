# Import Pipeline & Merchant Rules — Persistence Classification

**Classification: INTENTIONALLY_DEFERRED (entire domain)**
**Branch D Phase 10 | Audit date: 2026-09-08**

---

## 1. Compat-Backed Methods (24)

### Import batches (3)
| Method | Route / Caller |
|--------|---------------|
| `insertImportBatch` | `lib/imports/uploadImportBatch.js` |
| `getImportBatch` | `lib/imports/approveImportBatch.js`, `parseImportBatch.js`, `rejectImportBatch.js`, `reviewImportBatch.js` |
| `updateImportBatch` | `lib/imports/approveImportBatch.js`, `parseImportBatch.js`, `rejectImportBatch.js`, `reviewImportBatch.js` |

### Imported rows (4)
| Method | Route / Caller |
|--------|---------------|
| `insertImportedRows` | `lib/imports/uploadImportBatch.js` |
| `listImportedRows` | `lib/imports/reviewImportBatch.js` |
| `updateImportedRow` | `lib/imports/reviewImportBatch.js` |
| `getImportedRow` | `lib/imports/reviewImportBatch.js` |

### Imported transactions (5)
| Method | Route / Caller |
|--------|---------------|
| `insertImportedTransactions` | `lib/imports/parseImportBatch.js` |
| `listImportedTransactions` | `lib/imports/reviewImportedTransactions.js` |
| `getImportedTransactionById` | `lib/imports/reviewImportedTransactions.js` |
| `updateImportedTransaction` | `lib/imports/approveImportBatch.js`, `reviewImportedTransactions.js` |
| `findDuplicateTransaction` | `lib/imports/parseImportBatch.js` |

### Import review rules (7)
| Method | Route / Caller |
|--------|---------------|
| `listImportReviewRules` | `lib/imports/parseImportBatch.js`, `reviewImportedTransactions.js` |
| `getImportReviewRuleById` | `lib/imports/reviewImportedTransactions.js` |
| `findImportReviewRuleByNormalizedDescription` | `lib/imports/parseImportBatch.js` |
| `upsertImportReviewRule` | `lib/imports/reviewImportedTransactions.js` |
| `updateImportReviewRule` | `lib/imports/reviewImportedTransactions.js` |
| `deleteImportReviewRule` | `lib/imports/reviewImportedTransactions.js` |
| `touchImportReviewRule` | `lib/imports/parseImportBatch.js` |

### Merchant rules (5)
| Method | Route / Caller |
|--------|---------------|
| `insertMerchantRule` | `lib/imports/reviewImportedTransactions.js` |
| `listMerchantRules` | `lib/imports/parseImportBatch.js` |
| `getMerchantRuleById` | `lib/imports/reviewImportedTransactions.js` |
| `updateMerchantRule` | `lib/imports/reviewImportedTransactions.js` |
| `deleteMerchantRule` | `lib/imports/reviewImportedTransactions.js` |

---

## 2. Why INTENTIONALLY_DEFERRED

1. **Largest remaining compat surface (24 methods).** Migrating piecemeal risks partial-state corruption during the multi-step workflow (upload → parse → review → approve/reject). This domain should migrate as a unit.

2. **Multi-step workflow with intermediate state.** An import batch progresses through status transitions (`uploaded → parsed → reviewed → approved/rejected`). Mixing compat-backed status updates with direct-SQL reads during a live workflow is safe only because all writes happen inside one transaction per step — but the migration plan must verify this for each step.

3. **Not part of core financial CRUD.** Branch D's primary goal was retiring compat for income, debts, goals, alloc categories, and fixed bills — the daily-use financial paths. Import is a periodic, lower-frequency workflow.

4. **`findDuplicateTransaction` joins across compat tables.** The query must compare against existing `transactions` (direct SQL) and `imported_transactions` (compat). A direct SQL implementation requires a cross-table join that is currently expressed in JS (in-memory filter). This join must be replicated in SQL during migration.

---

## 3. Migration Plan (Future Branch)

Migrate in workflow order to avoid partial-state risk:

| Step | Methods | Dependency |
|------|---------|------------|
| 1 | `insertImportBatch`, `getImportBatch`, `updateImportBatch` | None |
| 2 | `insertImportedRows`, `listImportedRows`, `updateImportedRow`, `getImportedRow` | Step 1 |
| 3 | `insertImportedTransactions`, `listImportedTransactions`, `getImportedTransactionById`, `updateImportedTransaction` | Steps 1–2 |
| 4 | `findDuplicateTransaction` | Step 3 (needs join against direct `transactions`) |
| 5 | `listImportReviewRules`, `getImportReviewRuleById`, `findImportReviewRuleByNormalizedDescription`, `upsertImportReviewRule`, `updateImportReviewRule`, `deleteImportReviewRule`, `touchImportReviewRule` | Step 3 |
| 6 | `insertMerchantRule`, `listMerchantRules`, `getMerchantRuleById`, `updateMerchantRule`, `deleteMerchantRule` | None (independent) |

Full end-to-end import workflow test against live Postgres required before declaring import migration complete.
