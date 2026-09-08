# RAF Supabase Auth Migration

Read [RAF_PRODUCT_CONSTITUTION.md](RAF_PRODUCT_CONSTITUTION.md) and complete the [Phase 2.5 validation gate](phase-2.5-validation.md) before making production authentication changes.

## Prototype Auth Audit

The original prototype auth stack used:

- custom HS256 JWT signing
- a development secret fallback
- local password hashes in RAF persistence
- in-memory token blacklisting on logout
- no refresh-token lifecycle
- no email verification flow
- no forgot/reset password flow

That original stack was not production-grade because revocation was process-local, password lifecycle was custom code, and a missing secret could silently fall back to a known development value. The local JWT logout path has since been upgraded to a durable `jti` blacklist; see [token-revocation.md](DECISIONS/token-revocation.md).

## Target Boundary

Supabase Auth owns identity:

```text
Authentication: Who are you?
```

RAF owns application authorization:

```text
Authorization: What may you do in this workspace?
```

Workspace membership, RAF roles, financial permissions, entitlements, allocation rules, and financial records remain in RAF persistence.

## Production Configuration

Use:

```text
RAF_AUTH_PROVIDER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
RAF_AUTH_REQUIRED=true
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it through `VITE_*`, browser bundles, logs, or client responses.

Local JWT auth is blocked when `NODE_ENV=production`. It also requires `JWT_SECRET` when `RAF_AUTH_REQUIRED=true`.

## Signup Onboarding

Signup is:

```text
Supabase user -> RAF app user -> Personal workspace -> owner membership -> default RAF allocations
```

RAF onboarding is idempotent. If the Supabase user already exists in RAF, the flow returns existing workspace memberships instead of creating duplicate workspace data.

If a legacy RAF user exists with the same email but a different user id, onboarding returns `409` until an explicit account-link migration maps that RAF user to the Supabase Auth identity. This avoids a broken state where login succeeds but workspace authorization later fails.

The repository spec still describes the original single-household MVP and direct Supabase client auth. Phase 3 intentionally keeps RAF server routes as the application boundary so the server can enforce workspace membership, permissions, and onboarding invariants consistently.

## Session Behavior

The browser stores the Supabase access token and refresh token in the existing RAF session store. API calls use:

```text
Authorization: Bearer <supabase access token>
x-workspace-id: <active workspace>
```

The server verifies access tokens with Supabase Auth `getUser`. RAF does not trust decoded client claims alone for server authorization.

## CSRF and XSS

RAF uses bearer tokens in explicit `Authorization` headers rather than ambient cookies, which reduces classic CSRF exposure. XSS remains the primary browser-token risk because tokens are available to JavaScript. Production hardening should include:

- strict Content Security Policy
- no untrusted HTML injection
- dependency review
- short access-token lifetime with refresh rotation
- Sentry/log scrubbing for tokens and auth headers

## Logout and Revocation

Logout calls Supabase Auth sign-out when Supabase Auth is enabled. The local JWT fallback uses durable `jti` blacklisting rather than a process-local blacklist. Supabase access tokens remain valid until expiry according to Supabase Auth behavior; use short JWT lifetimes and refresh-token revocation for stronger logout semantics.

## Password Recovery and Verification

RAF exposes server routes for:

- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `GET /api/v1/auth/verify-email`
- `POST /api/v1/auth/refresh`

Supabase sends verification and recovery emails according to project Auth settings.

## Account Deletion

`DELETE /api/v1/auth/account` is authenticated. RAF deletes user-owned workspace data through the persistence adapter, then calls Supabase Admin delete using the server-only service role key.

Production should add a confirmation step in the UI before invoking this endpoint.

## Brute Force and Rate Limits

Supabase Auth provides baseline auth protections. RAF should add edge/API rate limiting for auth endpoints before public launch, especially signup, login, forgot-password, and reset-password.
