# RAF Architecture Notes

Read [RAF_PRODUCT_CONSTITUTION.md](RAF_PRODUCT_CONSTITUTION.md) before architecture, persistence, UI, AI, or financial-logic changes.

## Request Flow

```text
React/Vite
-> RAF Node/Express API
-> authenticated identity
-> workspace membership
-> domain services
-> persistence adapter
-> Postgres
-> RLS defense in depth
```

Authentication answers who the user is. RAF authorization answers what the user may do in a workspace.

See [tenant-security.md](tenant-security.md) for the provider-neutral tenant security model.

## Workspace Naming Convention

Use `workspaceId` for authentication, authorization, tenant isolation, and infrastructure.

Use `household` for consumer-facing financial language and legacy compatibility where the model genuinely represents a household.

Do not do a giant rename. Classify usages before changing them:

- A: consumer/domain language where household is correct
- B: legacy persistence compatibility
- C: tenant authorization context that should become workspace terminology
- D: financial domain records that genuinely represent a household

## Postgres Compatibility Adapter

[lib/server/postgresDb.js](../lib/server/postgresDb.js) is a compatibility adapter. It loads `raf.*.raw_json` rows into the in-memory RAF adapter inside a database transaction, runs existing domain behavior, then flushes row diffs back to Postgres.

This preserves financial behavior while migrations and RLS mature, but it is transitional.

Risks:

- full-table hydration cost per transaction
- write amplification across all known tables
- lost-update risk under concurrent API instances
- memory growth for large workspaces
- limited ability to use targeted SQL indexes for hot paths
- coarse conflict detection

Highest-risk operations:

- allocation category replacement
- surplus split replacement
- import approval/classification
- account reconciliation
- transaction creation under high concurrency

Migration target:

- direct repository SQL for workspace memberships, transactions, financial accounts, imports, and allocation configuration
- explicit optimistic locks or idempotency keys on high-risk writes
- no financial calculations in route handlers

## Test Policy

Authorization-sensitive route tests should go through the production router or a helper that models:

```text
authenticated identity -> workspace membership -> trusted workspace context
```

Domain/service unit tests may construct trusted context directly, but that should be obvious from the fixture name. A raw `x-workspace-id` or `x-household-id` header is never authorization.
