# Session 04 Handoff — Phase 4: Spending Lines

## Scope

- `GET /api/v1/spending-lines?year=&monthLabel=` — list + pagination.
- `POST /api/v1/spending-lines` — `{ monthLabel, year, categoryLabel, description?, budgeted, actualSpent, transactionType?, debtName?, status? }`; TransactionType enum SPEND | TRANSFER_IN; reject negative budgeted/actualSpent where invalid.
- `PATCH` / `DELETE` by id household-scoped.
- No DebtPaymentLedger write in this phase unless Phase 5 requests hook; Phase 5 will reconcile Debt Payoff lines.

## Reference

- `specs/raf_multi_income_debt_spec.md` — §3.6, §4.2 payment inference text.

## Prerequisites (from Phase 3)

- Income deposits live.

## Env Vars

Phase 1.

## Key Paths

| Path | Action |
|------|--------|
| `app/api/v1/spending-lines/route.ts` | GET, POST |
| `app/api/v1/spending-lines/[id]/route.ts` | PATCH, DELETE |

## Gotchas

- categoryLabel free text; match Debt Payoff label exactly as allocation category label for ledger sync in Phase 5.

## Completed Checklist

- [ ] GET spending-lines filtered by year + monthLabel
- [ ] POST validates enum + decimals
- [ ] PATCH/DELETE scoped to household
- [ ] Pagination

## Next Session (Phase 5)

Phase 5: Debts API + remaining balance from startingBalance minus payments (ledger + SpendingLine Debt Payoff).
