# RAF Production Security And Financial Data Threat Model

RAF financial information is highly sensitive. Security work must preserve `docs/RAF_PRODUCT_CONSTITUTION.md`: RAF is a deterministic stewardship and allocation system, not an AI source of financial truth.

## Architecture Diagram

```text
React/Vite
-> RAF Node/Express API
-> authentication context
-> workspace membership + permission check
-> domain/application service
-> persistence boundary
-> PostgreSQL
-> RLS defense in depth
```

## Module Dependency Map

```text
app/api/v1/*
-> lib/<domain> services
-> lib/raf deterministic engines
-> lib/server/db adapters

src/pages + src/components
-> src/api clients
-> RAF API

lib/remi/*
-> Remi tools/context builders
-> RAF report/domain services
-> AI provider only after deterministic context minimization

platform concerns:
auth -> routerLoader/workspace context
database -> lib/server/*
email -> lib/email/*
ai -> lib/remi/* and lib/imports/aiPdfParser.js
security -> permissions, tenant security, validation, logging policy
```

## Database Diagram

```text
app_users
  -> workspace_members <- workspaces
                           -> households compatibility row
                           -> financial_accounts
                           -> account_reconciliations
                           -> transactions
                           -> income_entries -> income_allocations
                           -> allocation_categories
                           -> fixed_bills
                           -> debts -> debt_payments/debt_adjustments
                           -> goals
                           -> import_batches -> imported_transaction_rows
                           -> imported_transactions/import_review_rules/merchant_rules
                           -> monthly_reviews
                           -> remi_conversations -> remi_messages
                           -> workspace_activity
```

Tenant-owned tables must carry `workspace_id` and use workspace-led indexes and same-workspace foreign keys where relationships cross tables.

## Tenant-Security Model

Client-provided workspace IDs are selectors only.

```text
authenticated user
-> active workspace membership
-> centralized role/permission check
-> trusted workspace context
-> tenant-scoped query
-> PostgreSQL RLS
```

Required data-access rule:

```sql
where id = $1
and workspace_id = $2
```

Direct object lookup by ID alone is an IDOR risk.

## Financial Calculation Flow

```text
validated request
-> workspace authorization
-> transaction-scoped domain service
-> deterministic RAF engine in lib/raf
-> persistence write
-> formatted API response
```

Financial truth must not be calculated in React components, route handlers, SQL policies, or AI prompts.

## Remi Tool Architecture

```text
user message
-> Remi system prompt
-> tool selection
-> RAF tool handler
-> domain/report service
-> minimized deterministic context/result
-> AI explanation
```

Data minimization rules:

- Do not send entire financial datasets when a summary, aggregate, or bounded top-N list is sufficient.
- Use explicit Remi context builders such as `buildRemiIncomeContext`, `buildRemiSpendingContext`, `buildRemiDebtContext`, and `buildRemiGoalContext`.
- AI may explain or propose; RAF domain logic remains the financial source of truth.

## Sensitive Data Handling

Avoid financial data in:

- client logs
- server logs
- error tracking
- analytics
- URLs
- raw exception responses

Current hardening removes raw PDF statement text, parsed candidate rows, recipient email addresses, and raw subscription exceptions from normal logs.

## Audit Log

Important mutations should be append-oriented and attributable:

- invitation sent/accepted/declined/revoked
- member joined/removed/left
- role changed
- ownership transferred
- import approved/rejected
- transaction/income/debt/monthly-review mutations

Activity metadata must not include passwords, auth tokens, invitation tokens, raw account numbers, or unnecessary financial snapshots.

## Export And Deletion Flows

Required production flows:

- leaving a workspace: allowed for non-owner members; last owner cannot leave
- deleting personal account: revoke sessions, handle owned workspaces, delete or transfer ownership, then delete app user/auth identity
- deleting workspace: owner-only, block or require transfer when multiple members exist, delete tenant-owned financial data transactionally
- subscription cancellation: stop future billing, preserve financial data unless explicit deletion is requested
- financial-data deletion: owner-only, auditable, export offered before deletion
- export: machine-readable JSON and CSV grouped by accounts, transactions, income, allocations, debts, goals, imports, reviews, and activity

Exports are not implemented as a completed production feature in this pass.

## Technical-Debt Register

| Priority | Item | Risk |
| --- | --- | --- |
| P0 | Run real PostgreSQL RLS isolation tests against non-production DB | DB-level isolation is not proven in this environment |
| P0 | Finish local regression triage to green or infra-only failures | Normal test gate remains red |
| P1 | Replace legacy Postgres compatibility fallback for imports/allocation/income/debts/goals | Full-state hydration and write amplification remain |
| P1 | Add centralized sanitized logger | Ad hoc logging can regress into PII/financial leakage |
| P1 | Implement export and deletion workflows | Users need clear data control in production |
| P1 | Add rate limiting for auth, imports, Remi, and webhook endpoints | Abuse/cost risks remain |
| P2 | Replace brittle frontend source-grep tests | Tests fail on implementation shape rather than behavior |
| P2 | Move duplicate Remi/tool summary calculations into domain services | Calculation ownership is still mixed |
| P2 | Add backup/restore runbook and restore drill | Backups are only useful if restorable |
| P3 | Code split large frontend bundle | Build warns about bundle size |

## Recommended Next 10 Engineering Priorities

1. Execute `tests/postgresRlsIsolation.integration.test.js` against disposable non-production PostgreSQL.
2. Finish Stabilization Phase 1 by resolving or separating all 61 remaining local failures.
3. Add rate limiting around auth, Remi, imports, and invitation endpoints.
4. Implement machine-readable exports for workspace financial data.
5. Implement owner-only workspace deletion with export-first UX and transactional data deletion.
6. Complete account deletion flow with membership/ownership invariants.
7. Replace raw `console.*` usage with a sanitized structured logger.
8. Move import repositories off the Postgres compatibility adapter.
9. Move allocation and income repositories off the compatibility adapter.
10. Consolidate dashboard/monthly-review/reports/Remi duplicate financial summaries behind domain services.

## Remaining Risks

- Stripe/webhook hardening could not be fully verified because no Stripe webhook implementation was found in the audited files.
- Database backup policy is not implemented in code; it needs operational documentation and restore testing.
- Real Postgres RLS validation is blocked without database credentials.
- The normal local test gate is still red.

