# Postgres Repository Migration

Read `docs/RAF_PRODUCT_CONSTITUTION.md` before changing persistence behavior. This migration preserves RAF's deterministic financial behavior and keeps the Node/Express API as the application boundary.

## Target Flow

```text
route
-> authentication
-> workspace authorization
-> domain service
-> repository method
-> PostgreSQL
```

The legacy Postgres compatibility adapter remains available for domains that have not moved to targeted SQL. It now hydrates state lazily only when an unmigrated repository method is requested inside a transaction.

## Current Boundary

| Domain | Current persistence | Target | Status | Global lock required? |
| --- | --- | --- | --- | --- |
| Transactions | Direct SQL methods on the Postgres transaction proxy | Direct SQL | In progress | No for direct transaction create/list/get/update/delete; yes if the same operation calls legacy import/allocation helpers |
| Accounts | Direct SQL methods on the Postgres transaction proxy | Direct SQL | In progress | No |
| Membership | Direct SQL methods on the Postgres transaction proxy | Direct SQL | In progress | No |
| Imports | Compatibility adapter | Direct SQL | Future | Yes |
| Allocation | Compatibility adapter | Direct SQL | Future | Yes |
| Income | Compatibility adapter | Direct SQL | Future | Yes |
| Debts | Compatibility adapter, with direct debt-payment helpers needed by transaction lifecycle | Direct SQL | Future | Yes for full debt domain |
| Goals | Compatibility adapter | Direct SQL | Future | Yes |
| Monthly review | Compatibility adapter | Direct SQL | Future | Yes |
| Remi | Compatibility adapter via domain services/tools | Domain-service-backed direct repositories | Future | Yes when tools call legacy domains |

## Implementation Notes

- `lib/server/postgresDb.js` opens one PostgreSQL transaction per RAF operation and sets provider-neutral transaction-local RLS context with `set_config(..., true)`.
- Critical-path methods for transactions, financial accounts/reconciliations, and workspace membership use tenant-scoped SQL predicates.
- Unknown methods fall back to the compatibility adapter. The fallback takes the existing `raf.postgres_compatibility_adapter` advisory transaction lock, hydrates `raw_json`, executes the legacy in-memory adapter operation, then flushes diffs before commit.
- There is no silent dual-write mode. A method either executes direct SQL or triggers the explicit legacy fallback.

## Risks

- Transaction delete still falls back to the import repository when reopening linked imported rows. That keeps behavior compatible but can still hydrate legacy state for imported transactions.
- Transaction creation with linked debts/goals may call legacy debt/goal validation until those repositories move to targeted SQL.
- The direct methods still preserve `raw_json` compatibility. Later migrations should reduce reliance on `raw_json` as typed SQL repositories become authoritative.
- Runtime Postgres integration should be used to prove rollback, RLS, and concurrency behavior against a real database; source-level tests only prevent accidental removal of this boundary.
