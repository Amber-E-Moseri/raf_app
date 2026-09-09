# Token Blacklist Security Model

**Branch E Phase 5 | Audit date: 2026-09-08**

---

## Decision: Server-Only Global Table (No RLS)

`raf.token_blacklist` is intentionally configured without Row Level Security.

---

## Ownership Model

The token blacklist is **not tenant-owned** and **not user-owned** in the RLS sense.

| Property | Value |
|---|---|
| Tenant scope | None — JTIs are per-token, per-user, but the table is global |
| User scope | Implicit (JTI is random, unguessable) but no policy needed |
| Application access | Server-internal only: logout writes, middleware reads |
| Client-facing access | None — no route exposes the table directly |

---

## Why No RLS

1. **No cross-tenant risk.** A JTI is a random UUID generated at token-issue time. An attacker who knows their own JTI cannot enumerate or predict other users' JTIs. Row-level isolation by workspace or user would add zero security.

2. **Server-only write path.** Only `insertBlacklistedToken` (called by logout) and `isTokenBlacklisted` (called by every authenticated request) access this table. Both are server-initiated; no client can call them directly.

3. **RLS would complicate auth operations.** Login and blacklist-check transactions intentionally run without `raf.user_id` set (the user identity isn't known yet or isn't relevant). Adding RLS to `token_blacklist` and trying to check JTIs without user context would require a special bypass mechanism that adds complexity with no security benefit.

4. **Schema-level isolation is sufficient.** The `raf` schema is not accessible from the browser. The application role is the only client.

---

## Security Controls in Place

| Control | Status |
|---|---|
| Schema not browser-accessible | ✓ |
| No client-facing route reads/writes this table | ✓ |
| JTI is a CSPRNG UUID (crypto.randomUUID) | ✓ |
| `expires_at` indexed; expired tokens cleaned up | ✓ |
| INSERT uses `ON CONFLICT DO UPDATE` (idempotent) | ✓ |
| `isTokenBlacklisted` checks `expires_at > now()` | ✓ |

---

## Verification: Token Revocation Behavior

Verified during Phase 15 (auth boundary tests):

```
POST /auth/login      → 200, token issued
GET  /transactions    → 200, token valid
POST /auth/logout     → 200, token blacklisted
GET  /transactions    → 401, token rejected (blacklisted)
```

Expired tokens (past `expires_at`) are not considered blacklisted — they are already rejected by JWT expiry check before the blacklist is consulted.

---

## If Stricter Access Is Required in Future

If the application role is changed from BYPASSRLS to a restricted role, `token_blacklist` access must be explicitly granted to that role:

```sql
GRANT SELECT, INSERT, UPDATE ON raf.token_blacklist TO raf_app;
```

RLS remains unnecessary for this table unless a multi-tenant-per-connection model is adopted (not the current architecture).
