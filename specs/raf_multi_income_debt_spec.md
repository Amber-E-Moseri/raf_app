# RAF Implementation Contract v9.0
**Document Type:** Full Engineering Implementation Contract  
**Status:** Authoritative Build Reference  
**Currency:** CAD · **Timezone default:** America/Toronto  
**Updated:** 2026-09-10

This document is the single source of truth for building and extending the RAF platform. It supersedes v8.0 and all prior drafts. The product has been implemented; this revision reflects the actual stack, schema, and domain logic as built.

---

# 1. Product Framing

RAF (Revenue Allocation Framework) is a **deposit-driven financial system** for individuals with variable income, multiple income streams, or irregular pay cycles.

Traditional budgeting assumes fixed monthly income. RAF instead allocates **each deposit immediately** according to a predefined percentage formula — ensuring every dollar is instantly assigned to obligations, savings, debt payoff, investments, or discretionary spending the moment it arrives.

The system provides:

- Allocation engine — splits every deposit deterministically
- Spending ledger — tracks actuals against budgeted buckets
- Debt tracker — derives live balances from payment history with three-dimensional payment intelligence
- Surplus router — distributes month-end excess by configured rules
- Financial health analyzer — computes key ratios and risk status
- Bank import pipeline — ingests CSV/XLSX/PDF statements with regex + AI fallback parsing
- Remi AI assistant — explains calculations, surfaces patterns, proposes actions (never a financial source of truth)

**Core user guarantee:** users always know where money came from, where it went, what is protected, what is flexible, and what action to take next.

---

# 2. System Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, TypeScript strict |
| Backend | Node.js HTTP server (custom router via `lib/server/routerLoader.js`) |
| Database | PostgreSQL via Neon (production); SQLite (local dev); in-memory adapter (tests) |
| Auth | Custom JWT — email + password; token blacklist for logout |
| Validation | Zod on every write path |
| Hosting | Render |
| AI | Anthropic Claude API (Remi assistant + PDF fallback parsing) |

**Request flow:**

```
React/Vite
  → RAF Node HTTP API
  → JWT authentication (identity)
  → workspace membership check (authorization)
  → domain service (lib/)
  → persistence adapter (inMemoryDb / sqliteDb / postgresDb)
  → Postgres / SQLite
  → workspace-scoped RLS (defense in depth)
```

**Persistence adapters:** all three adapters implement the same interface. The Postgres adapter is a compatibility shim — it hydrates an in-memory state object, runs domain logic, then flushes diffs. This is transitional; hot paths will migrate to direct repository SQL.

**Multi-tenancy:** every financial entity is scoped to a `workspace_id` (consumer-facing alias: `household_id`). Cross-workspace access is forbidden at both the authorization middleware layer and the RLS layer.

**Money precision:** `Decimal(12,2)` throughout. API always returns money as string decimals (e.g. `"1250.00"`). Internal cents arithmetic uses integers.

**Financial write invariant:** no financial calculations inside route handlers or UI components. All domain logic lives in `lib/raf/` and `lib/*/`.

---

# 3. Database Schema

All domain tables contain `workspace_id` (or `household_id` for legacy tables), `created_at`, `updated_at` unless noted. Authoritative schema lives in `db/migrations/`. The summary below documents current shape; refer to migrations for full column-level detail.

---

## users
Email + password credentials, JWT refresh, workspace membership. Identified by `id` (UUID).

---

## workspace_members / workspace_invitations / workspace_activity
Multi-member workspace support. `workspace_members` links users to workspaces with a role. `workspace_invitations` tracks pending invites. `workspace_activity` is the audit log — every significant mutation writes a row here.

---

## token_blacklist
Revoked JWT tokens. Checked on every authenticated request. Cleared by scheduled cleanup.

---

## households
Primary workspace configuration record.

Key fields: `owner_user_id`, `name`, `timezone` (default `America/Toronto`), `active_month` (day=1 anchor, e.g. `2026-09-01`), `period_start_day` (1–28), `savings_floor`, `monthly_essentials_baseline`.

**Fiscal period derivation:** given `active_month = 2026-09-01` and `period_start_day = 5`, the active period is Sep 5 → Oct 4.

---

## allocation_categories

| Field | Type | Notes |
|---|---|---|
| slug | text | Immutable system identifier |
| label | text | User-editable |
| allocation_percent | numeric(6,4) | Stored as fraction: `0.1000` = 10% |
| is_system | boolean | System slugs cannot be deleted |
| is_active | boolean | Excluded from future allocations when false |

**Constraint:** `SUM(allocation_percent) WHERE is_active = true` must equal `1.0000 ± 0.0001`. Enforced on every write.

---

## surplus_split_rules

`SUM(split_percent) WHERE is_active = true` must equal `1.0000 ± 0.0001`.

---

## income_entries / income_allocations

`income_entries`: one row per deposit. `income_allocations`: one row per category per deposit (immutable snapshot of percents at deposit time). PATCH on amount or date deletes + recreates allocations in a transaction.

---

## transactions

`direction`: `debit` = money out; `credit` = money in (transfers, refunds). Credits excluded from surplus outflow. `linked_debt_id` + `debt_payments` row created atomically when a debt payment transaction is posted.

---

## financial_accounts / account_reconciliations

`financial_accounts`: bank/credit accounts linked to a workspace (name, type, institution, current balance). `account_reconciliations`: reconciliation sessions recording opening balance, closing balance, and reconciled transaction IDs. Unreconciled difference surfaced in UI.

---

## debts

Key fields: `name`, `starting_balance`, `apr`, `minimum_payment` (floor; used for obligation tracking), `monthly_payment` (planned; used for trajectory and pace), `statement_day`, `payment_due_day`, `late_fee_amount`, `auto_post_interest`, `auto_post_late_fee`, `is_active`.

**Balance derivation:** `current_balance = starting_balance - SUM(debt_payments.amount)`. Never stored; always derived on read.

**Delete rule:** blocked (422) if any `debt_payments` rows exist. Use `is_active = false` instead.

---

## debt_payments

One row per payment. Linked to a transaction via `transaction_id` (nullable — payments can exist without a linked transaction for historical data entry).

---

## debt_adjustments

Manual interest corrections, fees, balance adjustments, and generated (auto-posted) entries. Fields: `amount`, `adjustment_type` (`interest` | `late_fee` | `fee` | `manual`), `effective_date`, `note`, `generated` (boolean — generated rows are auto-posted, not user-created).

---

## debt_payment_pace_acknowledgements

Records user decisions in response to payment pace insights.

| Field | Notes |
|---|---|
| `action` | `update_plan` \| `keep_plan` \| `acknowledge_onetime` |
| `payment_period_month` | YYYY-MM of the observation period |
| `acknowledgement_date` | timestamp |
| `new_monthly_payment` | populated only for `update_plan` action |

Composite unique index: `(workspace_id, debt_id, payment_period_month, action)` — upserts on conflict.

---

## import_batches / imported_transaction_rows / import_review_rules

`import_batches`: one per uploaded file (CSV, XLSX, PDF). `imported_transaction_rows`: parsed rows pending review. `import_review_rules`: workspace-level auto-classification rules applied during review.

**Duplicate detection:** flagged when `amount + date + normalized_merchant` matches an existing transaction.

---

## merchant_rules
Pattern-based auto-categorization rules. Match types: `exact` | `contains` | `starts_with` | `regex`. Higher `priority` wins on conflict.

---

## fixed_bills
Recurring fixed expenses with amount, due day, and category linkage.

---

## goals
Savings/spending goals with target amount, deadline, and monthly contribution tracking.

---

## upcoming_expenses
Planned future expenses not yet recurring — one-off purchases, irregular bills.

---

## email_preferences
Per-workspace notification preferences (weekly summary, payment reminders, etc.).

---

## monthly_reviews

`UNIQUE (workspace_id, review_month)`. Stores computed `net_surplus`, applied `split_applied` snapshot, `distributions` (JSON), and `alert_status`.

---

# 4. Seed Data

Seeded automatically on workspace creation.

## Default Allocation Categories

| slug | label | allocation_percent | is_system |
|---|---|---|---|
| savings | Savings | 0.1000 | true |
| tithe | Tithe | 0.1000 | false |
| partnership | Partnership | 0.1500 | false |
| offerings | Offerings | 0.0500 | false |
| fixed_bills | Fixed Bills | 0.3000 | true |
| personal_spending | Personal Spending | 0.1500 | true |
| investment | Investment | 0.1000 | false |
| debt_payoff | Debt Payoff | 0.1000 | false |
| buffer | Buffer | 0.1000 | true |

Total: **1.0000**

## Default Surplus Split Rules

| slug | label | split_percent |
|---|---|---|
| emergency_fund | Emergency Fund | 0.30 |
| extra_debt_payoff | Extra Debt Payoff | 0.40 |
| investment | Investment | 0.20 |
| giving | Giving | 0.10 |

Total: **1.0000**

---

# 5. Core Financial Logic

All deterministic logic lives in `lib/raf/` and `lib/*/`. No financial calculations in route handlers or components.

## 5.1 RAF Allocation Engine (`lib/raf/reporting.js`)

```
allocations = []
total_assigned = 0

for each category in activeCategories (sorted by sort_order):
    allocated = floor(amount × category.allocation_percent × 100) / 100
    allocations.push({ category, allocated })
    total_assigned += allocated

remainder = amount - total_assigned
buffer_allocation += remainder   -- remainder always goes to buffer slug
```

Sum of all allocations must equal deposit amount exactly.

---

## 5.2 Debt Balance Derivation (`lib/raf/debts.js`)

```
current_balance = starting_balance - SUM(debt_payments.amount) + SUM(debt_adjustments.amount)
```

Balances are never stored. Direct PATCH of balance fields returns 422.

---

## 5.3 Debt Payment Intelligence (Three Dimensions)

Three independent signals derived per debt per snapshot. Each has its own field; none drives the others.

### 5.3.1 Payment Pace (`classifyPaymentPace`)

Classifies actual vs planned payment pace over observed periods:

| Pace | Condition |
|---|---|
| `above_plan` | actual ≥ plan × 1.05 OR actual ≥ plan + $5 |
| `at_plan` | within tolerance (5% or $5) |
| `below_plan` | actual < plan − tolerance |
| `minimum_only` | actual ≈ minimum_payment (within tolerance) |
| `no_data` | fewer than 1 completed period |

Tolerance: 5% of planned amount or $5, whichever is larger.

**Projection suppression:** pace insight projections are suppressed when the observed month is the current month (incomplete period). The most recent completed month is used as the observed basis, not the current-month mean.

**D2 fix:** when only 1–2 completed periods exist, use the most recent single period rather than a mean that would underweight early data.

**Savings gate:** `acceleratedMonths` and interest savings are only shown when `monthDifference > 1 OR interestSavingsCents > SAVINGS_MIN_CENTS ($50)`.

### 5.3.2 Below-Plan Warning (`buildDebtPaymentInsight`)

Emits `below_plan_warning: true` (with `amountBelowPlan` and `acceleratedMonths`) only when:
- pace ∈ `{below_plan, minimum_only}`
- `percentOfPlan < WELL_BELOW_PLAN_PCT (60%)`
- **current obligation window is not open** (invariant: an open obligation before its due date is never a negative signal)

`acceleratedMonths` may be negative (paying below minimum means payoff gets longer, not shorter).

### 5.3.3 Payment Obligation (`derivePaymentObligation`)

Aggregates all payments in the current obligation window (statement cycle) before judging:

| Status | Condition |
|---|---|
| `satisfied` | totalPaid ≥ planned OR totalPaid ≥ minimum |
| `in_progress` | window open (not yet past due date), partial payment recorded |
| `pending` | window open, no payment yet |
| `missed_payment` | window closed, no payment |
| `under_minimum` | window closed, paid > 0 but < minimum |

**Invariant:** open obligations (before due date) never surface as `missed_payment` or `under_minimum`. Partial funding before the due date reads as `in_progress`.

### 5.3.4 Balance Trajectory (`deriveBalanceTrajectory`)

Computed from opening vs closing balance only — never from payment pace:

| Trajectory | Condition |
|---|---|
| `decreasing` | closing < opening |
| `flat` | closing ≈ opening (within $1) |
| `increasing` | closing > opening |

`warning: true` is set when trajectory is `increasing`.

**Invariant:** `above_plan` pace + `increasing` trajectory is valid — the trajectory warning surfaces with visual precedence over the above-plan block.

### 5.3.5 Balance Change Explanation (`explainBalanceChange`)

Breaks the opening→closing delta into:
- `paymentsCents` — payments recorded in period
- `interestCents` — interest adjustments
- `feesCents` — late fee and other fee adjustments
- `newActivityCents` — `max(0, adjustmentsCents) + max(0, unexplainedCents)` — new charges or borrowing
- `adjustmentsCents` — manual adjustments (can be negative)

`newActivityCents` is always non-negative. It represents new charges or borrowing that increased the balance beyond what payments + interest + fees explain.

### 5.3.6 Snapshot Independence (Invariant 1)

`deriveDebtSnapshot` calls all three derivations independently:
```js
snapshot.paymentObligation = derivePaymentObligation(...)
snapshot.balanceTrajectory = deriveBalanceTrajectory(...)
snapshot.balanceExplanation = explainBalanceChange(...)
```
None of these fields influences any other.

### 5.3.7 Acknowledgement Flow

Users respond to pace insights via one of three actions:

| Action | Effect |
|---|---|
| `update_plan` | Sets `monthlyPayment` to `newMonthlyPayment` on the debt; writes audit event `debt.updated` |
| `keep_plan` | Records acknowledgement; no plan mutation |
| `acknowledge_onetime` | Records acknowledgement for this period; no plan mutation |

**Invariant 7:** `update_plan` is the only path that changes `monthlyPayment`. No automatic plan mutations.

---

## 5.4 Monthly Surplus Calculation

```
net_surplus = total_income_for_period - eligible_outflows
```

Eligible outflows: all transactions where `direction = 'debit'` within the period. Credits excluded.

---

## 5.5 Surplus Distribution

```
for each active surplus_split_rule:
    distribution = floor(net_surplus × split_percent × 100) / 100

remainder → emergency_fund slug
```

---

## 5.6 Financial Health Metrics

```
debt_ratio              = SUM(monthly_debt_payments) / monthly_income
emergency_coverage      = emergency_fund_balance / monthly_essentials_baseline
available_savings       = savings_balance - savings_floor
```

**Risk status:**

| Status | Condition |
|---|---|
| `ok` | net_surplus ≥ 0 AND debt_ratio ≤ 0.25 |
| `elevated` | debt_ratio 0.26–0.35 OR net_surplus < 0 |
| `risky` | debt_ratio > 0.35 OR emergency_coverage < 1 |

Higher severity wins when multiple conditions apply.

---

## 5.7 PDF Import Intelligence

Bank statement PDF → regex parser → (fallback) Claude AI parser.

**Quota:** free workspaces get 3 AI parses/month; paid workspaces unlimited. Regex parsing is always free. AI is only triggered when regex finds 0 rows.

---

# 6. Authentication

Custom JWT — email + password. No OAuth in current build.

| Route | Method | Notes |
|---|---|---|
| `/api/v1/auth/login` | POST | Returns `{ token, user }` |
| `/api/v1/auth/logout` | POST | Blacklists token |
| `/api/v1/auth/me` | GET | Returns authenticated user + workspace |
| `/api/v1/auth/signup` | POST | Creates user + workspace atomically |

Token blacklist checked on every authenticated request. Refresh is client-managed with token expiry.

---

# 7. API Surface

**Base URL:** `/api/v1`  
**Auth header:** `Authorization: Bearer <token>`  
**Money:** always returned as string decimal: `"1250.00"`

**Standard error envelope:**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable description" } }
```

| HTTP | code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod field failure |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Workspace membership required |
| 404 | `NOT_FOUND` | Resource doesn't exist or wrong workspace |
| 409 | `CONFLICT` | Duplicate |
| 422 | `BUSINESS_RULE` | e.g. allocation sum ≠ 1, editing derived field |

---

## 7.1 Household

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/household` | — | Full household object |
| PATCH | `/household` | `{ timezone?, periodStartDay?, activeMonth?, savingsFloor?, monthlyEssentialsBaseline? }` | Updated household |

---

## 7.2 Allocation Categories

| Method | Path | Notes |
|---|---|---|
| GET | `/household/allocation-categories` | Returns `{ items }` |
| PUT | `/household/allocation-categories` | Full replace of non-system categories; rejects if sum ≠ 1 |

---

## 7.3 Surplus Split Rules

| Method | Path | Notes |
|---|---|---|
| GET | `/household/surplus-splits` | Returns `{ items }` |
| PUT | `/household/surplus-splits` | Full replace; rejects if sum ≠ 1 |

---

## 7.4 Income

| Method | Path | Notes |
|---|---|---|
| GET | `/income?from=&to=` | `{ items, total }` |
| POST | `/income` | Creates entry + allocations atomically |
| PATCH | `/income/:id` | Deletes + recreates allocations on amount/date change |
| DELETE | `/income/:id` | 204 |

---

## 7.5 Transactions

| Method | Path | Notes |
|---|---|---|
| GET | `/transactions?from=&to=&categoryId=&direction=` | `{ items, nextCursor }` |
| POST | `/transactions` | Creates transaction; creates `debt_payments` row when `linkedDebtId` set |
| PATCH | `/transactions/:id` | Partial update |
| DELETE | `/transactions/:id` | Cascades linked debt_payment |

---

## 7.6 Debts

| Method | Path | Notes |
|---|---|---|
| GET | `/debts` | Returns `{ items, summary }` — each item includes `paymentPace`, `paymentInsight`, `paymentObligation`, `balanceTrajectory`, `balanceExplanation`, `insightAcknowledged` |
| POST | `/debts` | Creates debt |
| PATCH | `/debts/:id` | Editable fields; 422 on balance/currentBalance |
| DELETE | `/debts/:id` | 422 if payments exist |

---

## 7.7 Debt Payments

| Method | Path | Notes |
|---|---|---|
| GET | `/debts/:id/payments` | Payment history |
| POST | `/debts/:id/payments` | Direct payment entry (not linked to transaction) |

---

## 7.8 Debt Adjustments

| Method | Path | Notes |
|---|---|---|
| GET | `/debts/:id/adjustments` | `{ items }` — excludes generated rows by default |
| POST | `/debts/:id/adjustments` | `{ amount, adjustmentType, effectiveDate, note? }` |

---

## 7.9 Debt Pace Acknowledgement

| Method | Path | Request | Notes |
|---|---|---|---|
| POST | `/debts/:id/pace-acknowledgement` | `{ action, paymentPeriodMonth, newMonthlyPayment? }` | Records acknowledgement; `update_plan` sets `monthlyPayment` + audit log |

---

## 7.10 Financial Accounts

| Method | Path | Notes |
|---|---|---|
| GET | `/financial-accounts` | Lists workspace accounts |
| POST | `/financial-accounts` | Creates account |
| PATCH | `/financial-accounts/:id` | Updates name/type/institution |
| DELETE | `/financial-accounts/:id` | Soft delete or hard delete if no reconciliations |

---

## 7.11 Reconciliations

| Method | Path | Notes |
|---|---|---|
| GET | `/financial-accounts/:id/reconciliations` | `{ items }` |
| POST | `/financial-accounts/:id/reconciliations` | Opens reconciliation session |
| PATCH | `/financial-accounts/:id/reconciliations/:rid` | Updates reconciliation (mark rows, set closing balance) |

---

## 7.12 Import Pipeline

| Method | Path | Notes |
|---|---|---|
| POST | `/imports/upload` | Multipart `file` (CSV/XLSX/PDF) → `{ batchId, filename, rowCount }` |
| POST | `/imports/parse/:batchId` | `{ columnMap }` → `{ rows }` |
| PATCH | `/imports/rows/:rowId` | `{ categoryId?, debtId?, status? }` |
| POST | `/imports/approve/:batchId` | `{ inserted, skipped, duplicates }` |

---

## 7.13 Merchant Rules

GET / POST / PATCH / DELETE `/merchant-rules`. Higher `priority` wins on conflict.

---

## 7.14 Reports

All reports are read-only, computed from live rows, never cached.

| Path | Response |
|---|---|
| GET `/reports/dashboard?from=&to=` | `{ periods: [{ month, incomeTotal, spendingTotal, surplusOrDeficit, alertStatus }] }` |
| GET `/reports/financial-health` | `{ debtRatio, emergencyCoverageMonths, availableSavings, alertStatus, ... }` |
| GET `/reports/surplus-recommendations?month=` | `{ netSurplus, distributions, alertStatus }` |
| GET `/reports/trajectory?months=12` | `{ projections: [{ month, projectedIncome, projectedSurplus, debtBalances }] }` |

---

## 7.15 Monthly Reviews

| Method | Path | Notes |
|---|---|---|
| GET | `/monthly-reviews?from=&to=` | `{ items }` |
| POST | `/monthly-reviews` | `{ reviewMonth, notes? }` — system computes surplus + distributions |
| PATCH | `/monthly-reviews/:id` | `{ notes? }` |

---

## 7.16 Upcoming Expenses

GET / POST / PATCH / DELETE `/upcoming-expenses`.

---

## 7.17 Insights (Remi)

| Method | Path | Notes |
|---|---|---|
| POST | `/insights` | `{ prompt, context? }` → AI response with RAF data context |

Remi may explain calculations, surface patterns, answer questions using calculated RAF data, and propose actions. Remi never mutates financial records directly.

---

# 8. Edge Cases

| Scenario | Behavior |
|---|---|
| Concurrent PUT allocation-categories | Last-write-wins (transitional — adapter not yet optimistically locked) |
| Allocation sum drift | PUT rejects with 400 |
| Income edit after allocations exist | PATCH deletes + recreates allocations in one transaction |
| Debt deleted with payments | 422; use `isActive = false` |
| Transaction linked to non-existent debt | 404; transaction not created |
| Import row with unmatched merchant | Stored with `suggested_category_id = null` |
| Duplicate import row | `status = 'duplicate'`; skipped on approve unless manually overridden |
| Surplus split remainder | Remainder cents → `emergency_fund` slug |
| Allocation remainder | Remainder cents → `buffer` slug |
| Obligation window open before due date | Never surfaces as missed_payment or under_minimum |
| `above_plan` pace + `increasing` balance | Both signals shown; trajectory warning has visual precedence |
| `update_plan` without newMonthlyPayment | 422 |
| PDF import — AI fallback quota exceeded | 402 with quota explanation; regex result returned if any rows found |
| `period_start_day` 29–31 | 400 (supports Feb in all years) |

---

# 9. Security

**Authentication:** JWT checked on every authenticated route. Token blacklist prevents reuse after logout.

**Authorization:** workspace membership verified after authentication. `x-workspace-id` headers are never trusted from the client — the workspace context is derived from the authenticated user's membership.

**RLS (defense in depth):** PostgreSQL workspace-scoped RLS policies applied via `FORCE ROW LEVEL SECURITY`. RLS reads `current_setting('app.workspace_id')` set per transaction.

**Audit log:** all financial mutations write a `workspace_activity` row with `event_type`, `actor_id`, `entity_id`, and `snapshot`.

---

# 10. Integration Demo Scenario

A passing end-to-end sequence:

1. POST `/auth/signup` → user + workspace + seed categories created
2. PUT `/household/allocation-categories` with default percents
3. POST `/income` `{ sourceName: "Salary", amount: "10000.00", receivedDate: "2026-09-10" }` → allocations: Savings $1000, Fixed Bills $3000, etc.
4. POST `/transactions` `{ description: "CC Payment", amount: "200.00", direction: "debit", linkedDebtId: "<id>" }` → debt_payment row created; GET `/debts` returns `currentBalance = "4800.00"`
5. GET `/reports/financial-health` → `debtRatio = 0.02, alertStatus = "ok"`
6. GET `/debts` → each debt includes `paymentPace`, `paymentObligation`, `balanceTrajectory`
7. POST `/debts/:id/pace-acknowledgement` `{ action: "keep_plan", paymentPeriodMonth: "2026-09" }` → acknowledged
8. POST `/monthly-reviews` `{ reviewMonth: "2026-09-01" }` → surplus distributed

**Verified when:**
- Step 3 allocations sum exactly to $10,000.00
- Step 4 debt balance derives to $4,800.00 without any stored update
- Step 6 pace/obligation/trajectory are independent of each other
- Step 7 does not mutate `monthlyPayment` (keep_plan)
- Step 8 distributions sum to net surplus

---

# 11. Application File Structure

```
raf_app/
├── app/
│   └── api/v1/
│       ├── auth/             login, logout, me, signup
│       ├── debts/
│       │   └── [id]/
│       │       ├── adjustments/
│       │       ├── pace-acknowledgement/
│       │       └── payments/
│       ├── financial-accounts/
│       │   └── [accountId]/reconciliations/
│       ├── household/
│       │   ├── allocation-categories/
│       │   ├── email-preferences/
│       │   ├── subscription/
│       │   └── surplus-splits/
│       ├── imports/
│       ├── income/
│       ├── insights/
│       ├── merchant-rules/
│       ├── monthly-reviews/
│       ├── reports/
│       ├── transactions/
│       └── upcoming-expenses/
├── db/
│   └── migrations/           SQL migration files (RAF_MIGRATIONS array in scripts/migrate.js)
├── docs/
│   ├── DECISIONS/            Architecture decision records
│   ├── api/                  OpenAPI spec
│   ├── archive/              Stale docs (not authoritative)
│   ├── architecture/         Architecture notes, closure plans
│   ├── product/              Product constitution, limitations, quota docs
│   └── security/             RLS and tenant security notes
├── lib/
│   ├── accounts/             Financial accounts domain
│   ├── audit/                auditLog.js — logAuditEvent
│   ├── auth/                 JWT helpers, workspace context
│   ├── debts/                debts.js — route handlers (listDebts, createDebt, acknowledgeDebtPaymentPace, ...)
│   ├── imports/              Bank statement import pipeline, PDF/CSV/XLSX parsers
│   ├── raf/
│   │   ├── debts.js          Domain logic — classifyPaymentPace, derivePaymentObligation,
│   │   │                     deriveBalanceTrajectory, explainBalanceChange, buildDebtPaymentInsight,
│   │   │                     deriveDebtSnapshot, estimateDebtPayoff, compareDebtPriority
│   │   └── reporting.js      Allocation engine, surplus, health metrics, dashboard
│   ├── reports/              getCashFlowForecastReport, getFinancialHealthReport
│   ├── repositories/
│   │   └── postgres/         Direct SQL repositories (debtsRepository, importedTransactionsRepository, ...)
│   └── server/
│       ├── inMemoryDb.js     In-memory adapter (tests, local)
│       ├── postgresDb.js     Postgres compatibility adapter
│       ├── routerLoader.js   HTTP router
│       └── sqliteDb.js       SQLite adapter (local persistence)
├── scripts/
│   └── migrate.js            RAF_MIGRATIONS array; runs migrations against Postgres
├── specs/
│   └── raf_multi_income_debt_spec.md   ← this document
├── src/
│   ├── api/                  Client-side API wrappers (debtsApi.ts, etc.)
│   ├── components/
│   │   ├── debt/             PaymentPaceInsight.tsx
│   │   ├── feedback/         ErrorState, LoadingSpinner, SuccessNotice
│   │   ├── layout/           AppLayout, PageShell
│   │   └── ui/               Badge, Button, Card, Input, MoneyInput, ...
│   ├── hooks/                useAsyncData
│   ├── lib/
│   │   ├── format.ts         formatCurrency, formatIsoDate, percentPaidOff
│   │   ├── types.ts          Shared TypeScript interfaces (Debt, PaymentObligation, BalanceTrajectory, ...)
│   │   └── validation.ts     validateApr, validatePositiveMoney, ...
│   └── pages/                Debts.tsx, Insights.tsx, MonthlyReview.tsx, Profile.tsx, ...
└── tests/
    ├── debts.test.js
    ├── debtObligation.test.js
    ├── debtPaymentPace.test.js
    └── ...
```

All deterministic financial logic lives in `lib/raf/`. No financial calculations in route handlers or UI.

---

# 12. Current Limitations

See [`docs/product/LIMITATIONS.md`](../docs/product/LIMITATIONS.md) for the current maintained list. As of v9.0:

1. Debt balances are current-cumulative only — not period-aware for historical views.
2. Financial health report falls back to household active month; not fully parameterized.
3. Import uses statement transaction dates, not the currently viewed period.
4. Allocation history is read-only (cannot restore a prior snapshot as current config).

---

# 13. Non-Goals (MVP)

- Bank feed / Plaid integration
- Multi-household per user
- Mobile native apps
- Tax reporting
- Multi-currency within one household

---

# 14. Key Engineering Invariants

These must be preserved across all future changes:

1. **Three-dimensional debt intelligence:** payment obligation, payment pace, and balance trajectory are independent dimensions. Each has its own derivation, snapshot field, and UI signal. None drives another.
2. **Obligation aggregation:** obligation compliance aggregates all payments in the obligation window before judging. Never single-payment.
3. **Open-before-due guard:** an open obligation before its due date is never a negative signal. Partial funding reads as `in_progress`.
4. **Trajectory source:** balance trajectory is computed only from opening vs closing balance. Never from payment pace.
5. **above_plan + increasing precedence:** trajectory warning has visual precedence over the above-plan pace block.
6. **newActivity non-negative:** `newActivityCents = max(0, adjustments) + max(0, unexplained)`. Always ≥ 0.
7. **No automatic plan mutation:** `update_plan` is the only path that changes `monthlyPayment`. No automatic mutations by the engine.
8. **AI never source of truth:** Remi and AI parsing explain and assist. All financial records are written by deterministic RAF domain logic.
9. **Workspace isolation:** every query is scoped to a single workspace. Cross-workspace joins are forbidden at every layer.
10. **Financial logic placement:** no financial calculations in route handlers or UI components. All domain logic in `lib/`.
