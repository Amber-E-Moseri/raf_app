# RAF: Recommended Next 10 Engineering Priorities

**Timeframe:** 6-8 weeks (assuming 1-2 engineers, full-time focus)  
**Outcome:** Production-ready, secure, maintainable system

---

## Priority 1: Implement PostgreSQL RLS Policies
**Timeline:** Week 1-2 (3-4 days)  
**Owner:** Backend Security Lead  
**Blocks:** Production deployment  
**Effort:** 3-4 days

### Why First
Multi-tenant data isolation cannot rely on application layer alone. RLS is cryptographic guarantee that database enforces isolation even if app is compromised.

### Scope
```sql
-- Enable RLS on all financial tables:
- transactions
- income_entries  
- debts
- goals
- allocation_categories
- surplus_split_rules
- monthly_reviews
- financial_accounts
- import batches
- ... (all user-scoped data)

-- Create workspace_isolation policy:
CREATE POLICY FOR ALL USING (
  household_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND status = 'active'
  )
);
```

### Validation
- [ ] Write `tests/security/rls.test.js` - Verify cross-tenant queries blocked
- [ ] Benchmark impact on query performance
- [ ] Document RLS policies in README

### Acceptance Criteria
- RLS enabled on 100% of user-scoped tables
- All RLS tests pass (cross-tenant isolation verified)
- No performance regression (< 5% latency increase)
- Documented in ops guide

---

## Priority 2: Add Rate Limiting
**Timeline:** Week 1-2 (2-3 days)  
**Owner:** Backend Infra  
**Blocks:** Production deployment  
**Effort:** 2-3 days

### Why Now
Brute force protection is table stakes before launch. Every production API needs rate limits.

### Scope
```javascript
// Authentication endpoints (strict)
POST /auth/login - 5 attempts / 15 min per IP
POST /auth/forgot-password - 3 requests / hour per email  
POST /auth/signup - 3 signups / hour per email
POST /auth/verify-email - 5 attempts / hour per email

// File upload (moderate)
POST /imports/upload - 10 uploads / day per user

// General API (moderate)  
/api/v1/* - 100 requests / min per user
```

### Implementation
```javascript
// Use express-rate-limit + redis
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({
  store: new RedisStore({ client: redis }),
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: req.rateLimit.resetTime,
    });
  },
});

app.post('/auth/login', authLimiter, handler);
```

### Validation
- [ ] Test rate limiting on auth endpoints
- [ ] Test graceful 429 response
- [ ] Verify Retry-After header present
- [ ] Load test with simulated traffic

### Acceptance Criteria
- All auth endpoints rate limited
- 429 responses include Retry-After header
- Configuration documented
- No false positives on legitimate users

---

## Priority 3: Data Minimization for Remi
**Timeline:** Week 2-3 (3-4 days)  
**Owner:** AI/Backend  
**Blocks:** Production launch with Remi  
**Effort:** 3-4 days

### Why Now
Remi needs guardrails before production. Never send raw financial details to external API.

### Scope
Replace `buildFinancialContext()` with explicit builders:

```javascript
// lib/platform/ai/contextBuilders.js

export async function buildAllocationContext({ db, householdId }) {
  // Returns ONLY aggregated allocation info
  const categories = await db.query(...);
  return {
    categories: categories.map(c => ({ slug: c.slug, label: c.label, percent: c.allocation_percent })),
    totalAllocated: sum(categories.map(c => c.allocation_percent)),
  };
  // Never returns: transaction details, merchant names, spending amounts
}

export async function buildSpendingContext({ db, householdId }) {
  // Returns SUMMARY only
  const spending = await calculateMonthlySpending(db, householdId);
  return {
    totalSpent: spending.total,
    byCategory: spending.byCategory.map(c => ({ category: c.name, total: c.total })),
    topMerchants: ['Grocery', 'Gas', 'Coffee'] // Generic, not real names
  };
  // Never returns: individual transactions, amounts, merchant details
}

export async function buildDebtContext({ db, householdId }) {
  const debts = await db.query(...);
  return {
    totalDebt: debts.reduce((sum, d) => sum + d.balance, 0),
    averageAPR: debts.reduce((sum, d) => sum + d.apr, 0) / debts.length,
    debtCount: debts.length,
  };
  // Never returns: individual debt balances, minimum payments, creditor names
}

// Similar for goals, obligations, etc.
```

### Validation
- [ ] Write `tests/unit/contextBuilders.test.js` - Verify no PII leaked
- [ ] Review with privacy officer
- [ ] Document what Remi sees in privacy policy

### Acceptance Criteria
- buildFinancialContext() no longer used
- All Remi context from explicit builders
- Privacy review passed
- Tests verify no PII in Remi context

---

## Priority 4: Fix IDOR (ID-Based Access Control)
**Timeline:** Week 3-4 (3-4 days)  
**Owner:** Security Audit  
**Blocks:** Security cert (if needed)  
**Effort:** 3-4 days

### Why Now
IDOR is a common vulnerability. Every endpoint with [id] parameter needs verification.

### Scope
Audit and fix all routes:
```
GET  /api/v1/debts/:id
GET  /api/v1/goals/:id  
GET  /api/v1/transactions/:id
PATCH /api/v1/debts/:id
PATCH /api/v1/goals/:id
DELETE /api/v1/*/:id
... (all ID-based endpoints)
```

### Implementation
```javascript
// Before (unsafe):
export async function GET(request, { db, householdId, params }) {
  const debt = await db.query('SELECT * FROM debts WHERE id = $1', [params.id]);
  return json(debt);
}

// After (safe):
export async function GET(request, { db, householdId, params }) {
  const debt = await db.query(
    'SELECT * FROM debts WHERE id = $1 AND household_id = $2',
    [params.id, householdId]
  );
  if (!debt) return json({ error: 'Not found' }, 404); // Return 404, not 403
  return json(debt);
}
```

### Validation
- [ ] Write `tests/security/idor.test.js` - Try accessing cross-tenant resources
- [ ] Automated IDOR detection tool (Burp, ZAP)
- [ ] Manual penetration test

### Acceptance Criteria
- All ID-based endpoints verified
- IDOR test suite created
- Cross-tenant access blocked
- Security audit passed

---

## Priority 5: Implement Account Deletion Workflow
**Timeline:** Week 3-4 (2-3 days)  
**Owner:** Backend  
**Blocks:** GDPR compliance, production launch  
**Effort:** 2-3 days

### Why Now
Users have right to delete their data. GDPR requirement.

### Scope
1. Create `/api/v1/auth/delete-account` endpoint
2. Create `/api/v1/workspaces/:id/delete` endpoint
3. Implement 30-day grace period (soft delete → hard delete)
4. Create audit trail

### Implementation
```javascript
// POST /api/v1/auth/delete-account
// Requires: password, confirmation flag

export async function POST(request, { db, userId, householdId }) {
  const body = await request.json();
  
  // 1. Verify password
  const user = await db.getUserWithPassword(userId);
  if (!await verifyPassword(body.password, user.password_hash)) {
    return json({ error: 'Invalid password' }, 401);
  }
  
  // 2. Soft delete user
  await db.transaction(async (tx) => {
    await tx.updateUser({ id: userId, deleted_at: new Date() });
    const workspaces = await tx.getUserWorkspaces({ userId });
    for (const ws of workspaces) {
      await tx.updateWorkspace({ id: ws.id, deleted_at: new Date() });
    }
    await tx.createAuditLog({
      workspace_id: householdId,
      user_id: userId,
      action: 'account_deleted',
      details: { scheduled_hard_delete: addDays(new Date(), 30) },
    });
  });
  
  return json({ status: 'deletion_scheduled', grace_period_days: 30 });
}

// Hard delete (run daily via cron):
async function hardDeleteExpiredAccounts() {
  const threshold = subDays(new Date(), 30);
  const expiredUsers = await db.query(
    'SELECT * FROM users WHERE deleted_at < $1',
    [threshold]
  );
  for (const user of expiredUsers) {
    await db.transaction(async (tx) => {
      await tx.deleteUserAndWorkspaces(user.id);
      await tx.anonymizeAuditLogs(user.id);
    });
  }
}
```

### Validation
- [ ] Write `tests/integration/deletion.test.js` - Verify soft/hard delete
- [ ] Verify cascading deletes work correctly
- [ ] Verify audit logs anonymized

### Acceptance Criteria
- Account deletion endpoint works
- 30-day grace period enforced
- Cascading deletes correct
- Audit trail preserved
- GDPR compliance verified

---

## Priority 6: Consolidate Financial Calculations (Phase 1)
**Timeline:** Week 4-5 (4-5 days)  
**Owner:** Backend Architecture  
**Blocks:** Maintainability, future features  
**Effort:** 4-5 days

### Why Now
Calculation duplication makes bugs hard to fix and tests unreliable. Consolidate BEFORE adding features.

### Scope
Create domain layer for calculations:

```
lib/domain/
├── balance/
│   ├── calculations.js (SINGLE SOURCE - balance logic)
│   └── tests/ (regression tests)
├── allocation/
│   ├── calculations.js (SINGLE SOURCE - allocation logic)
│   └── tests/
└── ...
```

### Phase 1: Extract and Test
1. Identify all balance calculation code (dashboard, reports, reviews)
2. Create `lib/domain/balance/calculations.js` with extracted logic
3. Add regression tests - verify output matches existing code
4. Replace callers with new domain function
5. Delete old code

### Implementation
```javascript
// lib/domain/balance/calculations.js

export async function calculateBucketBalances({ db, householdId, month }) {
  // SINGLE SOURCE OF TRUTH
  // Used by: Dashboard, Reports, Monthly Review, Remi
  
  const allocations = await db.query('SELECT * FROM allocation_categories ...');
  const transactions = await db.query('SELECT * FROM transactions ...');
  
  const balances = {};
  for (const alloc of allocations) {
    const spent = transactions
      .filter(t => t.category_id === alloc.id)
      .reduce((sum, t) => sum + t.amount, 0);
    balances[alloc.id] = {
      allocated: alloc.allocated_amount,
      spent: Math.abs(spent),
      remaining: alloc.allocated_amount + spent, // spent is negative
    };
  }
  return balances;
}
```

### Validation
- [ ] Regression tests pass (output identical to old code)
- [ ] All callers updated
- [ ] Old code deleted
- [ ] Performance unchanged

### Acceptance Criteria
- Balance calculation consolidated
- All tests pass (zero behavior change)
- Old code removed
- Single source of truth established

---

## Priority 7: Fix Error Message Leakage
**Timeline:** Week 4 (1-2 days)  
**Owner:** Backend  
**Blocks:** Security best practices  
**Effort:** 1-2 days

### Why Now
Detailed errors leak system design to attackers.

### Scope
1. Audit all error messages in API responses
2. Create error code system
3. Log details server-side only
4. Return generic messages to client

### Implementation
```javascript
// Before (leaks details):
{ "error": "Active allocation percentages must sum to 1.0000 ± 0.0001 for household XYZ (found 0.9999)" }

// After (generic):
{ "error": "Request failed. Please contact support.", "errorCode": "ERR_VALIDATION_001" }

// Server log:
{ 
  level: "error",
  errorCode: "ERR_VALIDATION_001",
  context: "allocation_validation",
  details: "allocation_sum_mismatch (expected 1.0000, got 0.9999)",
  workspace_id: "...",
}
```

### Validation
- [ ] Audit all error messages
- [ ] Create error code registry
- [ ] Update error handlers
- [ ] Verify logs contain details

### Acceptance Criteria
- No detailed errors in client responses
- Error codes standardized
- Details in server logs only
- Documentation updated

---

## Priority 8: Add Workspace Deletion Workflow
**Timeline:** Week 5 (2-3 days)  
**Owner:** Backend  
**Blocks:** User autonomy feature  
**Effort:** 2-3 days

### Why Now
Users should control their workspace lifecycle (after account deletion priority).

### Scope
Create `/api/v1/workspaces/:id/delete` endpoint:
- Only workspace owner can delete
- Warn if other members exist
- Soft delete (30 days) → hard delete
- Cascade delete all data

### Implementation
Similar to account deletion but for workspace.

### Validation
- [ ] Test workspace deletion
- [ ] Verify warning for multi-user workspaces
- [ ] Verify cascading deletes

### Acceptance Criteria
- Workspace deletion endpoint works
- Data deletion cascade correct
- 30-day grace period enforced

---

## Priority 9: Add Data Export Endpoint
**Timeline:** Week 5 (2-3 days)  
**Owner:** Backend  
**Blocks:** User autonomy feature  
**Effort:** 2-3 days

### Why Now
Users should be able to export their financial data (complements account deletion).

### Scope
Create `/api/v1/workspaces/:id/export` endpoint:
- Return all financial data as JSON
- Support CSV format (optional Phase 2)
- Include: transactions, income, debts, goals, reviews

### Implementation
```javascript
export async function GET(request, { db, householdId }) {
  const [transactions, income, debts, goals, reviews] = await db.transaction(async (tx) => [
    await tx.listTransactions({ householdId }),
    await tx.listIncomeEntries({ householdId }),
    await tx.listDebts({ householdId }),
    await tx.listGoals({ householdId }),
    await tx.listMonthlyReviews({ householdId }),
  ]);
  
  return json({
    exportedAt: new Date().toISOString(),
    transactions,
    income,
    debts,
    goals,
    monthly_reviews: reviews,
  });
}
```

### Validation
- [ ] Test export completeness
- [ ] Verify data accuracy
- [ ] Test with large workspaces (performance)

### Acceptance Criteria
- Export endpoint works
- All financial data included
- Data accuracy verified
- Performance acceptable (< 5s for typical workspace)

---

## Priority 10: Set Up Automated Security Testing
**Timeline:** Week 6 (3-4 days)  
**Owner:** QA/Security  
**Blocks:** Continuous security verification  
**Effort:** 3-4 days

### Why Now
Security regressions creep in without automated checks. Build testing into CI.

### Scope
1. IDOR test suite
2. RLS test suite
3. Authentication/authorization tests
4. Data minimization tests (no PII in logs/errors)
5. Input validation tests

### Implementation
```javascript
// tests/security/suite.test.js

describe('Security Baseline', () => {
  describe('IDOR Prevention', () => {
    test('user cannot access another workspace\'s transaction', async () => {
      const user_a = await createUser();
      const user_b = await createUser();
      const tx_b = await createTransaction(user_b.workspace);
      
      const response = await fetch(`/api/v1/transactions/${tx_b.id}`, {
        headers: { Authorization: `Bearer ${user_a.token}` },
      });
      
      assert.equal(response.status, 404);
    });
  });
  
  describe('RLS Enforcement', () => {
    test('direct query as different user returns nothing', async () => {
      const user_a_conn = await connectAs(user_a);
      const result = await user_a_conn.query('SELECT * FROM transactions');
      assert.equal(result.length, 0); // User A should see only their data
    });
  });
  
  describe('Data Minimization', () => {
    test('error logs do not contain transaction amounts', async () => {
      const response = await POST('/api/v1/transactions', {
        amount: 5000,
        merchant: 'Therapist',
        invalid: 'field',
      });
      
      const logs = await getLogs();
      const errorLog = logs.find(l => l.level === 'error');
      
      assert(!errorLog.message.includes('5000'));
      assert(!errorLog.message.includes('Therapist'));
    });
  });
});
```

### Validation
- [ ] All tests pass
- [ ] CI integration working
- [ ] Security tests run on every commit
- [ ] Monitoring configured

### Acceptance Criteria
- Security test suite established
- All tests pass
- CI/CD integration complete
- Automated alerting on failures

---

## Success Metrics

After completing these 10 priorities:

| Metric | Target |
|--------|--------|
| RLS Coverage | 100% of user-scoped tables |
| IDOR Test Coverage | 100% of ID endpoints |
| Rate Limiting | All auth endpoints protected |
| Security Tests | Automated on every commit |
| PII in Logs | 0 occurrences |
| Production Deployment Readiness | ✓ Approved |
| User Autonomy | Delete account, delete workspace, export data |
| Financial Calculation Maintainability | Single source of truth for each calculation |

---

## Timeline Summary

```
Week 1-2: RLS + Rate Limiting (Foundations)
Week 2-3: Data Minimization (AI Safety)
Week 3-4: IDOR + Account Deletion (Security)
Week 4-5: Consolidate Calculations (Maintainability)
Week 4:   Error Handling (Security)
Week 5-6: Workspace Deletion + Export (User Autonomy)
Week 6:   Security Testing (CI/CD)

Total: 6-8 weeks (2 engineers, full-time)
```

---

## Resource Requirements

- **Backend Engineer:** 1 FTE (security + architecture focus)
- **QA/Security Engineer:** 0.5 FTE (testing + validation)
- **Code Review:** Daily (thorough security review)
- **Tools:** Redis (rate limiting), Postgres 13+ (RLS), test framework

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Calculation consolidation breaks UI | Run regression tests before/after; feature flag old/new |
| RLS performance impact | Benchmark and optimize queries; add indexes if needed |
| Rate limiting false positives | Whitelist internal services; adjust thresholds based on metrics |
| Data deletion bugs cause data loss | Test extensively with staging data; implement audit trail |

---

## Not Included (Phase 2)

- Encryption at rest (lower priority for security posture)
- Backup/restore testing (still important, but not blocking launch)
- Admin panel (nice to have, not required for MVP)
- Full-text search (feature, not security/architecture)
- Event bus (no evidenced need yet)

---

**Next Step:** Schedule kickoff meeting and assign owners to each priority.

