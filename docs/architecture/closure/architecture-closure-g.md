# Architecture Closure G — Audit Trail vs Activity Feed

**Branch G Final Report | 2026-09-09**

---

## Declaration

```
ARCHITECTURE CLOSURE G: READY
```

Branch G is complete. The single `workspace_activity` table now categorises all events. Security events are restricted to owners and admins at the RLS layer. Raw financial data is prohibited by explicit policy documented in code. Branch H must not begin until explicitly authorised.

---

## Problem Statement

All events — financial mutation audit, collaboration activity, and high-impact security events — wrote to a single `workspace_activity` table with no structural distinction. Two specific risks:

1. **Access control gap**: security events (workspace deletion, ownership transfer, future auth events) were visible to all active workspace members under the same `has_workspace_membership` read policy. No mechanism restricted them to owners/admins.

2. **Policy contradiction**: `lib/collaboration/activityLogger.js` contained a metadata guideline explicitly suggesting "amount formatted as string" — directly contradicting `lib/audit/auditLog.js` which prohibited raw financial values. A future caller following the first comment would produce a data leak.

No auth events (login, logout, failed auth) were being logged at all.

---

## What Was Audited

### Call sites that write to workspace_activity

| Module | Function | Events logged |
|--------|----------|--------------|
| `lib/accounts/accounts.js` | `logAuditEvent` | account.created, account.updated, account.reconciliation_created, account.reconciliation_resolved |
| `lib/collaboration/activityLogger.js` | `logActivity` | member.invited, member.accepted, member.role_changed, member.removed, member.left, workspace.name_changed |
| `lib/collaboration/members.js` | `logAuditEvent` + `logWorkspaceActivity` | workspace.deleted, workspace.ownership_transferred |
| `lib/collaboration/invitations.js` | `logActivity` | member.invited, member.accepted |

### Raw financial data in metadata — current state

All existing call sites were audited. None pass raw amounts, balances, or transaction descriptions in metadata. The risk was prospective (the misleading comment), not an active leak.

---

## What Changed

### `db/migrations/20260909010000_branch_g_activity_category.sql`

1. Adds `event_category TEXT NOT NULL DEFAULT 'collaboration'` to `workspace_activity`.
2. Backfills all existing rows by action prefix:
   - `financial_audit`: income, transaction, debt, monthly_review, import, account events, remi.chat
   - `security_audit`: workspace.deleted, workspace.ownership_transferred, and all future auth.* events
   - `collaboration` (default): all member events, workspace name changes
3. Adds `CHECK (event_category IN ('collaboration', 'financial_audit', 'security_audit'))` — invalid categories are rejected at the DB layer.
4. Replaces the `workspace_activity_read_policy`:
   - `security_audit` rows: `has_workspace_role(workspace_id, ['owner', 'admin'])` — owners and admins only
   - All other rows: `has_workspace_membership(workspace_id)` — all active members (unchanged)

### `lib/collaboration/activityLogger.js`

Removed the contradictory metadata guideline ("amount formatted as string") and replaced with an explicit prohibition:

> NEVER include amounts, balances, transaction descriptions, or any value that reveals the magnitude or nature of a financial event — log entity IDs only.

---

## Event Category Policy

| Category | Access | Retention | What belongs here |
|----------|--------|-----------|-------------------|
| `collaboration` | All active workspace members | Short | Member invitations, role changes, workspace config edits |
| `financial_audit` | All active workspace members | Medium | Financial entity mutations (income, debts, goals, accounts) — IDs only, no raw amounts |
| `security_audit` | Owners and admins only | Long | Workspace deletion, ownership transfer, future auth events (login, logout, failed auth) |

---

## Auth Events — Gap Not Resolved (Accepted Deferral)

Login, logout, and failed authentication events are not currently written to the activity log. These belong in `security_audit`. This is an accepted gap:

- Auth routes run without workspace context — `logAuditEvent` requires `workspaceId`
- Adding auth event logging requires a non-workspace-scoped table or a separate mechanism
- This is deferred to production hardening (observability pass), not an architecture blocker

The category infrastructure (`event_category = 'security_audit'`, admin-only RLS) is in place and ready to receive auth events when that logging is added.

---

## What This Does NOT Change

- No financial logic modified
- No monthly reviews or import pipeline changed
- No application-layer authorization modified
- RLS policies on financial tables (22 tables) unchanged — Branch E/F work is intact
- `workspace_activity` INSERT policy unchanged — category is trusted to be set by application code

---

## Exit Criteria

| # | Criterion | Status |
|---|---|---|
| 1 | All workspace_activity write sites audited | ✅ |
| 2 | No raw financial data found in existing metadata | ✅ |
| 3 | Contradictory "include amounts" comment removed | ✅ |
| 4 | event_category column added with valid-value CHECK constraint | ✅ |
| 5 | security_audit events restricted to owners/admins via RLS | ✅ |
| 6 | Existing collaboration/financial_audit rows remain readable by all members | ✅ |
| 7 | Auth event gap acknowledged and deferred with infrastructure ready | ✅ |
| 8 | Migration registered in scripts/migrate.js | ✅ |

---

## Files Changed / Created

| File | Change |
|------|--------|
| `db/migrations/20260909010000_branch_g_activity_category.sql` | New — adds event_category, backfills, updates RLS policy |
| `lib/collaboration/activityLogger.js` | Comment correction — prohibits amounts in metadata |
| `scripts/migrate.js` | Registers 20260909010000_branch_g_activity_category.sql |
| `docs/architecture-closure-g.md` | This document |
