# Session 01 Handoff — Phase 1: Schema, Scaffold & Auth

## Scope

- Create Next.js 14 App Router project with TypeScript strict.
- Add Prisma with PostgreSQL; paste full schema from spec §2 (User, Household, AllocationCategory, SurplusSplit, IncomeDeposit, SpendingLine, DebtAccount, DebtPaymentLedger, enums).
- Run initial migration; Prisma Client generated.
- Implement JWT access + refresh (store refresh in DB or signed JWT refresh per spec; document choice).
- Route handlers under `/api/v1`: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`.
- On register: create User + empty Household (single userId); defer default allocation rows to Phase 2 OR create minimal Household only.
- Zod on auth bodies; 409 duplicate email; 401 on bad login/refresh.
- README stub: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (or single secret + rotation note).

## Reference

- `specs/raf_multi_income_debt_spec.md` — §1 Architecture, §2 Data Model, §3.1 Auth, §10 Definition of Done (Prisma migrated).

## Prerequisites (from Phase 0)

None.

## Env Vars

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | PostgreSQL connection |
| `JWT_SECRET` | Access token signing |
| `JWT_REFRESH_SECRET` | Refresh token signing (or same + aud claim) |

## Key Paths

| Path | Action |
|------|--------|
| `package.json` | deps: next, prisma, bcrypt, zod, jose or jsonwebtoken |
| `prisma/schema.prisma` | full schema |
| `prisma/migrations/` | initial migration |
| `app/api/v1/auth/*/route.ts` | auth routes |
| `lib/auth.ts` | JWT issue/verify |
| `lib/db.ts` | Prisma singleton |
| `README.md` | env + migrate |

## Gotchas

- Household must exist after register for §3.2 onward; create Household in same transaction as User.
- Password hash: bcrypt cost ≥ 10.
- Never log passwords or full tokens.

## Completed Checklist

- [ ] Next.js 14 App Router + TS strict
- [ ] Prisma schema matches spec §2
- [ ] `prisma migrate dev` succeeds
- [ ] POST register returns userId; creates Household
- [ ] POST login returns accessToken, refreshToken, expiresIn
- [ ] POST refresh returns new tokens
- [ ] GET /auth/me with Bearer returns userId, email, householdId
- [ ] README lists env vars and migrate command

## Next Session (Phase 2)

Phase 2 implements GET/PATCH household, default allocation + surplus rows on first GET or register hook, PUT allocation-categories and PUT surplus-splits with sum validation.
