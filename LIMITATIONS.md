# Current Limitations

1. Debts are not period-aware in this release.
   Debt balances shown in the UI remain current cumulative balances rather than historical month-end balances.

2. Financial health remains current-month oriented in this release.
   `GET /reports/financial-health` still falls back to the household active month and has not been fully migrated to explicit period parameters yet.

3. Bank statement import uses statement transaction dates, not the currently viewed period.
   Viewing an older month does not override the actual transaction month ownership of imported rows.

4. Allocation history is read-only.
   Users can inspect historical allocation snapshots, but they cannot restore an older snapshot as the current configuration in this release.
