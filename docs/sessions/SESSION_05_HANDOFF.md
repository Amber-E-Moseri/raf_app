# Session 05 Handoff — Phase 5: Debts & Payoff Ledger

## Scope

- `GET /api/v1/debts` — items with computed remainingBalance, totalPaidYtd (calendar year), optional estMonths; summary `{ totalStarting, totalRemaining, totalPaidYtd }`.
- `POST /api/v1/debts` — name, startingBalance, aprPercent, minimumPayment, monthlyPayment, sortOrder.
- `PATCH` / `DELETE` debts by id.
- When `POST /spending-lines` (or PATCH) has categoryLabel matching household’s Debt Payoff allocation label AND debtName matches a DebtAccount.name: append `DebtPaymentLedger` row amount = actualSpent (SPEND only); remaining = startingBalance - sum(ledger) for that debt.
- If spending line updated/deleted: reconcile ledger for that line (MVP: on POST spending store spendingLineId on ledger optional; or recompute from all spending lines monthly—spec allows ledger on POST).

## Reference

- `specs/raf_multi_income_debt_spec.md` — §3.7, §4.2, §9 Debt payoff linkage default assumption.

## Prerequisites (from Phase 4)

- Spending lines; allocation category label for Debt Payoff known.

## Env Vars

Phase 1.

## Key Paths

| Path | Action |
|------|--------|
| `app/api/v1/debts/route.ts` | GET, POST |
| `app/api/v1/debts/[id]/route.ts` | PATCH, DELETE |
| `lib/debts/reconcile.ts` | ledger from spending lines |
| Spending line handler | call reconcile after write |

## Gotchas

- Debt name match case-sensitive or normalize once in spec—pick one and document.
- Double POST same spending should not double ledger—use spendingLineId unique on ledger optional.

## Completed Checklist

- [ ] GET /debts returns items + summary
- [ ] POST/PATCH/DELETE debts
- [ ] Debt Payoff spending creates or updates ledger entry per debt
- [ ] remainingBalance correct after payments
- [ ] Demo step 5–6: Credit Card 5000 then pay 200 → remaining 4800

## Next Session (Phase 6)

Phase 6: RAF compute module + reports income-allocations, month-income-total, dashboard + unit tests.
