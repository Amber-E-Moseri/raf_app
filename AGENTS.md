# AGENTS.md

This project is **raf-platform** — a deposit-driven financial allocation system.

## Authoritative Spec
`/specs/raf_multi_income_debt_spec.md` is the single source of truth.
Read the relevant section before implementing any feature.

## Tech Stack
- Frontend: Next.js 14 App Router, TypeScript strict
- Backend: Supabase Edge Functions + Row Level Security
- Database: PostgreSQL via Supabase (raw SQL migrations, no Prisma)
- Auth: Supabase Auth — Google OAuth only
- Validation: Zod on every write path
- Hosting: Vercel
- Error tracking: Sentry

## Financial Logic Rules
- All money: `Decimal(12,2)`. API always returns money as string decimals e.g. `"1250.00"`
- Allocation percentages (`allocation_percent`) stored as fractions: `0.1000 = 10%`
- Active allocation percents must sum to `1.0000 ± 0.0001` — enforce on every write
- Surplus split percents must also sum to `1.0000 ± 0.0001`
- Rounding remainder on allocations → always routes to `buffer` slug
- Rounding remainder on surplus splits → always routes to `emergency_fund` slug
- Debt balances are **derived** from payment history — never stored or manually edited
- `income_allocations` rows are **immutable** after creation; editing an income entry deletes and recreates them inside a transaction

## Write Pipeline Order (enforced)
```
Client → Zod Validation → RLS Authorization → DB Transaction → RAF Engine → Write → Response
```
Never skip steps. Never perform financial mutations outside a DB transaction.

## Code Organization
- All deterministic financial logic lives in `lib/raf/` — never in route handlers or components
- Import pipeline logic lives in `lib/imports/`
- Merchant rule matching lives in `lib/merchant-rules/`

## Security
- Supabase RLS is the authorization layer — all household tables are scoped by `household_id`
- Cross-household queries are forbidden at every layer
- No secrets in logs — structured JSON logging only (Pino-compatible)

## Never Do
- Do not cache derived financial values in MVP — always compute from live DB rows
- Do not allow `period_start_day` values of 29, 30, or 31
- Do not allow DELETE on a debt that has payments — return 422, suggest `isActive = false`
- Do not allow negative amounts except `direction = 'credit'` transactions
- Do not put financial calculations in route handlers or React components
