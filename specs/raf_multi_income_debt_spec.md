# RAF Implementation Contract v8.0
**Document Type:** Full Engineering Implementation Contract  
**Status:** Authoritative Build Reference  
**Currency:** CAD · **Timezone default:** America/Toronto

This document is the single source of truth for building the RAF platform. It consolidates all prior versions, resolves every open question, and restores every section that was lost across drafts.

---

# 1. Product Framing

RAF (Revenue Allocation Framework) is a **deposit-driven financial system** for individuals with variable income, multiple income streams, or irregular pay cycles.

Traditional budgeting assumes fixed monthly income. RAF instead allocates **each deposit immediately** according to a predefined percentage formula — ensuring every dollar is instantly assigned to obligations, savings, debt payoff, investments, or discretionary spending the moment it arrives.

The system provides:

- Allocation engine — splits every deposit deterministically
- Spending ledger — tracks actuals against budgeted buckets
- Debt tracker — derives live balances from payment history
- Surplus router — distributes month-end excess by configured rules
- Financial health analyzer — computes key ratios and risk status
- Bank import pipeline — ingests CSV/XLSX statements

**Core user guarantee:** users always know where money came from, where it went, what is protected, what is flexible, and what action to take next.

---

# 2. System Architecture

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript strict |
| Backend | Supabase (Edge Functions + RLS) |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth — Google OAuth |
| Validation | Zod on every write path |
| Hosting | Vercel |
| Error tracking | Sentry |
| Logging | Structured JSON (Pino-compatible); no secrets in logs |

**Financial write pipeline (enforced order):**

```
Client → Zod Validation → RLS Authorization → DB Transaction → RAF Engine → Write → Response
```

All financial mutations must occur inside database transactions. Reports are always computed from live DB rows — no cached derived values in MVP.

**Multi-tenancy:** each user owns one household. All financial entities are scoped by `household_id`. Cross-household queries are forbidden at the RLS layer.

**Money precision:** `Decimal(12,2)` throughout. API always returns money as string decimals (e.g. `"1250.00"`).

---

# 3. Database Schema

All domain tables contain `household_id`, `created_at`, `updated_at` unless noted.

---

## profiles

```sql
id                  uuid        PK default gen_random_uuid()
email               text        NOT NULL UNIQUE
full_name           text
currency            text        NOT NULL DEFAULT 'CAD'
theme_preference    text
onboarding_status   text        NOT NULL DEFAULT 'NOT_STARTED'
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()
```

`onboarding_status` valid values: `NOT_STARTED`, `HOUSEHOLD_CREATED`, `ALLOCATIONS_CONFIGURED`, `BASELINE_SET`, `ONBOARDING_COMPLETE`

---

## households

```sql
id                          uuid        PK
owner_user_id               uuid        NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE
name                        text
timezone                    text        NOT NULL DEFAULT 'America/Toronto'
active_month                date        NOT NULL  -- anchor date; always day=1 e.g. 2026-03-01
period_start_day            int         NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 28)
savings_floor               numeric(12,2) NOT NULL DEFAULT 0
monthly_essentials_baseline numeric(12,2) NOT NULL DEFAULT 0
created_at                  timestamptz NOT NULL DEFAULT now()
updated_at                  timestamptz NOT NULL DEFAULT now()
```

**Fiscal period derivation:**
Given `active_month = 2026-03-01` and `period_start_day = 5`, the active fiscal period is `Mar 5 → Apr 4`. Reports accept either calendar-month or fiscal-period mode.

---

## allocation_categories

```sql
id                  uuid        PK
household_id        uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE
slug                text        NOT NULL  -- immutable system identifier
label               text        NOT NULL  -- user-editable display name
sort_order          int         NOT NULL DEFAULT 0
allocation_percent  numeric(6,4) NOT NULL  -- stored as fraction: 0.1000 = 10%
is_system           boolean     NOT NULL DEFAULT false
is_active           boolean     NOT NULL DEFAULT true
created_at          timestamptz NOT NULL DEFAULT now()
updated_at          timestamptz NOT NULL DEFAULT now()

UNIQUE (household_id, slug)
```

**Constraint:** `SUM(allocation_percent) WHERE is_active = true` must equal `1.0000 ± 0.0001`. Enforced on every write.

**`is_system`:** system categories (`savings`, `fixed_bills`, `personal_spending`, `buffer`) cannot be deleted. Labels may be renamed; slugs are immutable.

**`is_active`:** inactive categories are excluded from future allocations but retained in historical records.

---

## surplus_split_rules

```sql
id            uuid        PK
household_id  uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE
slug          text        NOT NULL
label         text        NOT NULL
split_percent numeric(6,4) NOT NULL
sort_order    int         NOT NULL DEFAULT 0
is_active     boolean     NOT NULL DEFAULT true
created_at    timestamptz NOT NULL DEFAULT now()
updated_at    timestamptz NOT NULL DEFAULT now()

UNIQUE (household_id, slug)
```

**Constraint:** `SUM(split_percent) WHERE is_active = true` must equal `1.0000 ± 0.0001`.

---

## income_entries

```sql
id            uuid        PK
household_id  uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE
source_name   text        NOT NULL
amount        numeric(12,2) NOT NULL CHECK (amount > 0)
received_date date        NOT NULL
notes         text
idempotency_key text      UNIQUE  -- optional; prevents duplicate deposits
created_at    timestamptz NOT NULL DEFAULT now()
updated_at    timestamptz NOT NULL DEFAULT now()
```

INDEX: `(household_id, received_date)`

---

## income_allocations

```sql
id                      uuid        PK
income_entry_id         uuid        NOT NULL REFERENCES income_entries(id) ON DELETE CASCADE
household_id            uuid        NOT NULL
allocation_category_id  uuid        NOT NULL REFERENCES allocation_categories(id)
allocated_amount        numeric(12,2) NOT NULL
allocation_percent      numeric(6,4) NOT NULL  -- snapshot of percent at time of deposit
created_at              timestamptz NOT NULL DEFAULT now()
```

Allocations are immutable after creation. Editing an income entry deletes and recreates its allocations inside a transaction.

---

## transactions

```sql
id                uuid        PK
household_id      uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE
transaction_date  date        NOT NULL
description       text        NOT NULL
merchant          text
amount            numeric(12,2) NOT NULL CHECK (amount != 0)
direction         text        NOT NULL CHECK (direction IN ('debit','credit'))
category_id       uuid        REFERENCES allocation_categories(id)
linked_debt_id    uuid        REFERENCES debts(id)
source            text        NOT NULL DEFAULT 'manual'  -- 'manual' | 'import'
import_batch_id   uuid        REFERENCES import_batches(id)
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()
```

INDEX: `(household_id, transaction_date)`

**`direction`:** `debit` = money out; `credit` = money in (transfers, refunds). Credits are excluded from surplus outflow calculations.

**Debt linkage:** when `linked_debt_id` is set, a `debt_payments` row must be created in the same transaction (enforced at the application layer).

---

## debts

```sql
id                uuid        PK
household_id      uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE
name              text        NOT NULL
starting_balance  numeric(12,2) NOT NULL CHECK (starting_balance > 0)
apr               numeric(5,2) NOT NULL DEFAULT 0
minimum_payment   numeric(12,2) NOT NULL DEFAULT 0  -- floor; used for debt ratio
monthly_payment   numeric(12,2) NOT NULL DEFAULT 0  -- planned actual payment; used for trajectory
sort_order        int         NOT NULL DEFAULT 0
is_active         boolean     NOT NULL DEFAULT true
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()
```

INDEX: `(household_id, is_active)`

**Delete rule:** DELETE is blocked if any `debt_payments` rows exist for this debt. Update `is_active = false` instead.

---

## debt_payments

```sql
id              uuid        PK
household_id    uuid        NOT NULL
debt_id         uuid        NOT NULL REFERENCES debts(id)  -- no cascade; blocked above
transaction_id  uuid        REFERENCES transactions(id) ON DELETE SET NULL
payment_date    date        NOT NULL
amount          numeric(12,2) NOT NULL CHECK (amount > 0)
created_at      timestamptz NOT NULL DEFAULT now()
```

INDEX: `(debt_id)`, `(household_id, payment_date)`

---

## import_batches

```sql
id            uuid        PK
household_id  uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE
filename      text        NOT NULL
status        text        NOT NULL DEFAULT 'uploaded'  -- uploaded | parsing | review | approved | failed
row_count     int
created_at    timestamptz NOT NULL DEFAULT now()
updated_at    timestamptz NOT NULL DEFAULT now()
```

---

## imported_transaction_rows

```sql
id                    uuid        PK
batch_id              uuid        NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE
household_id          uuid        NOT NULL
raw_date              text
raw_description       text
raw_merchant          text
raw_amount            text
parsed_date           date
parsed_description    text
parsed_merchant       text
parsed_amount         numeric(12,2)
parsed_direction      text
suggested_category_id uuid        REFERENCES allocation_categories(id)
suggested_debt_id     uuid        REFERENCES debts(id)
status                text        NOT NULL DEFAULT 'pending'  -- pending | approved | duplicate | skipped
duplicate_of_id       uuid        REFERENCES transactions(id)
created_at            timestamptz NOT NULL DEFAULT now()
```

INDEX: `(batch_id, status)`

---

## merchant_rules

```sql
id            uuid        PK
household_id  uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE
match_type    text        NOT NULL CHECK (match_type IN ('exact','contains','starts_with','regex'))
match_value   text        NOT NULL
category_id   uuid        REFERENCES allocation_categories(id)
priority      int         NOT NULL DEFAULT 0  -- higher wins on conflict
created_at    timestamptz NOT NULL DEFAULT now()
updated_at    timestamptz NOT NULL DEFAULT now()
```

---

## monthly_reviews

```sql
id                uuid        PK
household_id      uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE
review_month      date        NOT NULL  -- always day=1; e.g. 2026-03-01
net_surplus       numeric(12,2) NOT NULL
split_applied     jsonb       NOT NULL  -- snapshot of split percents applied
distributions     jsonb       NOT NULL  -- { emergency_fund: "300.00", debt_payoff: "200.00", ... }
alert_status      text        NOT NULL  -- ok | elevated | risky
notes             text
created_at        timestamptz NOT NULL DEFAULT now()
updated_at        timestamptz NOT NULL DEFAULT now()

UNIQUE (household_id, review_month)
```

---

# 4. Seed Data

Seeded automatically on household creation.

## Default Allocation Categories

| slug | label | allocation_percent | is_system |
|---|---|---|---|
| savings | Savings | 0.1000 | true |
| tithe | Tithe | 0.1000 | false |
| partnership | Partnership | 0.0500 | false |
| offerings | Offerings | 0.0500 | false |
| fixed_bills | Fixed Bills | 0.3000 | true |
| personal_spending | Personal Spending | 0.1500 | true |
| investment | Investment | 0.1000 | false |
| debt_payoff | Debt Payoff | 0.1000 | false |
| buffer | Buffer | 0.0500 | true |

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

## 5.1 RAF Allocation Engine

```
computeDepositAllocations(amount, activeCategories)
```

Algorithm:

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

Remainder handling: rounding always directs surplus cents to the `buffer` category. The sum of all allocations must equal the deposit amount exactly.

---

## 5.2 Debt Balance Derivation

Balances are **never stored** — always derived:

```sql
current_balance = debts.starting_balance - COALESCE(SUM(debt_payments.amount), 0)
```

Balances cannot be manually edited. Any attempt to PATCH a balance field returns `422`.

**Derived status:**

| Status | Condition |
|---|---|
| `current` | current_balance > 0 |
| `paid_off` | current_balance ≤ 0 |

---

## 5.3 Monthly Surplus Calculation

```
net_surplus = total_income_for_period - eligible_outflows
```

Eligible outflows: all transactions where `direction = 'debit'` within the period.  
**Excluded:** transactions where `direction = 'credit'` (transfers, refunds).

---

## 5.4 Surplus Distribution

Applied during monthly review:

```
for each active surplus_split_rule:
    distribution = floor(net_surplus × split_percent × 100) / 100

remainder → emergency_fund slug
```

---

## 5.5 Financial Health Metrics

```
debt_ratio              = SUM(monthly_debt_payments) / monthly_income
emergency_coverage      = emergency_fund_balance / monthly_essentials_baseline
available_savings       = savings_balance - savings_floor
```

---

## 5.6 Financial Risk Status

| Status | Condition |
|---|---|
| `ok` | net_surplus ≥ 0 AND debt_ratio ≤ 0.25 |
| `elevated` | debt_ratio 0.26–0.35 OR net_surplus < 0 |
| `risky` | debt_ratio > 0.35 OR emergency_coverage < 1 |

When multiple conditions apply, the higher-severity status wins.

---

## 5.7 Trajectory Engine

```
for each future month:
    estimate_income = avg(last 3 months income)
    apply allocation % → bucket projections
    subtract spending averages (last 3 months actuals by category)
    apply surplus split rules
    update projected balances
```

Outputs: debt payoff timeline per debt (using `monthly_payment`), emergency fund completion date, net balance projection by month.

---

# 6. Onboarding State Machine

Tracked in `profiles.onboarding_status`.

| State | Trigger to advance |
|---|---|
| `NOT_STARTED` | user account created |
| `HOUSEHOLD_CREATED` | household row inserted |
| `ALLOCATIONS_CONFIGURED` | PUT allocation-categories succeeds with sum = 1 |
| `BASELINE_SET` | PATCH household sets `savings_floor` and `monthly_essentials_baseline` |
| `ONBOARDING_COMPLETE` | user confirms setup or first income entry posted |

Users may skip `BASELINE_SET` via explicit `{ skip: true }` PATCH — status advances to `ONBOARDING_COMPLETE` with zero baseline values.

---

# 7. API Surface

**Base URL:** `/api/v1`  
**Auth header:** `Authorization: Bearer <supabase-access-token>`  
**Pagination:** all list endpoints support `?cursor=&limit=50` (default 50)  
**Money:** always returned as string decimal: `"1250.00"`

**Standard error envelope:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description"
  }
}
```

**Error codes:**

| HTTP | code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod field failure |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 404 | `NOT_FOUND` | Resource doesn't exist or wrong household |
| 409 | `CONFLICT` | Duplicate (email, idempotency key) |
| 422 | `BUSINESS_RULE` | e.g. allocation sum ≠ 1, editing derived field |

---

## 7.1 Auth

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/auth/me` | JWT | — | `{ userId, email, householdId, onboardingStatus }` | 401 |

Auth (sign-in, sign-up, token refresh) is handled entirely by Supabase Auth client SDK. No custom auth routes needed.

---

## 7.2 Household

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/household` | JWT | — | Full household object | 404 |
| PATCH | `/household` | JWT | `{ timezone?, periodStartDay?, activeMonth?, savingsFloor?, monthlyEssentialsBaseline?, skip? }` | Updated household | 400 if day outside 1–28; 422 on invalid skip state |

---

## 7.3 Allocation Categories

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/household/allocation-categories` | JWT | — | `{ items: [{ id, slug, label, sortOrder, allocationPercent, isSystem, isActive }] }` | — |
| PUT | `/household/allocation-categories` | JWT | `{ items: [{ slug, label, sortOrder, allocationPercent, isActive }] }` — full replace of non-system categories | `{ items }` | 400 sum ≠ 1; 422 attempt to delete system slug |

Concurrency: last-write-wins. PUT is wrapped in a transaction (delete non-system + insert).

---

## 7.4 Surplus Split Rules

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/household/surplus-splits` | JWT | — | `{ items: [{ id, slug, label, splitPercent, sortOrder, isActive }] }` | — |
| PUT | `/household/surplus-splits` | JWT | `{ items: [{ slug, label, splitPercent, sortOrder, isActive }] }` full replace | `{ items }` | 400 sum ≠ 1 |

---

## 7.5 Income Entries

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/income?from=&to=` | JWT | date range query | `{ items: [...], total }` | 400 invalid date |
| POST | `/income` | JWT | `{ sourceName, amount, receivedDate, notes? }` + optional `Idempotency-Key` header | `{ incomeId, allocations: [{ category, slug, amount }] }` | 400; 409 duplicate idempotency key |
| PATCH | `/income/:id` | JWT | `{ sourceName?, amount?, receivedDate?, notes? }` | Updated entry + recalculated allocations | 404 |
| DELETE | `/income/:id` | JWT | — | 204 | 404 |

**Idempotency:** if `Idempotency-Key` header is present and a matching key+body exists, returns the original created record (no duplicate insert).

PATCH on `amount` or `receivedDate` deletes and recreates `income_allocations` inside a transaction.

---

## 7.6 Transactions

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/transactions?from=&to=&categoryId=&direction=&cursor=&limit=` | JWT | — | `{ items: [...], nextCursor }` | 400 |
| POST | `/transactions` | JWT | `{ transactionDate, description, merchant?, amount, direction, categoryId?, linkedDebtId? }` | Created transaction (+ debt_payment row if linkedDebtId set) | 400; 404 if debt not found |
| PATCH | `/transactions/:id` | JWT | Partial (any field except derived) | Updated | 404 |
| DELETE | `/transactions/:id` | JWT | — | 204; cascades linked debt_payment | 404 |

---

## 7.7 Debts

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/debts` | JWT | — | `{ items: [{ id, name, startingBalance, currentBalance, apr, minimumPayment, monthlyPayment, status, sortOrder }], summary: { totalStarting, totalRemaining, totalPaidAllTime } }` | — |
| POST | `/debts` | JWT | `{ name, startingBalance, apr, minimumPayment, monthlyPayment, sortOrder? }` | Created debt | 400 |
| PATCH | `/debts/:id` | JWT | `{ name?, apr?, minimumPayment?, monthlyPayment?, sortOrder?, isActive? }` | Updated | 404; 422 attempt to set balance directly |
| DELETE | `/debts/:id` | JWT | — | 204 | 404; 422 if payments exist (use isActive=false instead) |

`currentBalance` is always derived on read — never stored.

---

## 7.8 Import Pipeline

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| POST | `/imports/upload` | JWT | multipart `file` (CSV or XLSX) | `{ batchId, filename, rowCount }` | 400 unsupported format |
| POST | `/imports/parse/:batchId` | JWT | `{ columnMap: { date, description, merchant?, amount, direction? } }` | `{ batchId, rows: [{ id, parsedDate, parsedDescription, parsedMerchant, parsedAmount, parsedDirection, suggestedCategoryId, status }] }` | 404; 422 parse failure |
| PATCH | `/imports/rows/:rowId` | JWT | `{ categoryId?, debtId?, status? }` | Updated row | 404 |
| POST | `/imports/approve/:batchId` | JWT | — | `{ inserted, skipped, duplicates }` | 404; 422 if batch not in review status |

**Column mapping** (`columnMap`) maps the uploaded file's header names to RAF fields. Required fields: `date`, `description`, `amount`. Optional: `merchant`, `direction`. If `direction` is absent, all rows default to `debit`.

**Duplicate detection:** a row is flagged as a potential duplicate when an existing transaction matches on `parsed_amount + parsed_date + normalized_merchant` (after applying merchant_rules normalization). Flagged rows have `status = 'duplicate'` and are skipped on approve unless user manually sets `status = 'approved'`.

---

## 7.9 Merchant Rules

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/merchant-rules` | JWT | — | `{ items: [...] }` | — |
| POST | `/merchant-rules` | JWT | `{ matchType, matchValue, categoryId, priority? }` | Created rule | 400 |
| PATCH | `/merchant-rules/:id` | JWT | Partial | Updated | 404 |
| DELETE | `/merchant-rules/:id` | JWT | — | 204 | 404 |

**Conflict resolution:** when multiple rules match the same merchant, the rule with the highest `priority` wins. Ties broken by `created_at` descending.

---

## 7.10 Reports

All report endpoints are read-only, computed from live DB rows, never cached in MVP.

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/reports/income-allocations?incomeId=` | JWT | `{ sourceName, amount, receivedDate, allocations: [{ slug, label, amount }] }` |
| GET | `/reports/dashboard?from=&to=` | JWT | `{ periods: [{ month, incomeTotal, spendingTotal, surplusOrDeficit, savingsActual, alertStatus }] }` |
| GET | `/reports/financial-health` | JWT | `{ activeMonthIncome, monthlyDebtPayments, debtRatio, savingsBalance, savingsFloor, availableSavings, emergencyFundBalance, monthlyEssentials, emergencyCoverageMonths, alertStatus }` |
| GET | `/reports/surplus-recommendations?month=` | JWT | `{ netSurplus, distributions: [{ slug, label, amount }], targetDebtName?, alertStatus }` |
| GET | `/reports/trajectory?months=12` | JWT | `{ projections: [{ month, projectedIncome, projectedSurplus, debtBalances: [{ debtId, projectedBalance }], emergencyFundBalance }] }` |

---

## 7.11 Monthly Reviews

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/monthly-reviews?from=&to=` | JWT | — | `{ items: [...] }` | — |
| POST | `/monthly-reviews` | JWT | `{ reviewMonth, notes? }` — system computes surplus + distributions | Created review with computed fields | 400; 409 review for that month already exists |
| PATCH | `/monthly-reviews/:id` | JWT | `{ notes? }` | Updated | 404 |

---

# 8. Edge Cases and Concurrency

| Scenario | Behavior |
|---|---|
| Concurrent PUT allocation-categories | Last-write-wins; no optimistic lock in MVP |
| Allocation sum drift | PUT rejects with 400; GET never returns invalid sum |
| Income edit after allocations exist | PATCH deletes + recreates allocations in one transaction |
| Debt deleted with payments | Blocked with 422; use `isActive = false` |
| Transaction linked to non-existent debt | 404 returned; transaction not created |
| Import row with unmatched merchant | Stored with `suggested_category_id = null`; requires manual categorization before approve |
| Duplicate import row | `status = 'duplicate'`; skipped on approve unless manually overridden |
| Surplus split remainder | Remainder cents always go to `emergency_fund` slug |
| Allocation remainder | Remainder cents always go to `buffer` slug |
| Missing merchant on duplicate check | Match on `amount + date` only (merchant treated as empty string) |
| Negative amounts | Rejected on all write paths except `direction = 'credit'` transactions |
| `period_start_day` 29–31 | Rejected with 400 (supports Feb in all years) |

---

# 9. Security

Supabase Row Level Security applied to all household tables:

```sql
household.owner_user_id = auth.uid()
```

Additional rules:
- `income_allocations` readable only via parent `income_entry` ownership
- `debt_payments` readable only via parent `debt` ownership
- `imported_transaction_rows` readable only via parent `import_batch` ownership

No cross-household joins permitted at any layer.

---

# 10. Integration Demo Scenario

A passing end-to-end test sequence:

1. User signs in with Google → profile created with `onboarding_status = NOT_STARTED`
2. Household created → status → `HOUSEHOLD_CREATED`; seed categories + surplus rules inserted
3. PUT allocation-categories with default percents → status → `ALLOCATIONS_CONFIGURED`
4. PATCH household `savingsFloor = 500`, `monthlyEssentialsBaseline = 2000` → status → `BASELINE_SET`
5. User confirms → status → `ONBOARDING_COMPLETE`
6. POST income `{ sourceName: "Salary", amount: "10000.00", receivedDate: "2026-03-10" }` → allocations created: Savings $1000, Tithe $1000, Partnership $500, Offerings $500, Fixed Bills $3000, Personal $1500, Investment $1000, Debt Payoff $1000, Buffer $500
7. POST transaction `{ description: "Rogers Bill", amount: "120.00", direction: "debit", categoryId: fixed_bills_id }`
8. POST debt `{ name: "Credit Card", startingBalance: "5000.00", apr: 19, minimumPayment: "100.00", monthlyPayment: "200.00" }`
9. POST transaction `{ description: "CC Payment", amount: "200.00", direction: "debit", categoryId: debt_payoff_id, linkedDebtId: credit_card_id }` → debt_payment row created; GET /debts returns `currentBalance = "4800.00"`
10. GET /reports/financial-health → `debtRatio = 200/10000 = 0.02`, `alertStatus = "ok"`
11. POST /monthly-reviews `{ reviewMonth: "2026-03-01" }` → surplus distributed per split rules

**System verified when:**
- Step 6 allocations sum exactly to $10,000.00
- Step 9 debt balance derives to $4,800.00 without any manual update
- Step 10 health metrics reflect live transaction data
- Step 11 review distributions sum to net surplus

---

# 11. Application File Structure

```
raf-app/
├── app/
│   ├── (marketing)/          # landing, pricing
│   ├── (auth)/               # sign-in, onboarding
│   ├── (app)/                # dashboard, income, transactions,
│   │                         # imports, debts, health, trajectory, reports, settings
│   └── api/v1/               # route handlers
├── components/
├── lib/
│   ├── raf/                  # allocation engine, surplus engine, health metrics, trajectory
│   ├── imports/              # CSV/XLSX parser, column mapper, duplicate detector
│   ├── merchant-rules/       # rule matcher
│   └── utils/
├── hooks/
├── types/
└── supabase/
    └── migrations/
```

All deterministic financial logic lives in `lib/raf/`. No financial calculations in route handlers or components.

---

# 12. Build Order

1. Supabase schema + seed migrations
2. Auth (Supabase OAuth) + onboarding state machine
3. Household settings API
4. Allocation categories + surplus splits API
5. RAF allocation engine (`lib/raf/`)
6. Income entries API
7. Transactions API + debt payment linkage
8. Debt tracker API
9. Reports: dashboard, financial health, surplus recommendations
10. Import pipeline (upload → parse → column map → review → approve)
11. Merchant rules engine
12. Monthly reviews
13. Trajectory engine
14. Billing (post-MVP)

---

# 13. Non-Goals (MVP)

- Bank feed / Plaid integration
- Multi-household per user
- Excel / PDF export
- Mobile native apps
- Collaborative household editing
- Tax reporting
- Multi-currency within one household

---

# 14. Definition of Done

- [ ] All migrations run cleanly; seed script produces correct default categories
- [ ] All §7 routes implemented with Zod validation + Supabase RLS
- [ ] PUT allocation-categories and surplus-splits reject when sum ≠ 1.0000 ± 0.0001
- [ ] Allocation engine: deposit $10,000 with default percents produces exact $10,000 sum with remainder to buffer
- [ ] Debt balance derives correctly from payments; direct edit returns 422
- [ ] DELETE debt with payments returns 422
- [ ] Import pipeline handles column mapping and flags duplicates correctly
- [ ] Dashboard totals match manual calculation for demo scenario (§10)
- [ ] Financial health endpoint returns correct ratios for seeded data
- [ ] Monthly review distributes surplus by split rules with remainder to emergency_fund
- [ ] Structured logging on all 4xx/5xx; no secrets in logs
- [ ] README: env vars, migration commands, demo account credentials, seed script usage
