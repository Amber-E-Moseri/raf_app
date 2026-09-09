# Session 08 Handoff — Phase 8: Seed, Observability & Demo Completion

## Scope

- Prisma seed: user `demo@raf.app` + password (document in README dev only); Household with template allocation + surplus; March 2025 income deposit 10000 Salary.
- Pino logger on API routes; log validation failures and 5xx; never log secrets or full JWT.
- README: clone, `pnpm install`, `cp .env.example`, `prisma migrate dev`, `prisma db seed`, `pnpm dev`, demo login, curl examples for §6 demo script.
- Manual or automated run through §6 Demo Script; mark §10 Definition of Done items complete in README or checklist.
- Optional: Sentry DSN env documented as no-op if unset.

## Reference

- `specs/raf_multi_income_debt_spec.md` — §6 Demo Script, §6 Seed, §10 Definition of Done, §1 Observability.

## Prerequisites (from Phase 7)

- All API routes implemented.

## Env Vars

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | PostgreSQL |
| `JWT_SECRET` | Access |
| `JWT_REFRESH_SECRET` | Refresh |
| `SENTRY_DSN` | Optional |

## Key Paths

| Path | Action |
|------|--------|
| `prisma/seed.ts` | demo user + deposit |
| `.env.example` | all vars |
| `README.md` | full setup + demo |
| `lib/logger.ts` | Pino |

## Gotchas

- Seed password: bcrypt hash in seed; document plain password only in README for local dev.

## Completed Checklist

- [ ] `prisma db seed` runs clean
- [ ] Demo user can login and hit all §6 steps via API
- [ ] Pino on 4xx/5xx paths
- [ ] README matches §10 DoD
- [ ] HANDOFF session 08 marked done; no further session file

## Next Session (Phase 9)

None — MVP handoff complete.
