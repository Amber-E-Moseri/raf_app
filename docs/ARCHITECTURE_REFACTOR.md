# RAF Modular Monolith Refactoring Plan

**Objective:** Reshape RAF into a clean, layered modular monolith while preserving all user-visible behavior and financial semantics.

---

## Core Principle

**Do not rewrite working functionality.** Migrate existing code into new structure incrementally.

---

## Proposed Architecture

### Layer Structure

```
┌─────────────────────────────────────────────────────┐
│  API Routes (HTTP Request Handlers)                 │
│  app/api/v1/[domain]/[resource]/route.js           │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│  Application Layer (Orchestration)                  │
│  lib/app/[domain]/service.js                       │
│  - Coordinates domain services                      │
│  - Handles transactions, validations               │
│  - Returns dtos (not raw db objects)               │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│  Domain Layer (Financial Logic - SOURCE OF TRUTH)  │
│  lib/domain/[concern]/[entity].js                  │
│  - Deterministic calculations (balance, alloc)     │
│  - Business rules (constraints, validations)       │
│  - Pure functions where possible                   │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│  Persistence Layer (Data Access)                   │
│  lib/persistence/[entity]Repository.js             │
│  - Query builders, filters, aggregations           │
│  - No business logic                               │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│  Database (Postgres + RLS)                         │
│  - Schema enforcement                              │
│  - Constraints                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Cross-Cutting Concerns                             │
│  lib/platform/auth, logging, validation, email     │
└─────────────────────────────────────────────────────┘
```

### Module Organization

```
lib/
├── domain/                          # FINANCIAL TRUTH
│   ├── allocation/
│   │   ├── categories.js           # Category definitions, constraints
│   │   ├── calculations.js         # Allocation calculations (SINGLE SOURCE)
│   │   └── validators.js           # Validation rules
│   │
│   ├── balance/
│   │   ├── calculations.js         # Balance calculation (SINGLE SOURCE)
│   │   └── snapshots.js            # Balance snapshots for reporting
│   │
│   ├── trajectory/
│   │   ├── projections.js          # Forecast engine (SINGLE SOURCE)
│   │   └── scenarios.js            # Scenario planning
│   │
│   ├── debt/
│   │   ├── paymentStrategy.js      # Debt payoff calculations
│   │   └── projections.js          # Debt projections
│   │
│   ├── income/
│   │   ├── allocations.js          # Income allocation logic
│   │   └── forecasting.js          # Income forecasting
│   │
│   ├── transaction/
│   │   ├── categorization.js       # Auto-categorization rules
│   │   └── validators.js           # Transaction validation
│   │
│   ├── surplus/
│   │   └── distribution.js         # Surplus allocation rules
│   │
│   ├── goals/
│   │   ├── tracking.js             # Goal progress calculations
│   │   └── reservations.js         # Budget reserved for goals
│   │
│   ├── reports/
│   │   ├── dashboard.js            # Dashboard aggregations
│   │   ├── monthlyReview.js        # Monthly review logic
│   │   └── forecasts.js            # Forecast reports
│   │
│   └── shared/
│       ├── calculations.js         # Shared math utilities
│       ├── constraints.js          # Business rule definitions
│       └── types.js               # Domain types
│
├── app/                             # APPLICATION ORCHESTRATION
│   ├── allocation/
│   │   └── service.js             # Coordinate allocation domain logic
│   │
│   ├── income/
│   │   └── service.js             # Coordinate income operations
│   │
│   ├── transactions/
│   │   ├── service.js             # Transaction orchestration
│   │   └── importService.js       # Import workflow orchestration
│   │
│   ├── monthly/
│   │   └── reviewService.js       # Monthly review orchestration
│   │
│   ├── reporting/
│   │   └── service.js             # Report generation
│   │
│   └── workspace/
│       └── service.js             # Workspace/account operations
│
├── persistence/                     # DATA ACCESS
│   ├── repositories/
│   │   ├── transactionRepository.js
│   │   ├── incomeRepository.js
│   │   ├── debtRepository.js
│   │   ├── goalRepository.js
│   │   ├── allocationRepository.js
│   │   └── workspaceRepository.js
│   │
│   ├── migrations/
│   │   └── index.js               # Migration runner
│   │
│   └── postgres/ or sqlite/
│       └── driver.js              # Database driver
│
├── platform/                        # CROSS-CUTTING CONCERNS
│   ├── auth/
│   │   ├── jwt.js
│   │   ├── supabase.js
│   │   ├── passwords.js
│   │   └── sessions.js
│   │
│   ├── logging/
│   │   ├── structured.js          # JSON logging
│   │   ├── audit.js               # Audit log writer
│   │   └── sanitizer.js           # Data sanitization
│   │
│   ├── validation/
│   │   ├── schemas.js             # Zod schemas
│   │   └── middleware.js          # Validation middleware
│   │
│   ├── errors/
│   │   ├── AppError.js            # Error base class
│   │   └── handlers.js            # Error handling
│   │
│   ├── email/
│   │   ├── sender.js              # Email service
│   │   └── templates.js           # Email templates
│   │
│   ├── search/
│   │   └── index.js               # Full-text search
│   │
│   └── ai/                         # REMI
│       ├── contextBuilders.js     # Minimal context builders
│       ├── tools.js               # Tool definitions
│       └── handlers.js            # Tool handlers
│
├── server/
│   ├── express.js                 # Express app setup
│   ├── router.js                  # Router loader
│   ├── middleware.js              # Middleware stack
│   └── scheduler.js               # Background jobs
│
└── legacy/                          # DURING MIGRATION ONLY
    └── [existing code temporarily]
```

---

## Migration Strategy

### Phase 1: Establish Domain Layer (Week 1-2)
1. Create `lib/domain/shared/` with types and utilities
2. Migrate balance calculations to `lib/domain/balance/calculations.js`
3. Migrate allocation calculations to `lib/domain/allocation/calculations.js`
4. **Add regression tests** - balance and allocation calculations must match existing behavior exactly
5. Update trajectory engine to use domain calculations

**Files to Create:**
- `lib/domain/shared/calculations.js` - parseMoneyToCents, formatCents, etc.
- `lib/domain/shared/constraints.js` - Business rule definitions
- `lib/domain/balance/calculations.js` - Balance logic (consolidate from dashboard, reports)
- `lib/domain/allocation/calculations.js` - Allocation logic (consolidate)
- `tests/regression/balance.test.js` - Ensure zero behavior changes
- `tests/regression/allocation.test.js`

**Success Criteria:**
- All tests pass with identical output to current code
- No UI/API behavior changes

### Phase 2: Create Application Layer (Week 3)
1. Create orchestration services for each domain
2. Services coordinate domain logic + persistence
3. Services return DTOs (not raw DB objects)
4. Update API routes to use services

**Example - TransactionService:**
```javascript
// lib/app/transactions/service.js
export async function createTransaction({ db, householdId, input }) {
  // 1. Validate input using domain validators
  await transactionValidator.validate(input);
  
  // 2. Call domain logic
  const allocation = await allocationCalculations.calculateForCategory(
    { db, householdId, categoryId: input.categoryId }
  );
  
  // 3. Persist using repository
  const transaction = await transactionRepository.create({
    db, householdId, data: input
  });
  
  // 4. Return DTO
  return {
    id: transaction.id,
    date: transaction.transaction_date,
    amount: formatCents(transaction.amount),
    category: allocation.category_slug,
  };
}
```

### Phase 3: Consolidate Calculations (Week 4)
1. Remove duplicate calculations from React components
2. Remove duplicate calculations from existing lib files
3. Components call API (which uses domain layer)
4. Reports use domain layer directly

**Files to Remove/Consolidate:**
- Dashboard-specific balance calculations
- Monthly review balance recalculations
- Separate trajectory implementations
- Remi's context-building aggregations

### Phase 4: Establish Persistence Layer (Week 5)
1. Create repository interfaces
2. Migrate database access from raw queries
3. Add query builders for filtering
4. Type safety for repository methods

**Example - AllocationRepository:**
```javascript
export async function getActiveAllocations({ db, householdId }) {
  return db.query(
    'SELECT * FROM allocation_categories WHERE household_id = $1 AND is_active = true ORDER BY sort_order',
    [householdId]
  );
}
```

### Phase 5: Cleanup & Document (Week 6)
1. Delete legacy code
2. Add JSDoc comments
3. Create architecture decision records (ADRs)
4. Update team documentation

---

## Financial Calculation Consolidation

### Current State: 3-4 Implementations of Same Logic

**Balance Calculation Duplication:**
1. Dashboard: `useAsyncData` → `getDashboardAggregateReport`
2. Monthly Review: `monthlyReviews.js` recalculates
3. Remi: `toolHandlers.js` summarizes
4. Reports API: `getDashboardReport` calculates

**Action Plan:**
```
OLD:
├── src/pages/Dashboard.tsx (logic)
├── lib/monthlyReviews/monthlyReviews.js (logic)
├── lib/remi/toolHandlers.js (logic)
└── lib/reports/getDashboardReport.js (logic)

NEW:
├── lib/domain/balance/calculations.js (SOURCE OF TRUTH)
└── Everyone imports from here
```

**Migration Example:**
```javascript
// BEFORE: Dashboard had its own balance calculation
// src/pages/Dashboard.tsx
const bucketBalances = data.dashboard.bucket_balances;

// AFTER: Dashboard calls domain, domain returns same format
import { calculateBucketBalances } from '../../../lib/domain/balance/calculations.js';
const bucketBalances = await calculateBucketBalances({ db, householdId });
```

### Allocation Calculations
Same pattern: consolidate to `lib/domain/allocation/calculations.js`

**Test to Add:**
```javascript
// tests/regression/allocation.test.js
test('allocation sum enforcement matches pre-refactor behavior', async () => {
  // Old: calculateAllocationPercent() in household.js
  // New: calculateAllocationPercent() in domain/allocation/calculations.js
  // Both must return identical results
  const oldResult = oldCalculate(...);
  const newResult = newCalculate(...);
  assert.equal(oldResult, newResult);
});
```

---

## Data Minimization for Remi

### Current Risk
`buildFinancialContext` sends full transaction history and all debts to Claude.

### Proposed Fix

**1. Create Explicit Context Builders**
```javascript
// lib/platform/ai/contextBuilders.js

export async function buildAllocationContext({ db, householdId }) {
  // Returns ONLY what Remi needs to discuss allocations
  // NOT full transaction list
  const categories = await db.query('SELECT * FROM allocation_categories ...');
  return {
    categories: categories.map(c => ({
      slug: c.slug,
      label: c.label,
      percent: c.allocation_percent,
    })),
    totalAllocated: calculateTotalAllocated(categories),
  };
}

export async function buildSpendingContext({ db, householdId }) {
  // Returns SUMMARY, not transaction list
  const spending = await calculateMonthlySpending({ db, householdId });
  return {
    totalThisMonth: spending.total,
    byCategory: spending.byCategory,
    topMerchants: spending.topMerchants.slice(0, 5),
  };
}
```

**2. Tools Are Explicit**
```javascript
// lib/platform/ai/tools.js
export const REMI_TOOLS = [
  {
    name: 'get_allocation_plan',
    description: 'Get allocation categories and percentages',
    // Does NOT include transaction history
  },
  {
    name: 'get_spending_summary',
    description: 'Get monthly spending summary by category',
    // Returns aggregates, not individual transactions
  },
];
```

**3. Never Send:**
- Individual transaction descriptions ("therapist", "retirement account")
- Merchant names (can infer personal details)
- Personal notes on transactions
- Full debt balances (summary okay)
- Email addresses or payment methods

---

## Tenant Security Model

### RLS Policies to Implement

```sql
-- Add RLS to all financial tables
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_categories ENABLE ROW LEVEL SECURITY;
-- ... etc for all tables

-- Core policy: User can only access workspaces they're a member of
CREATE POLICY workspace_isolation ON transactions
  FOR ALL USING (
    household_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Apply same to all tables
-- This ensures even if app code is compromised, DB enforces isolation
```

**Test:**
```javascript
// tests/security/rls.test.js
test('RLS prevents direct DB query from leaking cross-tenant data', async () => {
  // Connect as workspace_a user
  // Query should only return workspace_a data
  // Even if malicious SQL is used
});
```

---

## Audit Logging

### Audit Log Table
```sql
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL, -- 'transaction_created', 'debt_updated', etc.
  entity_type text NOT NULL, -- 'transaction', 'debt', 'goal'
  entity_id uuid NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  details jsonb -- Mutation context WITHOUT sensitive values
);
```

### What NOT to Log
- ❌ Transaction amounts
- ❌ Merchant names
- ❌ Debt balances
- ❌ Passwords, tokens

### What TO Log
```javascript
// ✅ Good
{
  action: 'transaction_created',
  entity_type: 'transaction',
  entity_id: '...',
  details: {
    category_id: '...',
    direction: 'debit',
    source: 'import'
  }
}

// ❌ Bad
{
  action: 'transaction_created',
  amount: '1500.00',
  merchant: 'therapist',
  category: 'healthcare'
}
```

---

## Data Deletion Workflows

### Account Deletion
```
User initiates → Confirm password → Soft delete (30 days) → Hard delete

Hard delete:
1. Delete user
2. Delete all workspaces owned by user
3. For each workspace: delete all financial data
4. Anonymize in audit logs
```

### Workspace Deletion
```
Workspace owner initiates → Warn if members exist → Soft delete → Hard delete

Hard delete:
1. Delete all transactions
2. Delete all income entries
3. Delete all debts, goals
4. Delete allocation categories
5. Delete workspace
```

### Data Export
```
GET /api/v1/workspaces/:id/export

Returns JSON:
{
  transactions: [...],
  income: [...],
  debts: [...],
  goals: [...],
  allocation_categories: [...],
  monthly_reviews: [...]
}
```

---

## Files to Create/Refactor

### Create (Week 1-6)
```
lib/domain/allocation/
  ├── categories.js
  ├── calculations.js
  └── validators.js

lib/domain/balance/
  ├── calculations.js
  └── snapshots.js

lib/domain/trajectory/
  ├── projections.js
  └── scenarios.js

lib/app/
  ├── transactions/service.js
  ├── income/service.js
  ├── allocation/service.js
  ├── monthly/reviewService.js
  └── reporting/service.js

lib/persistence/repositories/
  ├── transactionRepository.js
  ├── incomeRepository.js
  ├── debtRepository.js
  └── (others)

lib/platform/
  ├── ai/contextBuilders.js
  ├── ai/tools.js
  ├── logging/audit.js
  └── logging/sanitizer.js

tests/
  ├── regression/balance.test.js
  ├── regression/allocation.test.js
  ├── security/rls.test.js
  └── integration/deletion.test.js
```

### Refactor (During Migration)
- `lib/monthlyReviews/` - Use domain layer
- `lib/trajectory/` - Use domain layer
- `lib/reports/` - Use domain layer
- `src/pages/Dashboard.tsx` - Use domain layer via API
- `lib/remi/` - Use context builders

### Delete (Week 6)
- Duplicate calculation files
- Legacy helpers that moved to domain
- Old test files for moved code

---

## Success Metrics

✓ All regression tests pass (balance, allocation calculations identical)  
✓ All IDOR tests pass (no cross-tenant access)  
✓ All RLS tests pass (database enforces isolation)  
✓ Build size unchanged (modular monolith, same code, better organized)  
✓ Test coverage >= 80% on domain layer  
✓ Zero user-visible behavior changes  
✓ Financial calculations have single source of truth  

---

## Timeline

| Week | Focus | Deliverables |
|------|-------|--------------|
| 1-2 | Domain layer | Balance, allocation, trajectory domain services + tests |
| 3 | App layer | Orchestration services + API integration |
| 4 | Consolidation | Remove duplicates, verify tests |
| 5 | Persistence | Repository layer + cleanup |
| 6 | Polish | Documentation, final tests, review |

---

## Risk Mitigation

**Risk:** Regression tests fail  
**Mitigation:** Run old and new calculations in parallel; log discrepancies

**Risk:** Performance regression  
**Mitigation:** Benchmark before/after; profile database queries

**Risk:** Incomplete migration  
**Mitigation:** Feature flag old/new code; gradual rollout

---

## Not Included in This Phase

- Microservices (stay monolithic)
- Event bus (no evidenced need)
- Message queues (use cron for now)
- Cache layer (profile first)
- GraphQL (stick with REST)

These can be added later if evidence shows need.

