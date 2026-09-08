# RAF Financial Accounts

Read [RAF_PRODUCT_CONSTITUTION.md](RAF_PRODUCT_CONSTITUTION.md) before changing account, transaction, import, reconciliation, or financial-calculation behavior.

## Product Constraint

Accounts are stewardship infrastructure. They organize where financial activity happened and support reconciliation, imports, and future bank connectivity. They do not change RAF's allocation lifecycle or make RAF a bank-feed dashboard.

## Current State

Before this phase, RAF transactions and imports were workspace-scoped but accountless. Imported statement rows preserved source details and optional balance-after-transaction values, but there was no account model to explain which real account the statement represented.

## Added Architecture

`financial_accounts` is a tenant-owned workspace table with:

- account identity, type, institution, currency, manual/connected flag, and status
- recorded `current_balance` and optional `available_balance`
- `balance_as_of` so balances are time-bound rather than silently overwritten

Transactions, import batches, raw imported rows, and reviewed imported transactions now accept nullable `account_id`. Null is intentional for historical records that predate accounts or activity whose source account is unknown.

## Account Types

RAF supports:

- `checking`
- `savings`
- `credit_card`
- `line_of_credit`
- `loan`
- `investment`
- `cash`
- `other`

Code should not assume these behave the same. Credit accounts, cash, loans, and investment accounts have different balance meanings and future connection semantics.

## Reconciliation

Reconciliation compares:

```text
recorded balance
vs
statement/reported balance
= discrepancy
```

Creating a reconciliation stores the recorded balance, reported balance, discrepancy, source, timestamp, and note. Resolving a reconciliation records the user's action. RAF updates the account balance only when the user explicitly chooses `accept_reported_balance`.

This keeps balance changes explainable and reviewable instead of allowing imports or integrations to overwrite financial truth silently.

## Import Flow

The target import workflow is:

```text
Upload -> Identify/select account -> Parse -> Normalize -> Detect duplicates -> Preview -> Confirm -> Import -> Reconcile -> Recalculate RAF plan
```

This phase wires account identity into upload, imported rows, reviewed imported transactions, and resulting RAF transactions. AI-parsed rows still pass through deterministic normalization and validation before records are created.

## Migration Strategy

The Postgres migration is additive:

- create `raf.financial_accounts`
- create `raf.account_reconciliations`
- add nullable `account_id` columns to transaction/import tables
- add workspace-led indexes
- enable RLS using existing workspace-membership helper functions

No destructive rename or forced backfill is performed. Historical transactions remain valid with `account_id = NULL`.

## Remaining Risks

- Production UI still needs account selection and reconciliation review screens.
- Existing imported statement balances can inform reconciliation, but automatic reconciliation proposals are not yet implemented.
- Account deletion should remain rare; archive/close is safer for auditability.
- Connected-bank ingestion should insert normalized rows through this same import/review/reconciliation path.
