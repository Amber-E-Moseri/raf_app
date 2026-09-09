# HANDOFF_PROMPTS — RAF Multi-Income & Debt MVP

Copy the block for each phase into a new agent session in order. Repo root: `/Users/jason/Documents/Numbers/Courses/Resources/Work/finance app`. Spec: `specs/raf_multi_income_debt_spec.md`.

---

## Prompt — Phase 1: Schema, Scaffold & Auth

```
Implement Phase 1: Schema, Scaffold & Auth for RAF Multi-Income & Debt. The repo root is `/Users/jason/Documents/Numbers/Courses/Resources/Work/finance app`.

Step 1 - Load context in this order:
1. docs/sessions/SESSION_01_HANDOFF.md
2. specs/raf_multi_income_debt_spec.md — §1 Architecture Overview, §2 Data Model, §3.1 Auth, §10 Definition of Done.

Step 2 - Implement only this phase:
- Complete every item in the handoff Completed Checklist.
- Do not add features from later phases.
- Follow spec response envelope, validation, and transaction conventions exactly.

Step 3 - Update handoff docs before finishing:
1. In docs/sessions/SESSION_01_HANDOFF.md, mark completed items and add Key Files + Gotchas Encountered.
2. In docs/sessions/SESSION_02_HANDOFF.md, update prerequisites, env vars, and gotchas if Phase 1 changed them.

Step 4 - Verify: migrations apply, register/login/me smoke test, dev server starts.

Step 5 - Commit: "Phase 1: schema scaffold auth"

Output: summary of implemented items, files changed, verification outcomes, risks/blockers for next phase.
```

---

## Prompt — Phase 2: Household, RAF Buckets & Surplus Splits

```
Implement Phase 2: Household, RAF Buckets & Surplus Splits for RAF Multi-Income & Debt. The repo root is `/Users/jason/Documents/Numbers/Courses/Resources/Work/finance app`.

Step 1 - Load context in this order:
1. docs/sessions/SESSION_02_HANDOFF.md
2. specs/raf_multi_income_debt_spec.md — §2 Data Model (Household, AllocationCategory, SurplusSplit), §3.2–3.4, §5 concurrency allocation sum, §6 Demo defaults.

Step 2 - Implement only this phase:
- Complete every item in the handoff Completed Checklist.
- Do not add features from later phases.
- Follow spec response envelope, validation, and transaction conventions exactly.

Step 3 - Update handoff docs before finishing:
1. In docs/sessions/SESSION_02_HANDOFF.md, mark completed items and add Key Files + Gotchas Encountered.
2. In docs/sessions/SESSION_03_HANDOFF.md, update prerequisites, env vars, and gotchas.

Step 4 - Verify: GET/PUT allocation and surplus with sum validation; PATCH household periodStartDay bounds.

Step 5 - Commit: "Phase 2: household allocation surplus"

Output: summary of implemented items, files changed, verification outcomes, risks/blockers for next phase.
```

---

## Prompt — Phase 3: Income Deposits

```
Implement Phase 3: Income Deposits for RAF Multi-Income & Debt. The repo root is `/Users/jason/Documents/Numbers/Courses/Resources/Work/finance app`.

Step 1 - Load context in this order:
1. docs/sessions/SESSION_03_HANDOFF.md
2. specs/raf_multi_income_debt_spec.md — §3.5, §5 Idempotency, §6 step 3.

Step 2 - Implement only this phase:
- Complete every item in the handoff Completed Checklist.
- Do not add features from later phases.
- Follow spec response envelope, validation, and transaction conventions exactly.

Step 3 - Update handoff docs before finishing:
1. In docs/sessions/SESSION_03_HANDOFF.md, mark completed items and add Key Files + Gotchas Encountered.
2. In docs/sessions/SESSION_04_HANDOFF.md, update prerequisites, env vars, and gotchas.

Step 4 - Verify: GET by month, POST, Idempotency-Key duplicate, PATCH, DELETE.

Step 5 - Commit: "Phase 3: income deposits"

Output: summary of implemented items, files changed, verification outcomes, risks/blockers for next phase.
```

---

## Prompt — Phase 4: Spending Lines

```
Implement Phase 4: Spending Lines for RAF Multi-Income & Debt. The repo root is `/Users/jason/Documents/Numbers/Courses/Resources/Work/finance app`.

Step 1 - Load context in this order:
1. docs/sessions/SESSION_04_HANDOFF.md
2. specs/raf_multi_income_debt_spec.md — §3.6, §4.2 payment inference.

Step 2 - Implement only this phase:
- Complete every item in the handoff Completed Checklist.
- Do not add features from later phases.
- Follow spec response envelope, validation, and transaction conventions exactly.

Step 3 - Update handoff docs before finishing:
1. In docs/sessions/SESSION_04_HANDOFF.md, mark completed items and add Key Files + Gotchas Encountered.
2. In docs/sessions/SESSION_05_HANDOFF.md, update prerequisites, env vars, and gotchas.

Step 4 - Verify: CRUD spending lines filtered by year and monthLabel.

Step 5 - Commit: "Phase 4: spending lines"

Output: summary of implemented items, files changed, verification outcomes, risks/blockers for next phase.
```

---

## Prompt — Phase 5: Debts & Payoff Ledger

```
Implement Phase 5: Debts & Payoff Ledger for RAF Multi-Income & Debt. The repo root is `/Users/jason/Documents/Numbers/Courses/Resources/Work/finance app`.

Step 1 - Load context in this order:
1. docs/sessions/SESSION_05_HANDOFF.md
2. specs/raf_multi_income_debt_spec.md — §3.7, §4.2, §9 Debt payoff linkage default.

Step 2 - Implement only this phase:
- Complete every item in the handoff Completed Checklist.
- Do not add features from later phases.
- Follow spec response envelope, validation, and transaction conventions exactly.

Step 3 - Update handoff docs before finishing:
1. In docs/sessions/SESSION_05_HANDOFF.md, mark completed items and add Key Files + Gotchas Encountered.
2. In docs/sessions/SESSION_06_HANDOFF.md, update prerequisites, env vars, and gotchas.

Step 4 - Verify: GET debts summary; POST debt; POST Debt Payoff spending reduces remaining.

Step 5 - Commit: "Phase 5: debts ledger"

Output: summary of implemented items, files changed, verification outcomes, risks/blockers for next phase.
```

---

## Prompt — Phase 6: RAF Engine & Core Reports

```
Implement Phase 6: RAF Engine & Core Reports for RAF Multi-Income & Debt. The repo root is `/Users/jason/Documents/Numbers/Courses/Resources/Work/finance app`.

Step 1 - Load context in this order:
1. docs/sessions/SESSION_06_HANDOFF.md
2. specs/raf_multi_income_debt_spec.md — §3.8 (income-allocations, month-income-total, dashboard), §5 Rounding, §6 steps 3–4, §7 RAF engine.

Step 2 - Implement only this phase:
- Complete every item in the handoff Completed Checklist.
- Do not add features from later phases.
- Follow spec response envelope, validation, and transaction conventions exactly.

Step 3 - Update handoff docs before finishing:
1. In docs/sessions/SESSION_06_HANDOFF.md, mark completed items and add Key Files + Gotchas Encountered.
2. In docs/sessions/SESSION_07_HANDOFF.md, update prerequisites, env vars, and gotchas.

Step 4 - Verify: unit tests for 10000 deposit splits; dashboard year endpoint.

Step 5 - Commit: "Phase 6: RAF reports core"

Output: summary of implemented items, files changed, verification outcomes, risks/blockers for next phase.
```

---

## Prompt — Phase 7: Snapshot, Financial Health & Surplus Recommendations

```
Implement Phase 7: Snapshot, Financial Health & Surplus Recommendations for RAF Multi-Income & Debt. The repo root is `/Users/jason/Documents/Numbers/Courses/Resources/Work/finance app`.

Step 1 - Load context in this order:
1. docs/sessions/SESSION_07_HANDOFF.md
2. specs/raf_multi_income_debt_spec.md — §3.8 (snapshot-periods, financial-health, surplus-recommendations), §4.3, §9 Buffer formula, §6 steps 7–8.

Step 2 - Implement only this phase:
- Complete every item in the handoff Completed Checklist.
- Do not add features from later phases.
- Follow spec response envelope, validation, and transaction conventions exactly.

Step 3 - Update handoff docs before finishing:
1. In docs/sessions/SESSION_07_HANDOFF.md, mark completed items and add Key Files + Gotchas Encountered.
2. In docs/sessions/SESSION_08_HANDOFF.md, update prerequisites, env vars, and gotchas.

Step 4 - Verify: three report endpoints return stable JSON; alertStatus matches §4.3.

Step 5 - Commit: "Phase 7: snapshot health surplus reports"

Output: summary of implemented items, files changed, verification outcomes, risks/blockers for next phase.
```

---

## Prompt — Phase 8: Seed, Observability & Demo Completion

```
Implement Phase 8: Seed, Observability & Demo Completion for RAF Multi-Income & Debt. The repo root is `/Users/jason/Documents/Numbers/Courses/Resources/Work/finance app`.

Step 1 - Load context in this order:
1. docs/sessions/SESSION_08_HANDOFF.md
2. specs/raf_multi_income_debt_spec.md — §6 Demo Script, §6 Seed, §10 Definition of Done, §1 Observability.

Step 2 - Implement only this phase:
- Complete every item in the handoff Completed Checklist.
- Do not add features outside spec.
- Follow spec response envelope, validation, and transaction conventions exactly.

Step 3 - Update handoff docs before finishing:
1. In docs/sessions/SESSION_08_HANDOFF.md, mark completed items and add Key Files + Gotchas Encountered.

Step 4 - Verify: full §6 demo via API; README complete; seed runs.

Step 5 - Commit: "Phase 8: seed demo observability"

Output: summary of implemented items, files changed, verification outcomes, MVP readiness note.
```
