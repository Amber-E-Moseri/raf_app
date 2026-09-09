# RAF Technical Debt Register

**Last Updated:** 2026-09-04  
**Status:** Active (prioritized by business impact)

---

## High Priority (Block Production Deployment)

### 1. Missing RLS Policies
**Severity:** CRITICAL  
**Files:** `db/migrations/`  
**Effort:** 2-3 days  
**Risk:** All Postgres deployments vulnerable to cross-tenant data leaks

**Description:**
PostgreSQL RLS policies are not implemented. Database relies entirely on application-layer filtering.

**Impact:**
- If app code has bug, all workspace data exposed
- Compromised admin account can access all data
- No cryptographic guarantee of isolation

**Solution:**
```sql
ALTER TABLE [table] ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON [table] FOR ALL USING (
  household_id IN (SELECT workspace_id FROM workspace_members 
                   WHERE user_id = auth.uid() AND status = 'active')
);
```

**Test:** `tests/security/rls.test.js` - Cross-tenant query blocking

---

### 2. No Rate Limiting
**Severity:** CRITICAL  
**Files:** `index.js`, auth routes  
**Effort:** 1-2 days  
**Risk:** Brute force attacks on authentication

**Description:**
No rate limiting on login, password reset, or general API endpoints.

**Impact:**
- Attackers can brute-force passwords
- DoS vulnerability on upload endpoints
- No protection against credential stuffing

**Solution:**
- Redis-backed rate limiter on auth routes
- Per-user rate limiting on API endpoints
- Return 429 with Retry-After header

**Packages:** `express-rate-limit`, `redis`

---

### 3. Financial Data Sent to AI
**Severity:** HIGH  
**Files:** `lib/remi/financialContext.js`  
**Effort:** 2-3 days  
**Risk:** User privacy violation, data minimization principle broken

**Description:**
Full transaction history (up to 500 transactions), all income, all debts sent to Claude API without minimization.

**Impact:**
- Remi can see merchant names (therapist, psychiatrist, etc.)
- Knows all transaction amounts and timing
- Can infer personal details from spending patterns
- Violates stated data minimization principle

**Solution:**
Create explicit context builders that return only aggregates:
- Total spending by category (not individual transactions)
- Debt summary (not balance by debt)
- Goal progress (not goal details)

**New Files:**
- `lib/platform/ai/contextBuilders.js` - Minimal context builders
- `tests/unit/contextBuilders.test.js` - Verify no PII leaked

---

### 4. IDOR (Insecure Direct Object Reference)
**Severity:** HIGH  
**Files:** `app/api/v1/[resource]/[id]/route.js` (all)  
**Effort:** 2-3 days  
**Risk:** Users can access/modify other users' data

**Description:**
Routes accepting resource IDs don't explicitly verify ownership before access.

**Example:**
```javascript
GET /api/v1/debts/:id  // Does not verify debt.household_id matches request.householdId
PATCH /api/v1/goals/:id // May allow user A to modify user B's goal
```

**Impact:**
- User can enumerate other users' resources
- User can modify other users' financial data
- User can delete other users' records

**Solution:**
Add explicit ownership check before access:
```javascript
const debt = await db.getDebt({ id, householdId });
if (!debt) throw new NotFound(); // Return 404, not 403 (avoid enumeration)
```

**Test:**
```javascript
test('cannot access debt from different workspace', async () => {
  const user_a_token = signToken(user_a.id);
  const user_b_debt = await createDebt(user_b_workspace);
  
  const response = await fetch(`/api/v1/debts/${user_b_debt.id}`, {
    headers: { Authorization: `Bearer ${user_a_token}` }
  });
  
  assert.equal(response.status, 404); // Not 403
});
```

---

### 5. Account Deletion Missing
**Severity:** HIGH  
**Files:** New endpoints needed  
**Effort:** 2-3 days  
**Risk:** GDPR non-compliance, user autonomy violation

**Description:**
No user-initiated account deletion endpoint. Users cannot delete their data.

**Impact:**
- GDPR violation (right to erasure)
- User trust concern
- Legal liability

**Solution:**
```
POST /api/v1/auth/delete-account
├─ Require password confirmation
├─ Soft delete (30 days grace)
├─ Hard delete after 30 days
└─ Create audit log
```

**New Files:**
- `app/api/v1/auth/delete-account/route.js`
- `lib/app/workspace/deletionService.js`

---

### 6. Error Messages Leak Details
**Severity:** MEDIUM  
**Files:** `index.js`, all route error handlers  
**Effort:** 1-2 days  
**Risk:** Information disclosure

**Description:**
Error responses include detailed messages that reveal system internals.

**Examples:**
- "Active allocation percentages must sum to 1.0000 ± 0.0001 for household X"
- "Constraint violation: income_allocations total must equal income"

**Solution:**
Return generic error messages; log details server-side:
```javascript
// Client receives:
{ "error": "Request failed. Please contact support. (Error: ERR_VALIDATION_001)" }

// Server logs:
{ 
  level: "error",
  errorCode: "ERR_VALIDATION_001",
  context: "income_allocation",
  details: "allocation sum mismatch"
}
```

---

### 7. Calculation Duplication
**Severity:** MEDIUM  
**Files:** Multiple (`dashboard.tsx`, `monthlyReviews.js`, `reports/`, `remi/`)  
**Effort:** 4-6 days  
**Risk:** Inconsistent calculations, hard to maintain

**Description:**
Balance, allocation, and surplus calculations implemented in 3+ locations.

**Impact:**
- Bug fix requires changes everywhere
- Tests in one place don't catch errors in another
- Harder to understand business logic

**Solution:**
Consolidate to domain layer:
- `lib/domain/balance/calculations.js` - Single source of truth
- `lib/domain/allocation/calculations.js` - Allocation logic
- `lib/domain/surplus/distribution.js` - Surplus split

**Follow:** ARCHITECTURE_REFACTOR.md Phase 1-2

---

## Medium Priority (Before Scale)

### 8. No Audit Logging
**Severity:** MEDIUM  
**Files:** New table, platform/logging  
**Effort:** 2-3 days  
**Risk:** Cannot trace data mutations

**Description:**
No audit log table. Cannot trace who did what and when.

**Solution:**
```sql
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  timestamp timestamptz,
  details jsonb
);
```

**Never log:** amounts, merchants, personal notes  
**Always log:** action type, entity ID, timestamp

---

### 9. File Upload Validation Weak
**Severity:** MEDIUM  
**Files:** `app/api/v1/imports/upload/route.js`, parsing code  
**Effort:** 1-2 days  
**Risk:** Malformed files crash parser, security issues

**Description:**
File uploads not validated for format or content.

**Solution:**
- Check magic bytes (not extension)
- Validate CSV headers
- Wrap parsing in try/catch with structured error handling
- Implement per-user upload quota

---

### 10. No Encryption at Rest
**Severity:** MEDIUM  
**Files:** Database schema  
**Effort:** 3-4 days  
**Risk:** Data compromised if database backup leaked

**Description:**
Financial data stored in plaintext in database.

**Solution:**
- Add encrypted_fields to sensitive columns
- Implement transparent encryption layer
- Use app-level encryption (encrypt in app, decrypt when needed)

---

### 11. Password Reset Token Expiry Missing
**Severity:** MEDIUM  
**Files:** `lib/auth/password.js`, reset-password route  
**Effort:** 1 day  
**Risk:** Token can be used indefinitely

**Description:**
Password reset tokens don't expire.

**Solution:**
```javascript
CREATE TABLE password_reset_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + '15 minutes'::interval)
);

// Validate token
if (token.expires_at < now()) throw new Error('Token expired');
```

---

### 12. Session Invalidation on Password Change Missing
**Severity:** MEDIUM  
**Files:** Auth layer  
**Effort:** 1-2 days  
**Risk:** Old sessions remain valid after password change

**Description:**
Changing password doesn't invalidate existing tokens.

**Solution:**
- Increment user version on password change
- Include version in JWT
- Reject old tokens on validation

---

### 13. Legacy Header Naming
**Severity:** LOW  
**Files:** `index.js`, `routerLoader.js`, all routes  
**Effort:** 1 day  
**Risk:** Confusion, inconsistency

**Description:**
Both `x-workspace-id` and `x-household-id` headers supported (same meaning).

**Solution:**
Standardize on `x-workspace-id` everywhere; drop `x-household-id` support.

---

### 14. No Workspace Deletion Workflow
**Severity:** MEDIUM  
**Files:** New endpoint  
**Effort:** 2-3 days  
**Risk:** User cannot delete workspace

**Description:**
No endpoint to delete workspace (only admin can?).

**Solution:**
```
DELETE /api/v1/workspaces/:id
├─ Only owner can delete
├─ Warn if other members exist
├─ Soft delete (30 days)
└─ Hard delete after 30 days
```

---

### 15. No Data Export Endpoint
**Severity:** MEDIUM  
**Files:** New endpoint  
**Effort:** 2-3 days  
**Risk:** User cannot export their data

**Description:**
No machine-readable export endpoint.

**Solution:**
```
GET /api/v1/workspaces/:id/export?format=json|csv

Returns:
{
  transactions: [...],
  income: [...],
  debts: [...],
  goals: [...],
  monthly_reviews: [...]
}
```

---

## Low Priority (Nice to Have)

### 16. Logging Includes Financial Data
**Severity:** LOW  
**Files:** Error handlers, route logging  
**Effort:** 1-2 days  
**Risk:** Sensitive info in logs

**Description:**
Some financial data may appear in error logs.

**Solution:** Already covered in items 5, 6

---

### 17. No Admin Panel
**Severity:** LOW  
**Files:** New section  
**Effort:** 5-7 days  
**Risk:** Cannot monitor system, troubleshoot issues

**Description:**
No admin interface for support/troubleshooting.

**Solution:**
- Add `/api/v1/admin/workspaces` (list all)
- Add `/api/v1/admin/audit-logs` (view logs)
- Add `/api/v1/admin/health` (system status)

**Note:** Requires strict admin-only RBAC

---

### 18. No Backup Restore Test
**Severity:** LOW  
**Files:** DevOps  
**Effort:** 1-2 days  
**Risk:** Backup unusable when needed

**Description:**
Backup system may exist but not tested.

**Solution:**
- Weekly backup restore test
- Document restore procedure
- Measure restore time

---

### 19. No Request Signing for High-Value Operations
**Severity:** LOW  
**Files:** Auth layer  
**Effort:** 2-3 days  
**Risk:** MitM attacks on sensitive operations

**Description:**
No signature verification for sensitive operations (account deletion, large transfers).

**Solution:**
- Client signs request with device key
- Server verifies signature
- Prevents MitM modification

---

### 20. Search Not Implemented
**Severity:** LOW  
**Files:** New feature  
**Effort:** 3-5 days  
**Risk:** User cannot find old transactions

**Description:**
No full-text search on transactions.

**Solution:**
- Add `transactions_fts` table with trigrams
- Implement `/api/v1/transactions/search` endpoint

---

## Debt Retirement Checklist

- [ ] Implement RLS (item 1)
- [ ] Add rate limiting (item 2)
- [ ] Data minimization for Remi (item 3)
- [ ] Fix IDOR vulnerabilities (item 4)
- [ ] Add account deletion (item 5)
- [ ] Sanitize errors (item 6)
- [ ] Consolidate calculations (item 7)
- [ ] Add audit logging (item 8)
- [ ] Validate file uploads (item 9)
- [ ] Add encryption at rest (item 10)
- [ ] Token expiry (item 11)
- [ ] Session invalidation (item 12)
- [ ] Standardize headers (item 13)
- [ ] Workspace deletion (item 14)
- [ ] Data export (item 15)

---

## Cost Estimation

| Priority | Items | Effort | Cost (at $200/hr) |
|----------|-------|--------|------------------|
| Critical | 1-7 | 13-18 days | $20K-$28K |
| High | 8-15 | 16-22 days | $25K-$35K |
| Low | 16-20 | 11-16 days | $17K-$25K |
| **Total** | **20** | **40-56 days** | **$62K-$88K** |

**Prioritize items 1-7 before production.**

