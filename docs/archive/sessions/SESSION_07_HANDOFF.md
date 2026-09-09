# Session 07 Handoff — Phase 7: Snapshot, Financial Health & Surplus Recommendations

## Scope

- `GET /api/v1/reports/snapshot-periods?fromYear=&toYear=` — build fiscal period rows from periodStartDay; per period: periodLabel string, income (sum income deposits whose month falls in period per MVP calendar rule), per allocation category budgeted/actual/variance, bufferRemaining = max(bufferBudget - bufferActual, 0), netSurplusPreAllocate, netSurplusAfterAllocate, surplusAllocatedToSplits (SUMIFS surplus categories from spending if modeled; else computed from net surplus * surplus splits for display), alertStatus per §4.3 (ok | elevated | risky).
- `GET /api/v1/reports/financial-health` — activeMonthIncome, debtPaymentsMonth (sum spending Debt Payoff actual in active month), debtSustainabilityRatio, generalSavingsBalance (SUMIFS Savings + Transfer In per spec §6 Financial Health sheet), savingsFloor, availableSavings, emergencyFundBalance (description Emergency), monthlyEssentials, emergencyCoverageMonths.
- `GET /api/v1/reports/surplus-recommendations?year=` — per period with netSurplus > 0: splitAmounts by surplus splits; targetDebtName = debt with MAX(remainingBalance); suggestionText deterministic string.

## Reference

- `specs/raf_multi_income_debt_spec.md` — §3.8 remaining reports, §4.3, §9 Buffer formula, §6 steps 7–8.

## Prerequisites (from Phase 6)

- Dashboard and allocations; debts; spending.

## Env Vars

Phase 1.

## Key Paths

| Path | Action |
|------|--------|
| `lib/periods/fiscal-periods.ts` | period list from periodStartDay |
| `app/api/v1/reports/snapshot-periods/route.ts` | GET |
| `app/api/v1/reports/financial-health/route.ts` | GET |
| `app/api/v1/reports/surplus-recommendations/route.ts` | GET |

## Gotchas

- MVP income by calendar month inside period window: define window as months overlapping period label range.
- alertStatus: debtRatio = debtPaymentsMonth / activeMonthIncome empty string if income 0 per template.

## Completed Checklist

- [ ] snapshot-periods returns rows with alertStatus
- [ ] financial-health returns ratio + emergency months
- [ ] surplus-recommendations returns splits + target debt
- [ ] §4.3 thresholds implemented exactly

## Next Session (Phase 8)

Phase 8: Seed, Pino, README completion, full §6 demo script, §10 DoD checklist.
