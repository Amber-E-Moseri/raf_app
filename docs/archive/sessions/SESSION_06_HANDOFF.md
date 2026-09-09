# Session 06 Handoff — Phase 6: RAF Engine & Core Reports

## Scope

- Module `computeDepositAllocations(amount, categories)` — per §5 rounding: floor(amount * percent * 100)/100 per row; remainder cents to slug `buffer`.
- `GET /api/v1/reports/income-allocations?depositId=` — load deposit + household categories; return per-category dollar split.
- `GET /api/v1/reports/month-income-total?year=&monthLabel=` — SUM income for month; `{ total }`.
- `GET /api/v1/reports/dashboard?year=` — per calendar month: incomeTotal, actualSpentTotal (sum spending actualSpent SPEND), surplusOrDeficit (income - spent simplified per §3.8), savingsActual (SUMIFS category Savings or slug savings—match template).
- Unit tests: March 10000 with template percents → Savings 1000; sum of splits equals 10000; remainder to buffer.

## Reference

- `specs/raf_multi_income_debt_spec.md` — §3.8 first three rows, §5 Rounding, §6 steps 3–4, §7 RAF engine.

## Prerequisites (from Phase 5)

- Income + spending + allocations.

## Env Vars

Phase 1.

## Key Paths

| Path | Action |
|------|--------|
| `lib/raf/compute-deposit-allocations.ts` | rounding + buffer remainder |
| `app/api/v1/reports/income-allocations/route.ts` | GET |
| `app/api/v1/reports/month-income-total/route.ts` | GET |
| `app/api/v1/reports/dashboard/route.ts` | GET |
| `__tests__/` or `*.test.ts` | RAF rounding |

## Gotchas

- Dashboard “savingsActual” must match Monthly Tracker aggregation for category matching Savings label.

## Completed Checklist

- [ ] computeDepositAllocations unit tested vs Excel sample
- [ ] GET income-allocations by depositId
- [ ] GET month-income-total
- [ ] GET dashboard for year
- [ ] Demo step 3–4 verifiable via API

## Next Session (Phase 7)

Phase 7: snapshot-periods, financial-health, surplus-recommendations + alert states §4.3.
