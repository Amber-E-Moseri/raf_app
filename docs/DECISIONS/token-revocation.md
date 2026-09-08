# Decision: Token Revocation Architecture

**Date:** 2026-09-05  
**Updated:** 2026-09-06  
**Status:** Implemented for local JWT logout  
**Affects:** `lib/auth/jwt.js`, `app/api/v1/auth/logout/route.js`, `lib/server/scheduler.js`

## Current Behavior

Local JWT sessions are signed by `lib/auth/jwt.js` using a reviewed HS256 implementation:

- JSON Web Signature input is HMAC-SHA256 signed.
- Signature comparison uses `crypto.timingSafeEqual`.
- Issued tokens include a `jti` claim.
- Logout stores the token `jti` and expiration timestamp in durable persistence.
- `verifyToken()` rejects a token when its `jti` appears in the durable blacklist.

The durable table is created by:

```sql
db/migrations/20260905000000_add_token_blacklist.sql
```

Postgres stores revocations in `raf.token_blacklist`. SQLite and in-memory adapters expose the same transaction contract so local development and tests keep the same logout semantics.

Expired blacklist rows are removed periodically by the RAF scheduler through `cleanupExpiredBlacklistedTokens()`.

## Security Posture

Logout revocation now survives process restart and works across multiple API instances that share the same database.

Existing pre-`jti` tokens remain backward-compatible until natural expiration. They can be verified if otherwise valid, but cannot be durably blacklisted because they have no stable token ID.

If blacklist lookup fails during token verification, RAF fails closed and rejects the token.

## Gap B: Password-Change Session Invalidation

No local-auth password-change endpoint exists. For the local JWT path, Gap B is therefore **not applicable until a local password-change route is added**. If such a route is introduced later, it must revoke the current session token, and any broader "all sessions" invalidation should be implemented with a durable per-user token/session version or refresh-token store.

The Supabase reset-password route is separate from the local JWT path. Supabase-managed session invalidation should be handled through Supabase Auth controls when that provider is enabled.

## JOSE

RAF has **not** adopted `jose`.

The current implementation is hand-rolled HS256 with timing-safe comparison and a durable DB-backed blacklist. Migrating to `jose` remains a valid future maintenance task, but it is intentionally out of scope for this remediation branch.
