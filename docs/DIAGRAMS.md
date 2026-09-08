# RAF Architecture Diagrams

## 1. System Architecture - High Level

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React/Vite)                     │
│  ┌─────────────────┬──────────────┬──────────┬──────────┐       │
│  │   Dashboard     │ Monthly Rev  │ Imports  │  Goals   │       │
│  │   Allocations   │  Reporting   │ Debts    │ Remi AI  │       │
│  └────────┬────────┴──────┬───────┴────┬─────┴────┬─────┘       │
└───────────┼───────────────┼────────────┼──────────┼──────────────┘
            │               │            │          │
           API Client (TypeScript)       │          │
            │               │            │          │
┌───────────▼───────────────▼────────────▼──────────▼──────────────┐
│                      API Routes (Express)                        │
│  /api/v1/transactions  /api/v1/income  /api/v1/reports  ... │
└───────────┬────────────────────────────┬──────────────────────────┘
            │                            │
┌───────────▼──────────────────────────┐ │
│  JWT/Supabase Auth + Authorization   │ │
│  Workspace Context + RLS             │ │
└───────────┬──────────────────────────┘ │
            │                            │
            └────────────┬───────────────┘
                         │
┌────────────────────────▼──────────────────────────────────────────┐
│  Application Layer (Services)                                     │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
│  │ Transaction  │ Income       │ Allocation   │ Reporting    │   │
│  │ Service      │ Service      │ Service      │ Service      │   │
│  └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘   │
└─────────┼──────────────┼──────────────┼──────────────┼────────────┘
          │              │              │              │
┌─────────▼──────────────▼──────────────▼──────────────▼────────────┐
│  Domain Layer (Financial Truth)                                   │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
│  │ Balance      │ Allocation   │ Trajectory   │ Debt         │   │
│  │ Calculations │ Calculations │ Engine       │ Strategies   │   │
│  │              │              │              │              │   │
│  │ Shared       │ Validators   │ Rules        │ Constraints  │   │
│  └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘   │
└─────────┼──────────────┼──────────────┼──────────────┼────────────┘
          │              │              │              │
┌─────────▼──────────────▼──────────────▼──────────────▼────────────┐
│  Persistence Layer (Repositories)                                 │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
│  │ Transaction  │ Income       │ Debt         │ Goal         │   │
│  │ Repository   │ Repository   │ Repository   │ Repository   │   │
│  └──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘   │
└─────────┼──────────────┼──────────────┼──────────────┼────────────┘
          │              │              │              │
┌─────────▼──────────────▼──────────────▼──────────────▼────────────┐
│           Database (Postgres with RLS Policies)                   │
│  ┌─────────────────┬──────────────────────────────────────────┐  │
│  │ Transactions    │ Income Entries     │ Debts  │ Goals    │  │
│  │ Categories      │ Allocations        │ Bills  │ Reviews  │  │
│  │ Workspaces      │ Collaborators      │        │ Audit    │  │
│  └─────────────────┴──────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘

Cross-Cutting:
┌─────────────────────────────────────────────────────────────────┐
│ Platform (Auth, Logging, Email, Validation, AI, Search)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Module Dependency Map

```
Direction: Lower layers depend on nothing above; higher layers depend on lower.

┌──────────────────────┐
│  API Routes          │
│  (Express handlers)  │
└──────┬───────────────┘
       │ depends on
┌──────▼────────────────────┐
│  Application Services     │  [TransactionService, IncomeService, ...]
└──────┬───────────────────┘
       │ depends on
┌──────▼────────────────────┐
│  Domain Layer             │  [Calculations, Validators, Engines]
│                           │
│  ┌──────────────────────┐ │
│  │ Balance Calculations │ │
│  │ (SINGLE SOURCE)      │ │
│  └──────────────────────┘ │
│                           │
│  ┌──────────────────────┐ │
│  │ Allocation Calcs     │ │
│  │ (SINGLE SOURCE)      │ │
│  └──────────────────────┘ │
│                           │
│  ┌──────────────────────┐ │
│  │ Trajectory Engine    │ │
│  │ (SINGLE SOURCE)      │ │
│  └──────────────────────┘ │
└──────┬───────────────────┘
       │ depends on
┌──────▼────────────────────┐
│  Persistence Repositories │  [TransactionRepository, ...]
└──────┬───────────────────┘
       │ depends on
┌──────▼────────────────────┐
│  Database Layer           │  [PostgreSQL with RLS]
└──────────────────────────┘

Platform (Orthogonal - all layers use):
┌──────────────────────────────────────────────┐
│ Auth, Logging, Validation, Email, AI, Error │
└──────────────────────────────────────────────┘
```

---

## 3. Financial Calculation Data Flow

```
Income Received
    ↓
[Income Entry created]
    ↓
Allocation Rules Applied
    ↓
lib/domain/allocation/calculations.js ◄── SINGLE SOURCE OF TRUTH
    ↓
Budget Buckets Populated
    ↓
lib/domain/balance/calculations.js ◄── SINGLE SOURCE OF TRUTH
    ↓
Monthly Balance Report
    ↓
Used by:
├── Dashboard (via API)
├── Monthly Review
├── Remi Context Builders (aggregated only)
└── Forecast Engine (lib/domain/trajectory)
    ↓
All based on same calculation logic
```

---

## 4. Multi-Tenant Isolation - Request Flow

```
User makes request
    ↓
┌─────────────────────────────────┐
│ Authentication                  │
│ - Verify JWT token              │
│ - Extract user_id               │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ Workspace Resolution            │
│ - Get x-workspace-id from header │
│ - Verify user is member         │
│ - Load workspace context        │
│ - Verify permissions            │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ Query Scope                     │
│ - Add household_id filter       │
│ - Scope to user's workspace     │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ Database RLS Check (Postgres)   │
│ - RLS policy verifies access    │
│ - Double-checks workspace scope │
│ - Enforces at DB layer          │
└─────────────────────────────────┘
    ↓
Response returned (only this user's workspace data)
```

---

## 5. RLS (Row-Level Security) Architecture

```
Without RLS (Current):
┌──────────────┐      
│ App Layer    │ ← Only line of defense
│ Filter by WS │      
└──────┬───────┘      
       ↓              
┌──────▼──────────────────┐
│ Database                │
│ Returns raw rows        │ ← If app is compromised, all data leaked
│ No enforcement          │
└─────────────────────────┘

With RLS (Recommended for Postgres):
┌──────────────┐      
│ App Layer    │ ← First line of defense
│ Filter by WS │      
└──────┬───────┘      
       ↓              
┌──────▼──────────────────┐
│ Database RLS Policy     │
│ ↓ Verify user access    │ ← Second line of defense
│ ↓ Check workspace       │ ← Enforced at DB level
│ Returns only allowed    │    (cryptographic guarantee)
│ rows                    │
└────────────────────────┘

SQL Example:
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_isolation ON transactions
  FOR ALL USING (
    household_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );
```

---

## 6. AI Data Minimization Flow

```
OLD (Risk):
User Data → [Full transaction list] → [All debts] → [All income]
                    ↓
            Claude API (Remi)
            - Knows merchant names
            - Sees transaction amounts
            - Full financial picture

NEW (Safe):
User Data
    ↓
┌─────────────────────────────────┐
│ Context Builders (Explicit)     │
│                                 │
│ buildAllocationContext()        │
│ ↓ Returns: categories, %        │
│                                 │
│ buildSpendingContext()          │
│ ↓ Returns: total, by category   │
│           (NOT transaction list)│
│                                 │
│ buildDebtContext()              │
│ ↓ Returns: total debt, APR      │
│           (NOT balance by debt) │
│                                 │
│ buildGoalContext()              │
│ ↓ Returns: goal names, %        │
│           complete              │
│                                 │
└─────────────────────────────────┘
    ↓
    Claude API (Remi) ← Never sees:
    - Merchant names
    - Transaction amounts
    - Personal details
    - Account numbers
    
    Only sees:
    - Aggregates
    - Category names
    - Percentages
    - Goal names
```

---

## 7. Deletion Flow - Account Deletion

```
User clicks "Delete Account"
    ↓
┌────────────────────────────┐
│ Verification              │
│ - Confirm password        │
│ - Confirm 2x intention    │
└────────────────────────────┘
    ↓
    Soft Delete (Day 0)
    ├─ Mark user.deleted_at = now()
    ├─ Mark workspaces.deleted_at = now()
    ├─ User account locked
    └─ All data retained (recovery possible)
    ↓
    (30-day grace period)
    ↓
    Hard Delete (Day 30)
    ├─ Delete user record
    ├─ Cascade delete workspaces
    ├─ Delete all financial data
    ├─ Anonymize in audit logs
    └─ Irreversible

│ Audit Trail │
└─ Log "account_deleted" event
   (but not amounts, merchants, etc.)
```

---

## 8. Monthly Review Flow

```
User initiates monthly review
    ↓
┌────────────────────────────────────┐
│ Fetch Current Month's Data         │
│ Via Domain Layer                   │
├─ getMonthlyIncome()                │
├─ getMonthlySpending()              │
├─ getMonthlyAllocation()            │
├─ getMonthlyDebtPayments()          │
└─ getMonthlyGoalProgress()          │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Calculate Surplus/Deficit          │
│ lib/domain/balance/calculations.js │
│ (SINGLE SOURCE)                    │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Validate Against Rules             │
│ lib/domain/allocation/validators   │
├─ Allocation % still = 100%?        │
├─ Savings floor maintained?         │
└─ Debt strategy on track?           │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Calculate Surplus Distribution      │
│ lib/domain/surplus/distribution.js │
│ (SINGLE SOURCE)                    │
└────────────────────────────────────┘
    ↓
┌────────────────────────────────────┐
│ Present to User                    │
│ - Review current month             │
│ - Suggest surplus allocation       │
│ - Ask for adjustments              │
└────────────────────────────────────┘
    ↓
User approves/modifies
    ↓
┌────────────────────────────────────┐
│ Apply Monthly Review               │
│ app/monthly/reviewService.js       │
│ Orchestrates:                      │
├─ Update allocation if user changed │
├─ Apply surplus distribution        │
├─ Update goal progress              │
├─ Persist monthly_reviews record    │
└─ Create audit log                  │
└────────────────────────────────────┘
```

---

## 9. Remi (AI) Architecture

```
Remi Request Flow:

User asks question
    ↓
┌─────────────────────────────────────┐
│ Remi receives request               │
│ lib/remi/remiAssistant.js           │
└────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Build Minimal Context               │
│ lib/platform/ai/contextBuilders.js  │
│                                     │
│ Explicit builders:                  │
│ - buildAllocationContext()          │
│ - buildSpendingContext()            │
│ - buildDebtContext()                │
│ - buildGoalContext()                │
│ - buildObligationContext()          │
│                                     │
│ Each returns aggregated summary     │
│ NOT raw data                        │
└────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Send to Claude                      │
│ + Remi system prompt (guardrails)   │
│ + Financial context (aggregated)    │
│ + Tool definitions                  │
└────────────────────────────────────┘
    ↓
Claude decides to use tool
    ↓
┌─────────────────────────────────────┐
│ Tool Handler                        │
│ lib/platform/ai/toolHandlers.js     │
│                                     │
│ Example: handleGetCurrentPlan()     │
│ - Calls domain layer                │
│ - Returns aggregated data           │
│ - Never exposes details             │
└────────────────────────────────────┘
    ↓
Response to Claude
    ↓
Claude formulates answer for user
    ↓
User sees safe, factual response
(AI never saw merchant names, amounts, etc.)
```

---

## 10. Database Schema - Tenant Isolation

```
workspace_members table (junction):
┌────────────────────────────────────┐
│ workspace_members                  │
├─ id (PK)                           │
├─ workspace_id (FK)  ◄── Workspaces │
├─ user_id (FK)       ◄── Users      │
├─ role (enum)        ◄── owner/editor/viewer
├─ status (enum)      ◄── active/invited/removed
└─ created_at                        │
└────────────────────────────────────┘

RLS Policy:
User can see workspace X's data
  IF user_id IN (
    SELECT user_id FROM workspace_members 
    WHERE workspace_id = X AND status = 'active'
  )

Applied to all tables:
transactions, income_entries, debts, goals, 
allocation_categories, surplus_split_rules, etc.

Result:
- Even if app bugs exist, DB enforces isolation
- No data leakage across workspaces possible
- Cryptographically guaranteed by PostgreSQL
```

---

## 11. Security Layers - Defense in Depth

```
Attack Vector: "Access another user's data"

Layer 1: Workspace ID Validation (Express middleware)
    ↓ If header missing or invalid, return 400
    
Layer 2: JWT Authentication (routerLoader.js)
    ↓ If token invalid/expired, return 401
    
Layer 3: Workspace Membership Check (buildWorkspaceContext)
    ↓ If user not member of workspace, return 403
    
Layer 4: Permission Check (roleHasPermission)
    ↓ If role lacks permission, return 403
    
Layer 5: Query Scope (Repository layer)
    ↓ Add WHERE household_id = X to all queries
    
Layer 6: RLS Policy (PostgreSQL)
    ↓ Database enforces row-level access control
    
Result: User's data cannot be accessed, even if layers 1-5 fail
```

---

## 12. Calculation Consolidation - Before & After

```
BEFORE (Scattered logic):

Dashboard needs balance
    → Calls getDashboardAggregateReport()
    → getDashboardReport() calculates balance
    
Monthly Review needs balance  
    → Calls monthlyReviews.js
    → Has its own balance calculation logic
    
Remi needs balance summary
    → Calls toolHandlers.js
    → Has its own aggregation logic
    
Forecast needs balance
    → Calls trajectory/engine.js
    → Has its own calculation

RISK: Bug in one calculation not fixed everywhere
RISK: Balance calculations inconsistent
RISK: Different answers from same data


AFTER (Centralized):

All paths → lib/domain/balance/calculations.js

Dashboard
    ↓
getDashboardReport() ← Uses domain calculation
    ↓
Returns correct balance

Monthly Review
    ↓
monthlyReviews.js ← Uses domain calculation
    ↓
Returns correct balance

Remi
    ↓
toolHandlers.js ← Uses domain aggregation (not raw balance)
    ↓
Returns aggregate (safe for AI)

Forecast
    ↓
trajectory/engine.js ← Uses domain calculation
    ↓
Returns correct projection

BENEFIT: One implementation, all users consistent
BENEFIT: Bug fix propagates everywhere automatically
BENEFIT: Less code, easier to test
```

