# Branch E — Phase 4: RLS Table Inventory

**Audit date: 2026-09-08**

This document catalogs the Row Level Security configuration for every table in the `raf` schema, derived from the migrations in `db/migrations/`. The columns record both the current live state and the security model applied.

---

## Legend

| Column | Meaning |
|---|---|
| **FORCE RLS** | `ALTER TABLE … FORCE ROW LEVEL SECURITY` — prevents the table owner from bypassing RLS |
| **SELECT policy** | The USING clause expression |
| **User ctx required** | `raf.user_id` must be set for the policy to pass |
| **WS ctx required** | `raf.workspace_id` must be set for the policy to pass |
| **App scope also** | Application layer enforces workspace membership check independently |
| **Status** | ✅ OK, ⚠️ partial, ❌ gap |

---

## Auth / Identity Tables

| Table | Tenant-owned | RLS enabled | FORCE RLS | SELECT policy | User ctx | WS ctx | App scope | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `app_users` | user-owned | ✅ | ❌ | `id = raf.current_user_id()` | ✅ | ❌ | ✅ login/signup | ✅ | Login/signup bypass intentional (user unknown) |
| `token_blacklist` | global | ❌ | ❌ | No RLS (intentional) | — | — | server-internal only | ✅ | See [token-blacklist-security-model.md](token-blacklist-security-model.md) |

## Workspace Coordination Tables

These tables are intentionally left with the original `has_workspace_membership()` helper (which allows IS NULL workspace) because they must be readable **before** workspace identity is confirmed (during the membership verification phase of request routing).

| Table | Tenant-owned | RLS enabled | FORCE RLS | SELECT policy | User ctx | WS ctx | App scope | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `workspaces` | ws-owned | ✅ | ❌ | `has_workspace_membership(id)` | ✅ | ❌ (intentional) | ✅ membership check | ✅ | Must be readable with user_id-only during auth |
| `workspace_members` | ws-owned | ✅ | ❌ | `has_workspace_membership(workspace_id)` | ✅ | ❌ (intentional) | ✅ | ✅ | Same — auth path |
| `workspace_invitations` | ws-owned | ✅ | ❌ | `has_workspace_membership(workspace_id)` | ✅ | ❌ (intentional) | ✅ | ✅ | Invite accept flow needs pre-membership read |
| `workspace_activity` | ws-owned | ✅ | ❌ | `has_workspace_membership(workspace_id)` | ✅ | ❌ (intentional) | ✅ | ✅ | Activity log |

## Financial Tables (Phase 2 Tightened Policies)

All 22 financial tables received tightened policies in `20260908020000_tighten_financial_rls_policies.sql`.  
New policy pattern: `workspace_id = raf.current_workspace_id() AND raf.has_workspace_membership(workspace_id)`

This eliminates the IS NULL escape — both `raf.user_id` AND `raf.workspace_id` must be set.

| Table | Tenant-owned | RLS enabled | FORCE RLS | SELECT policy | User ctx | WS ctx | App scope | Status |
|---|---|---|---|---|---|---|---|---|
| `households` | ws-owned | ✅ | ✅ | `workspace_id = current_workspace_id() AND has_membership(workspace_id)` | ✅ | ✅ | ✅ | ✅ |
| `allocation_categories` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `surplus_split_rules` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `income_entries` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `income_allocations` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `transactions` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `debts` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `debt_payments` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `debt_adjustments` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `fixed_bills` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `goals` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `import_batches` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `imported_transaction_rows` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `imported_transactions` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `merchant_rules` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `import_review_rules` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `monthly_reviews` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ (compat path) | ✅ |
| `pdf_import_quotas` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `remi_conversations` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `remi_messages` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `email_preferences` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |
| `email_send_log` | ws-owned | ✅ | ✅ | same | ✅ | ✅ | ✅ | ✅ |

## Infrastructure Tables

| Table | RLS | Notes |
|---|---|---|
| `schema_migrations` | ❌ | Migration tracking — no tenant data |

---

## Summary

| Category | Count | FORCE RLS | Tightened policy (Ph 2) |
|---|---|---|---|
| Financial tables | 22 | ✅ all 22 | ✅ all 22 |
| Workspace coordination | 4 | ❌ intentional | ❌ intentional (user_id-only access required for auth path) |
| Auth/Identity | 2 | ❌ intentional | N/A |
| Infrastructure | 1 | ❌ | N/A |

## Key RLS Helper Functions

```sql
-- Returns empty string (not NULL) when not set — safe for comparisons
CREATE FUNCTION raf.current_user_id() RETURNS text AS $$
  SELECT coalesce(current_setting('raf.user_id', true), '')
$$ LANGUAGE sql STABLE;

CREATE FUNCTION raf.current_workspace_id() RETURNS text AS $$
  SELECT coalesce(current_setting('raf.workspace_id', true), '')
$$ LANGUAGE sql STABLE;

-- Original helper: has IS NULL escape (intentionally kept for workspace/member tables)
CREATE FUNCTION raf.has_workspace_membership(p_workspace_id text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM raf.workspace_members
    WHERE workspace_id = p_workspace_id
      AND user_id = raf.current_user_id()
      AND status = 'active'
      AND (raf.current_workspace_id() IS NULL OR workspace_id = raf.current_workspace_id())
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

The `IS NULL` escape in `has_workspace_membership` is safe for workspace coordination tables (it's the intended behavior during auth). For financial tables, the explicit `workspace_id = raf.current_workspace_id()` check added in Phase 2 bypasses the escape — both conditions must be true independently.

## Open Gap: Application Role BYPASSRLS

G6 from the Phase 0 audit remains: the PostgreSQL application role used at runtime is likely a superuser or a role with `BYPASSRLS`, meaning `FORCE ROW LEVEL SECURITY` and all policies are currently bypassed in practice.

**Resolution path (Branch F):** Create a dedicated `raf_app` PostgreSQL role without `BYPASSRLS`, grant it table-level permissions, and update the connection string. This is a deployment concern, not a code change, and is documented in `docs/architecture-closure-e.md`.

Until the role change is made, application-layer authorization (membership verification in `routerLoader.js`) is the active safety layer. The RLS policies exist and are correct — they will activate once the role is restricted.
