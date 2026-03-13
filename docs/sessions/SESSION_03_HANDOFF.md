# Session 03 Handoff — Phase 3: Income Deposits

## Scope

- `GET /api/v1/income-deposits?year=&monthLabel=` — required query; list + `totalForQuery`; pagination `cursor`, `limit=50` default; 400 if year/month missing or invalid MonthLabel.
- `POST /api/v1/income-deposits` — body `{ sourceName, monthLabel, year, amount }`; Zod; reject negative amount; optional header `Idempotency-Key`: same key + same body returns same created id (store idempotency record in DB or Redis; MVP in-memory acceptable only for single instance—prefer DB table `IdempotencyRecord`).
- `PATCH /api/v1/income-deposits/:id` — scoped to household; 404 cross-tenant.
- `DELETE /api/v1/income-deposits/:id` — 204.

## Reference

- `specs/raf_multi_income_debt_spec.md` — §3.5, §5 Idempotency note, §6 step 3.

## Prerequisites (from Phase 2)

- JWT; Household; allocation categories available for later report splits.

## Env Vars

Phase 1 vars only.

## Key Paths

| Path | Action |
|------|--------|
| `app/api/v1/income-deposits/route.ts` | GET, POST |
| `app/api/v1/income-deposits/[id]/route.ts` | PATCH, DELETE |
| `prisma/schema.prisma` | add IdempotencyRecord if used |

## Gotchas

- amount as Decimal; JSON response string.
- Idempotency: normalize body JSON for hash comparison.

## Completed Checklist

- [ ] GET with year + monthLabel returns items + totalForQuery
- [ ] POST creates deposit; validates MonthLabel enum
- [ ] POST Idempotency-Key duplicate returns same resource
- [ ] PATCH/DELETE household-scoped
- [ ] Pagination on GET

## Next Session (Phase 4)

Phase 4: Spending lines CRUD.
