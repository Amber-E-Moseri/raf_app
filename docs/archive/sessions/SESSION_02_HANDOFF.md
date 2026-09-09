# Session 02 Handoff — Phase 2: Household, RAF Buckets & Surplus Splits

## Scope

- `GET /api/v1/household` — full household fields per spec §3.2; 404 if missing (should not happen post Phase 1).
- `PATCH /api/v1/household` — timezone, periodStartDay (1–28 only), activeMonthLabel, activeYear, savingsFloor, monthlyEssentialsBaseline; 400 if periodStartDay 29–31.
- `GET` + `PUT /api/v1/household/allocation-categories` — full replace body `{ items: [{ slug, label, sortOrder, percent }] }`; PUT rejects if sum ≠ 1 within 0.0001.
- `GET` + `PUT /api/v1/household/surplus-splits` — same sum rule.
- On first GET allocation-categories if zero rows: insert default 9 RAF rows (Savings 0.1, Tithe 0.1, Partnership 0.1, Offerings 0.05, Fixed Bills 0.3, Personal Spending 0.15, Investment 0.1, Debt Payoff 0.05, Buffer 0.05) matching template.
- On first GET surplus-splits if zero rows: insert 4 rows (emergency_fund_savings 0.4, extra_debt_payoff 0.3, investment 0.2, giving_partnership 0.1).
- Prisma transaction on PUT replaces all rows for that household.
- API returns percents as strings for JSON money safety.

## Reference

- `specs/raf_multi_income_debt_spec.md` — §2 AllocationCategory, SurplusSplit, Household; §3.2–3.4; §5 allocation sum; §6 demo defaults.

## Prerequisites (from Phase 1)

- Migrations applied; User + Household on register; JWT middleware for protected routes.

## Env Vars

Same as Phase 1.

## Key Paths

| Path | Action |
|------|--------|
| `app/api/v1/household/route.ts` | GET, PATCH |
| `app/api/v1/household/allocation-categories/route.ts` | GET, PUT |
| `app/api/v1/household/surplus-splits/route.ts` | GET, PUT |
| `lib/defaults/raf-buckets.ts` | default slugs, labels, percents |
| `lib/validation/sum-percent.ts` | sum === 1 check |

## Gotchas

- PUT must delete old rows then create new OR upsert by slug; unique on householdId+slug.
- periodStartDay 29–31 rejected to avoid month-end gaps.

## Completed Checklist

- [ ] GET /household returns household + nested optional aggregates if spec requires
- [ ] PATCH /household validates periodStartDay 1–28
- [ ] GET allocation-categories seeds defaults once
- [ ] PUT allocation-categories transactional replace; 400 if sum ≠ 1
- [ ] GET surplus-splits seeds defaults once
- [ ] PUT surplus-splits transactional replace; 400 if sum ≠ 1
- [ ] All routes JWT-protected; householdId from JWT/session

## Next Session (Phase 3)

Phase 3: Income deposits CRUD + idempotency key on POST.
