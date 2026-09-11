# Phase 0: Authoritative History Audit

## Historical Provenance Matrix

### ALLOCATION PLAN

| Component | Authoritative Source | Reconstructable? | Safe for Timeline? | Safe for Then-vs-Now? |
|-----------|----------------------|------------------|--------------------|----------------------|
| Current plan snapshot | `raf.allocation_categories` with `effective_from` / `superseded_at` | ✅ Yes (via snapshot_id) | ✅ Yes | ✅ Yes |
| Plan history | `raf.allocation_categories` snapshot versioning | ✅ Yes (snapshot_id + effective dates) | ✅ Yes | ✅ Yes |
| Plan changes | `raf.workspace_activity` with action='plan_change' | ✅ Yes (via entity_type='plan') | ✅ Yes | ✅ Yes |
| User intent/reason | `raf.workspace_activity.metadata` (must add field) | ❌ No (optional field) | ⚠️ Partial | ⚠️ Partial |

**Decision:** Use snapshot_id + effective_from/superseded_at as primary source. Optionally capture reason in workspace_activity.metadata.

---

### CLOSED MONTHS

| Component | Authoritative Source | Reconstructable? | Safe for Timeline? | Safe for Then-vs-Now? |
|-----------|----------------------|------------------|--------------------|----------------------|
| Monthly income | `raf.income_entries` (sum by month) | ✅ Yes (received_date) | ✅ Yes | ✅ Yes |
| Monthly spending | `raf.transactions` (sum by month) | ✅ Yes (transaction_date) | ✅ Yes | ✅ Yes |
| Monthly surplus/deficit | `raf.monthly_reviews` (net_surplus column) | ✅ Yes (immutable after close) | ✅ Yes | ✅ Yes |
| Category actuals | `raf.transactions` grouped by category_id | ✅ Yes (category_id + date) | ✅ Yes | ✅ Yes |
| Allocation plan active for month | `raf.allocation_categories` (effective_from ≤ month ≤ superseded_at) | ✅ Yes (via snapshot logic) | ✅ Yes | ✅ Yes |
| Monthly close timestamp | `raf.monthly_reviews.created_at` | ✅ Yes (immutable) | ✅ Yes | ✅ Yes |
| Monthly close immutability | Monthly reviews are append-only (no update after created) | ✅ Yes (enforce in code) | ✅ Yes | ✅ Yes |

**Decision:** Monthly snapshot is authoritative. Income/spending are reconstructable from transactions. Plan snapshot retrieved by effective_from/superseded_at.

---

### GOALS

| Component | Authoritative Source | Reconstructable? | Safe for Timeline? | Safe for Then-vs-Now? |
|-----------|----------------------|------------------|--------------------|----------------------|
| Goal target_date | `raf.goals.target_date` | ✅ Yes | ⚠️ Risky (do not infer completion) | ⚠️ Risky (do not infer completion) |
| Goal completion state | ❌ No explicit completed_at field | ❌ No | ❌ No | ❌ No |
| Goal completion timestamp | ❌ Missing (must add or infer from activity) | ❌ No | ❌ No | ❌ No |
| Goal balance history | ❌ No snapshots per goal | ❌ No | ❌ No | ❌ No |
| Goal contribution history | `raf.transactions` (category matches goal bucket) | ⚠️ Partial (not goal-specific) | ⚠️ Partial | ⚠️ Partial |
| Goal milestone history | ❌ Missing | ❌ No | ❌ No | ❌ No |

**Decision:** PHASE 1 BLOCKER - Goals lack completed_at and balance snapshots. Add migration:
- `goals.completed_at` (nullable timestamp)
- `goals.completed_amount` (nullable numeric) - balance at completion
- Use workspace_activity to log goal completion events

---

### DEBTS

| Component | Authoritative Source | Reconstructable? | Safe for Timeline? | Safe for Then-vs-Now? |
|-----------|----------------------|------------------|--------------------|----------------------|
| Starting balance | `raf.debts.starting_balance` | ✅ Yes | ✅ Yes | ✅ Yes |
| Payments ledger | `raf.debt_payments` (date, amount) | ✅ Yes | ✅ Yes | ✅ Yes |
| Charges/fees | `raf.debt_adjustments` (type, amount) | ✅ Yes (if populated) | ✅ Yes | ✅ Yes |
| Interest calculation | `raf.debts.apr` + payment dates | ⚠️ Partial (APR static) | ⚠️ Risky | ⚠️ Risky |
| Balance as-of date | Reconstructable: starting - payments + adjustments | ✅ Yes | ✅ Yes | ✅ Yes |
| Debt status changes | `raf.debts.is_active` (no history) | ❌ No | ❌ No | ❌ No |

**Decision:** Use ledger reconstruction. Interest is static APR (no historical rate changes). Track status via workspace_activity.

---

### ACCOUNTS (Financial Accounts)

| Component | Authoritative Source | Reconstructable? | Safe for Timeline? | Safe for Then-vs-Now? |
|-----------|----------------------|------------------|--------------------|----------------------|
| Account reconciliation snapshots | `raf.financial_accounts` + reconciliation table | ✅ Yes (if snapshots exist) | ✅ Yes | ✅ Yes |
| Historical balance | ❌ No snapshots per account | ❌ No | ❌ No | ❌ No |
| Account activity | Import transactions with reconciliation | ⚠️ Partial | ⚠️ Partial | ⚠️ Partial |

**Decision:** PHASE 6 BLOCKER - Accounts lack reconciliation snapshots. Mark as UNAVAILABLE for Then-vs-Now until snapshots are added.

---

### WORKSPACE ACTIVITY

| Component | Authoritative Source | Reconstructable? | Safe for Timeline? | Safe for Then-vs-Now? |
|-----------|----------------------|------------------|--------------------|----------------------|
| Plan changes | `raf.workspace_activity` (action='plan_changed') | ✅ Yes | ✅ Yes | ✅ Yes |
| Financial decisions | `raf.workspace_activity` (action='financial_decision') | ✅ Yes | ✅ Yes | ✅ Yes |
| Goal updates | `raf.workspace_activity` (action='goal_updated') | ✅ Yes | ✅ Yes | ✅ Yes |
| Debt strategy changes | `raf.workspace_activity` (action='debt_strategy_changed') | ✅ Yes | ✅ Yes | ✅ Yes |
| User reason/metadata | `raf.workspace_activity.metadata` | ⚠️ Partial (optional) | ⚠️ Partial | ⚠️ Partial |

**Decision:** Activity log is authoritative for strategy changes. Metadata is optional but encouraged.

---

## Safe Metrics Summary

| Metric | Status | Source | Provenance |
|--------|--------|--------|------------|
| Closed-month income | ✅ SAFE | income_entries sum | LEDGER_RECONSTRUCTED |
| Closed-month spending | ✅ SAFE | transactions sum | LEDGER_RECONSTRUCTED |
| Closed-month surplus/deficit | ✅ SAFE | monthly_reviews.net_surplus | SNAPSHOT |
| Category actual (closed month) | ✅ SAFE | transactions filtered by category | LEDGER_RECONSTRUCTED |
| Planned allocation (closed month) | ✅ SAFE | allocation_categories snapshot | SNAPSHOT |
| Debt balance as-of date | ✅ SAFE | ledger reconstruction | LEDGER_RECONSTRUCTED |
| Debt payment history | ✅ SAFE | debt_payments | SNAPSHOT |
| Plan changes | ✅ SAFE | workspace_activity | SNAPSHOT |
| Goal completion | ❌ BLOCKED | ← missing completed_at | UNAVAILABLE |
| Account historical balance | ❌ BLOCKED | ← missing reconciliation snapshots | UNAVAILABLE |
| Interest accrual | ⚠️ RISKY | Static APR only | SNAPSHOT (limited) |

---

## Migrations Required

### Migration 1: Add Goal Completion Tracking
```sql
ALTER TABLE raf.goals
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN completed_amount numeric(12,2);

CREATE INDEX idx_goals_completed_at ON raf.goals (completed_at) WHERE completed_at IS NOT NULL;
```

### Migration 2: Add Plan Change Reason to Activity
Already covered by `workspace_activity.metadata` JSONB. No migration needed; document optional `reason` field in metadata shape.

### Migration 3: Activity Category Enum
Add event_category column to workspace_activity to categorize decisions vs. operational events.

```sql
ALTER TABLE raf.workspace_activity
  ADD COLUMN event_category text DEFAULT 'operational' CHECK (event_category IN ('operational', 'financial_decision', 'plan_change', 'goal_update', 'debt_strategy'));
```

---

## Phase 1-7 Blockers

| Phase | Blocker | Mitigation |
|-------|---------|-----------|
| 1 (Velocity) | None | Ready to proceed |
| 2 (Pressure) | None | Ready to proceed |
| 3 (History) | None | Ready to proceed |
| 4 (Decisions) | Optional reason capture | Use workspace_activity.metadata |
| 5 (Timeline) | Goal completion missing | Blocked until Migration 1 applied |
| 6 (Then-vs-Now) | Account historical balance missing | Mark as UNAVAILABLE for now |
| 7 (Resilience) | Product semantics undefined | Blocked (awaiting approval) |

---

## Next Steps

1. ✅ Apply Migration 1 (Goal Completion)
2. ✅ Apply Migration 3 (Activity Category)
3. Implement Phase 1-6 in order
4. Phase 7 blocked until semantics approved
