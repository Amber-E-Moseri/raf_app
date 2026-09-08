# RAF Production Security Audit & Hardening Report
**Date:** 2026-09-04  
**Status:** COMPREHENSIVE AUDIT & REFACTORING PLAN

---

## Executive Summary

RAF is a well-structured financial stewardship system with good foundational security practices (JWT auth, workspace isolation, schema constraints). However, several hardening opportunities exist before production use:

### Critical Issues (Fix Before Production)
1. **CORS too permissive** - Any localhost origin accepted; needs tightening for production
2. **No explicit rate limiting** - API vulnerable to brute force and DoS
3. **Financial data sent to AI without minimization** - Full transaction history sent to Remi
4. **Limited audit logging** - Important mutations not traced
5. **No data deletion workflows** - Users cannot delete accounts or export data
6. **Error responses may leak details** - Uncontrolled error messages in JSON responses

### High Priority (Before MVP Release)
7. **No RLS policies** - Row-Level Security not enforced at database level for Postgres
8. **Header naming inconsistency** - Both `x-workspace-id` and `x-workspace_id` supported (legacy debt)
9. **File upload size limits** - Bank statements limited to 10MB but no per-user quota
10. **Stripe webhook validation** - Webhook signature verification not found
11. **Password reset token expiry** - No time limit on password reset tokens found
12. **Session invalidation** - No explicit token revocation on password change
13. **Import statement parsing** - Untrusted file parsing without sandboxing

### Medium Priority (Before Scale)
14. **Financial calculation duplication** - Same logic in dashboard, monthly reviews, reports
15. **No encryption at rest** - Sensitive fields not encrypted (SQLite/Postgres)
16. **Logging includes financial data** - Revenue, expenses visible in logs
17. **No account deletion cascade** - Workspace deletion may orphan data
18. **Email verification gaps** - Signup email verification optional
19. **Collaboration permissions** - Role-based access control incomplete for multi-user

---

## Detailed Audit Findings

### 1. Authentication & Authorization ✓ Partial

**Status:** Good foundation, gaps exist

**Findings:**
- ✅ JWT tokens used for session management (local auth) or Supabase tokens
- ✅ Workspace context resolved and validated per request
- ✅ Permission checks via `roleHasPermission()` on read operations
- ❌ **No explicit token revocation** - logout clears client-side only
- ❌ **No refresh token rotation** - Long-lived refresh tokens not rotated
- ⚠️ **Password change doesn't invalidate existing sessions**
- ⚠️ **Supabase auth scope unclear** - Service role key stored in env

**Recommendations:**
- Implement token revocation list (Redis/database-backed)
- Add expiry to password reset tokens (15 min)
- Invalidate all tokens on password change
- Rotate refresh tokens on each use
- Document Supabase permission model

---

### 2. Authorization & Access Control ✓ Mostly Good

**Status:** Workspace-scoped; role-based in progress

**Findings:**
- ✅ Workspace isolation at API layer via `x-workspace-id` header
- ✅ Database queries scoped to household_id/workspace_id
- ✅ Role checks exist (`buildWorkspaceContext`, `roleHasPermission`)
- ❌ **IDOR risks in parameter IDs** - No explicit ownership check before resource access
  - Example: GET `/debts/[id]` - no verification that debt belongs to user's workspace
  - Example: GET `/goals/[id]` - same issue
- ❌ **No explicit authorization decorators** - Permission checks not standardized
- ⚠️ **Membership status not checked** - Workspace membership type (owner/member/viewer) not enforced consistently

**Test Cases Needed:**
```javascript
// Should reject:
GET /api/v1/debts/:debtId (from different workspace)
GET /api/v1/goals/:goalId (from different workspace)
PATCH /api/v1/transactions/:transactionId (non-owner trying to modify)
```

**Recommendations:**
- Add explicit ownership checks before resource mutations
- Create authorization middleware decorator
- Add test suite for privilege escalation
- Audit all ID-based endpoints

---

### 3. Row-Level Security (RLS) ❌ Missing

**Status:** Not implemented for Postgres

**Findings:**
- ⚠️ **Postgres RLS policies not found** - Database relies on application-layer filtering
- ⚠️ **Direct database access bypasses app checks** - A compromised admin or direct DB query would leak data
- ⚠️ **SQLite has no RLS** - Local dev okay, production must use Postgres + RLS

**Critical Risk:** If app code is compromised or misconfigured, all data for all workspaces is exposed.

**Recommendations:**
- Create RLS policies for all financial tables
- Policy template:
  ```sql
  ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
  CREATE POLICY workspace_isolation ON transactions
    FOR ALL USING (
      household_id IN (
        SELECT workspace_id FROM workspace_members 
        WHERE user_id = current_user_id 
        AND status = 'active'
      )
    );
  ```
- Test: Verify RLS blocks data leakage from misconfigured queries
- **This must be in place before multi-user production deployment**

---

### 4. IDOR (Insecure Direct Object Reference) ⚠️ HIGH RISK

**Status:** Partially mitigated by household_id checks, but gaps exist

**Findings:**
- ✅ **Most routes check household_id in queries** - Transactions, debts, goals filtered by household
- ❌ **ID-only endpoints lack explicit checks**:
  - `GET /api/v1/transactions/:id` - fetches by ID; does it verify household ownership?
  - `PATCH /api/v1/debts/:id` - updates debt; no visible ownership validation
  - `DELETE /api/v1/goals/:id` - deletes goal; missing authorization
- ⚠️ **Batch operations** - No found; if they exist, may have IDOR gaps

**Recommendations:**
- Review all routes accepting `[id]` parameters
- Add explicit check: `const debt = await db.getDebt({ id, householdId })`
- Throw 404 (not 403) if not found to avoid enumeration
- Write IDOR tests for each entity type

---

### 5. API Validation ✓ Good

**Status:** Zod schemas in use; gaps remain

**Findings:**
- ✅ **Request validation with Zod** - Routes use Zod for input parsing
- ✅ **Type safety** - TypeScript on frontend
- ⚠️ **POST body validation not consistent** - Some routes accept formData, others JSON
- ⚠️ **Query parameter validation missing** - Dates, UUIDs, numbers not validated
- ⚠️ **File upload validation weak** - Only checks MIME type, not file content

**Example Issues:**
```javascript
// ❌ No validation of from/to dates (could be invalid ISO dates)
const result = await listTransactions({
  query: {
    from: searchParams.get('from'),  // "invalid-date" accepted?
    to: searchParams.get('to'),      // Could exceed max date range?
  },
});

// ❌ File upload accepts any text as bank statement
const text = await file.text();  // No format validation (CSV structure)
```

**Recommendations:**
- Add date range validation (max 1 year, valid ISO format)
- Validate file format before parsing (magic bytes for PDF, CSV headers)
- Create reusable validation middleware
- Document max request sizes

---

### 6. Rate Limiting ❌ MISSING

**Status:** No rate limiting found

**Critical Risk:** Brute force attacks on password reset, login loops, statement upload spam

**Recommendations:**
- Implement rate limiting:
  - `/auth/login` - 5 attempts per IP per 15 min
  - `/auth/forgot-password` - 3 requests per email per hour
  - `/imports/upload` - 10 uploads per user per hour
  - `/api/v1/*` - General: 100 requests per user per minute
- Use in-memory store for dev, Redis for production
- Return `429 Too Many Requests` with `Retry-After` header

---

### 7. Secrets Management ⚠️ Adequate for Dev, Needs Hardening

**Status:** Env vars loaded from .env; production concerns

**Findings:**
- ✅ **Required vars checked at startup** - `loadServerEnv()` validates all required secrets
- ✅ **Zod schema for env validation** - Type-safe env parsing
- ⚠️ **JWT_SECRET stored as string** - No rotation mechanism
- ⚠️ **Supabase service role key in env** - Grants admin access; should use scoped keys
- ⚠️ **Resend/Anthropic API keys in env** - No per-environment scoping
- ⚠️ **.env.example leaked in git** - Should not contain real values

**Recommendations:**
- Use secrets management service (AWS Secrets Manager, HashiCorp Vault, Neon Secrets)
- Rotate JWT_SECRET without invalidating tokens (graceful key rollover)
- Use scoped Supabase tokens (not service role for app)
- Audit git history for exposed secrets: `git log --all -S "SUPABASE_SERVICE_ROLE_KEY"`
- Implement secret rotation on a schedule

---

### 8. Logging & Observability ⚠️ FINANCIAL DATA EXPOSED

**Status:** Structured logging in place; PII/financial data not sanitized

**Findings:**
- ✅ **JSON structured logging** - Request/response times, status codes logged
- ✅ **Request-level observability** - Duration, method, path, status, workspace_id tracked
- ❌ **Error responses include error.message** - May leak details
  - Example: "Constraint violation: income_allocations total must equal income"
  - Example: "Debt payment exceeds principal balance"
- ❌ **Financial data in error logs** - If transaction parsing fails, full data logged?
- ❌ **No request/response logging** - Request bodies not logged (good), but response bodies not checked

**Example Risk:**
```javascript
// ❌ In index.js error handler:
console.error(JSON.stringify({
  level: 'error',
  event: 'api_error',
  message: error?.message,  // May include amount, merchant, etc.
}));

// User makes request with sensitive data
POST /api/v1/transactions { "amount": 50000, "merchant": "therapist" }
// If validation fails, logs error without sanitization
```

**Recommendations:**
- Sanitize error messages before logging
- Never log request/response bodies containing financial data
- Log financial mutations by type, not value:
  - ✅ "transaction_created"
  - ❌ "transaction_created with amount=$5000"
- Implement structured error handling with error codes instead of messages
- Example:
  ```javascript
  console.error(JSON.stringify({
    level: 'error',
    event: 'api_error',
    errorCode: 'CONSTRAINT_VIOLATION',
    context: 'income_allocation',
    workspaceId: req.headers['x-workspace-id'],
  }));
  ```

---

### 9. Error Responses ⚠️ May Leak Information

**Status:** Generic error responses, but inconsistent

**Findings:**
- ✅ **500 errors hidden** - "Internal Server Error" generic response
- ⚠️ **Client-facing error messages** - Include implementation details
- ⚠️ **401 vs 403 differences** - May aid enumeration
- ⚠️ **404 can enumerate resources** - "Debt not found" reveals existence check

**Example Issues:**
```json
// ❌ Leaks constraint details
POST /api/v1/income-allocations
{ "error": "Active allocation percentages must sum to 1.0000 ± 0.0001 for household X (found Y)" }

// ❌ Reveals user exists/doesn't exist in system
POST /auth/forgot-password
{ "error": "user_not_found" }
```

**Recommendations:**
- Return generic error messages to client:
  ```json
  { "error": "Request failed. Please contact support." }
  ```
- Log detailed errors server-side with error code
- Client receives error code to look up public documentation
- Never leak: database structure, validation rules, user existence

---

### 10. Database Backups ❌ NOT FOUND

**Status:** No backup mechanism documented

**Findings:**
- ⚠️ **SQLite in dev** - Single file; no automated backup
- ⚠️ **Postgres connection string** - Neon or self-hosted unclear
- ⚠️ **No backup restore test** - Untested disaster recovery

**Recommendations:**
- For Neon: Enable automated backups (enabled by default, 7 days)
- For self-hosted Postgres:
  - Hourly `pg_dump` to S3
  - Test restore weekly
  - Retention: 30 days
- Add backup status to `/health` endpoint

---

### 11. File Uploads ⚠️ RISKS PRESENT

**Status:** Bank statement uploads implemented; validation gaps

**Findings:**
- ✅ **File size limit** - 10MB max
- ⚠️ **No file type validation** - Accepts any `.text()` as CSV/PDF
- ⚠️ **No virus scanning** - Uploaded files not scanned
- ⚠️ **No per-user quota** - Single user could upload 100GB
- ⚠️ **Parsing errors uncaught** - PDF parsing may throw; error handling?
- ⚠️ **No file retention policy** - Uploaded statements stored indefinitely

**Recommendations:**
- Validate file format:
  ```javascript
  // Check magic bytes, not extension
  const buffer = await file.arrayBuffer();
  const magic = new Uint8Array(buffer.slice(0, 4));
  if (magic[0] === 0x25 && magic[1] === 0x50) { // PDF
    // ... PDF-specific parsing
  }
  ```
- Add per-user upload quota (e.g., 100 files/month)
- Implement virus scanning (ClamAV or third-party API)
- Set retention: delete raw files 30 days after parsing
- Wrap parsing in try/catch with structured error logging

---

### 12. Statement Parsing ⚠️ INJECTION RISKS

**Status:** CSV/PDF parsing implemented; untrusted input handling

**Findings:**
- ⚠️ **Parsing not sandboxed** - Runs in main Node process
- ⚠️ **CSV parsing libraries** - Known vulnerabilities in older versions
- ⚠️ **PDF parsing with pdf-parse** - Can crash on malformed PDFs
- ⚠️ **User input drives parsing** - Merchant names, descriptions not sanitized for Remi

**Example Risk:**
```javascript
// If merchant name contains command injection payload:
merchant: "'; DROP TABLE transactions; --"
// Later, if merchant used in unparameterized query (unlikely but check all usage)
```

**Recommendations:**
- Wrap parsing in worker thread to isolate crashes
- Validate bank statement format against institution standards
- Sanitize all parsed fields before storing
- Add integration tests with real bank statements (anonymized)

---

### 13. AI Data Exposure ❌ CRITICAL

**Status:** Full financial context sent to Remi

**Finding:** `buildFinancialContext()` fetches:
- Last 3 months of ALL transactions (up to 500)
- ALL income entries
- ALL debts
- ALL goals
- ALL monthly reviews

**Risk:** Sending unminimized financial data to external API (Claude) violates data minimization principle.

**Code Review:**
```javascript
// lib/remi/financialContext.js line 16-23
const [household, transactions, incomeEntries, debts, goals, monthlyReviews] = 
  await db.transaction(async (tx) => [
    await tx.getHousehold({ householdId }),
    await tx.listTransactions({ householdId, from, to, limit: 500 }),  // ❌ All transactions
    await tx.listIncomeEntries({ householdId, from, to }),              // ❌ All income
    await tx.listDebts({ householdId }),                                // ❌ All debts
    await tx.listGoals({ householdId }),                                // ❌ All goals
    await tx.listMonthlyReviews({ householdId }),                       // ❌ All reviews
  ]);
```

**Recommendations:**
- Create explicit context builders for each Remi tool
- Send aggregated summaries instead of raw data:
  ```javascript
  // ❌ Instead of full transaction list
  // ✅ Send: "Total spending: $5,000, highest category: groceries at $1,200"
  ```
- Never send: merchant names, personal notes, transaction descriptions
- Never send: full debt balances, only summary (total debt, avg APR)
- Document what data Remi receives in privacy policy

---

### 14. Stripe Webhooks ❌ NOT FOUND

**Status:** Stripe integration not apparent; if used, webhook validation is critical

**Findings:**
- ⚠️ **No Stripe webhook routes found** - May be in different branch or not implemented
- ⚠️ **If implemented**: Stripe signature verification MUST be present
- ⚠️ **Webhook secret rotation** - Not documented

**Recommendations (If Webhooks Used):**
```javascript
// Verify Stripe signature before processing
const signature = req.headers['stripe-signature'];
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
try {
  const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  // Process only after signature verified
} catch (error) {
  res.status(400).send(`Webhook Error: ${error.message}`);
}
```
- Never trust event data without signature verification
- Implement idempotent webhook handlers
- Log all webhook events for audit trail

---

### 15. Account Deletion ❌ NO WORKFLOW

**Status:** No user-initiated deletion path found

**Findings:**
- ❌ **No account deletion endpoint** - Users cannot delete accounts
- ❌ **No data export** - Users cannot download their data
- ❌ **No workspace deletion** - Multi-user workspaces cannot be deleted
- ⚠️ **GDPR compliance risk** - Right to erasure not implemented

**Recommendations:**
1. Create `/api/v1/auth/delete-account` endpoint
   - Require password confirmation
   - Hard delete user and all owned workspaces
   - Anonymize user in audit logs
   - 30-day grace period before hard delete

2. Create `/api/v1/workspaces/:id/export` endpoint
   - Export all financial data as JSON
   - Include: transactions, income, debts, goals, monthly reviews

3. Create `/api/v1/workspaces/:id/delete` endpoint
   - Only workspace owner can delete
   - Warning if other members exist
   - Soft delete (archive) first, hard delete after 30 days

---

### 16. Workspace Deletion ❌ GAPS

**Status:** Workspace ownership model unclear for multi-member workspaces

**Findings:**
- ⚠️ **Ownership rules unclear** - What happens when owner leaves?
- ⚠️ **Member data orphaning** - If owner deletes, member transactions remain?
- ⚠️ **No cascade delete planning** - All related data must be addressed

**Recommendations:**
- Define clear ownership transfer rules:
  - If owner leaves: transfer to longest-member editor
  - If no other members: archive workspace (data stays, locked)
  - If last member deletes account: hard delete all data after 30 days

---

### 17. Exports ⚠️ PARTIAL

**Status:** No direct user export endpoint; reports exist

**Findings:**
- ⚠️ **No machine-readable export** - Users cannot export as CSV/JSON
- ✓ **Reports exist** - Monthly reviews, dashboard reports available as JSON via API
- ⚠️ **No bulk export** - Must export month by month

**Recommendations:**
- Create `/api/v1/exports/all` endpoint returning:
  ```json
  {
    "transactions": [...],
    "income": [...],
    "debts": [...],
    "goals": [...],
    "allocation_categories": [...],
    "monthly_reviews": [...]
  }
  ```
- Support format parameter: `?format=json|csv`
- Generate as background job if >10k records

---

## Tenant Security Model

### Current Architecture
- **Multi-tenancy model**: Household/Workspace isolation
- **Isolation level**: Application-layer (not database-layer)
- **Scope headers**: `x-workspace-id` / `x-household-id`

### Threats & Mitigations

| Threat | Current State | Risk | Mitigation |
|--------|---------------|------|-----------|
| Cross-tenant data access | App-layer filtering only | HIGH | Add Postgres RLS policies |
| Workspace header spoofing | Token validates ownership | MEDIUM | ✓ Good |
| Admin data access | No admin panel found | LOW | Create audit logging if added |
| Shared resource leaks | Goals/debts per-household | LOW | ✓ Good |
| Invite token enumeration | Token is random UUID | LOW | ✓ Good |
| Privilege escalation | Roles enforced | MEDIUM | Add formal RBAC matrix |

### Recommended RLS Policies
```sql
-- Transactions: only accessible by workspace members
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON transactions
  FOR ALL USING (
    household_id IN (
      SELECT workspace_id FROM workspace_members 
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

-- Apply same pattern to: debts, goals, income_entries, allocation_categories, etc.
```

---

## Financial Calculation Duplication Map

### Identified Duplications

#### Balance Calculations
- **Dashboard** (`src/pages/Dashboard.tsx`) - Renders bucket balances
- **Reports API** (`lib/reports/getDashboardReport.js`) - Calculates bucket balances
- **Remi tools** (`lib/remi/toolHandlers.js`) - Summarizes available resources
- **Monthly review** (`lib/monthlyReviews/monthlyReviews.js`) - Validates surplus against balances

**Issue:** Same logic in 4+ places. Bug fix requires changes everywhere.

#### Allocation Calculations
- **Dashboard** - Shows allocation percentages
- **Monthly review** - Validates allocation sums to 100%
- **Income allocation** - Calculates allocation amounts
- **Database constraint** - `enforce_active_allocation_percent_sum()` trigger

**Issue:** Both app and database enforce; misalignment possible.

#### Surplus/Deficit Calculations
- **Dashboard period summary** - Shows surplus
- **Monthly review** - Applies surplus split rules
- **Trajectory engine** - Projects future surplus

**Issue:** Three separate implementations.

---

## Recommended Production Checklist

### Phase 1: Critical (Before MVP)
- [ ] Implement rate limiting on auth endpoints
- [ ] Add RLS policies to Postgres
- [ ] Sanitize error messages and logs
- [ ] Create account deletion workflow
- [ ] Add data export endpoint
- [ ] Validate file uploads
- [ ] Implement IDOR tests for all ID endpoints
- [ ] Document data minimization for Remi

### Phase 2: High Priority (Before Scale)
- [ ] Create audit log table
- [ ] Implement password reset token expiry
- [ ] Add session invalidation on password change
- [ ] Implement workspace deletion workflow
- [ ] Add per-user file upload quota
- [ ] Consolidate financial calculations
- [ ] Implement secrets rotation

### Phase 3: Medium Priority (Before Major Release)
- [ ] Add encryption at rest for sensitive fields
- [ ] Implement email verification requirement
- [ ] Create formal RBAC matrix
- [ ] Implement backup and restore testing
- [ ] Add security headers (CSP, HSTS, etc.)
- [ ] Implement request signing for high-value operations

---

## Next Steps

This audit identifies risks without proposing sweeping rewrites. RAF's architecture is sound; focus on:

1. **Apply Phase 1 fixes** immediately
2. **Consolidate financial calculations** before adding new features
3. **Implement RLS** before production Postgres deployment
4. **Add deletion/export workflows** for user autonomy
5. **Refactor into modular monolith** (see ARCHITECTURE_REFACTOR.md)

---

*Audit conducted: 2026-09-04*  
*Auditor: Claude Code Security Review*
