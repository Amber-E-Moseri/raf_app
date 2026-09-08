# RAF Stabilization Test Regression Audit

Date: 2026-09-05

Read this with `docs/RAF_PRODUCT_CONSTITUTION.md`, `docs/architecture.md`, `docs/tenant-security.md`, and `docs/architecture/postgres-repository-migration.md`.

## Baseline

Initial local baseline captured during this stabilization pass:

| Metric | Count |
| --- | ---: |
| Tests | 344 |
| Suites | 6 |
| Passing | 282 |
| Failing | 61 |
| Skipped | 1 |

Final cleaned local baseline:

| Metric | Count |
| --- | ---: |
| Tests | 395 |
| Suites | 6 |
| Passing | 393 |
| Failing | 0 |
| Skipped | 2 |

Command:

```powershell
npm.cmd test
```

The skipped tests are the live PostgreSQL RLS integration gates. They require `DATABASE_URL`, `RAF_CONFIRM_NON_PRODUCTION_DB=true`, and `RAF_RUN_POSTGRES_RLS_TESTS=true` against a disposable non-production PostgreSQL database.

## Failure Classification

| Test group | Failure count | Classification | Root cause | Fix | Production code changed? |
| --- | ---: | --- | --- | --- | --- |
| Allocation categories | 6 direct, plus route fallout | B/D | Tests and fixtures expected an older default category set and omitted `partnership`, making active allocation totals invalid. | Updated fixtures/assertions to the current documented stewardship category set and valid `1.0000` totals. | No |
| Bank statement imports | 14 plus BMO parser file | A/D | Parser missed deterministic text/PDF layouts, including ISO starts, collapsed headers, and BMO collapsed amount+balance rows; one test used the wrong runner style. | Strengthened deterministic parser paths, added BMO collapsed amount handling, fixed test runner usage, and preserved deterministic validation before persistence. | Yes |
| Income snapshot tests | 3 | D/B | Snapshot replacement fixtures omitted the current required `partnership` category. | Refreshed allocation fixtures to valid current category sets. | No |
| Debts | 6 | A/B/D | Debt month/status logic used wall-clock cycle dates for historical active months, auto-generated charges for rows without `createdAt`, and one stress assertion contradicted planned-payment payoff semantics. | Made debt cycle/status calculations active-month deterministic, avoided generated charges on legacy rows without a creation timestamp, and updated stale stress expectation. | Yes |
| Financial accounts/reconciliation | 0 focused after prior hardening | A fixed | Reconciliation validation previously rejected omitted optional `note` before tenant-scoped account lookup. | Fixed nullable boundary schema; workspace/account integrity remains enforced. | Yes |
| Goals | 4 direct, plus route fallout | B | Tests expected older bucket/progress fields and an undefined helper. | Updated expectations to current goal-progress contract and repaired fixtures. | No |
| Imported transaction review | 1 direct, plus route fallout | D/B | Positive imported income fixture reached allocation calculation with categories lacking `allocationPercent`. | Provided valid allocation fixtures while keeping classify-only paths account-optional and confirmed import paths account/workspace-scoped. | No |
| API compatibility route tests | 19 | D/E | Broad route tests reused stale fixtures and therefore failed through allocation, debt, goal, import, and monthly-review dependencies. | Fixed underlying fixtures/contracts and restored backward-compatible surplus-rule bucket fallback. | Yes |
| Frontend contract tests | 4 | B/E | Source-grep/string-contract tests were stale after UI/app wiring refactors. | Updated brittle checks to current component/API contracts without changing user-facing financial behavior. | No |
| Period runtime tests | 1 | D | Node test could not execute TypeScript frontend helpers directly. | Added a small esbuild-backed helper to load TS modules in Node tests. | No |
| Trajectory | 2 | D | Fixture debt payment lacked `paymentDate`, so period-aware debt derivation correctly ignored it. | Added a realistic payment date to the fixture. | No |
| Temporary parser test | 1 counted test, data-minimization risk | D | Root-level `tmp-parser-test.js` was accidentally included by `node --test` and printed parsed statement rows. | Deleted the temporary test artifact. | No |
| Collaboration/workspace security | 0 focused | Security guard green locally | Existing collaboration and tenant tests pass with local authenticated router setup. | Kept tests in the normal gate. | No |
| PostgreSQL RLS integration | 2 skipped | C | Live PostgreSQL credentials and explicit non-production confirmation were not configured. | Harness remains in suite and is skipped unless the required env vars are present. Do not claim DB-level RLS validation until executed. | Yes |

## Focused Verification

| Command | Result |
| --- | --- |
| `node --test tests\allocationCategories.test.js tests\bankStatementImports.test.js tests\bmoParserCollapsedAmounts.test.js` | Passing |
| `node --test tests\createIncome.test.js tests\importedTransactionReview.test.js` | Passing |
| `node --test tests\liveApi.test.js` | 21 passing |
| `node --test tests\goals.test.js tests\goalsFrontendContract.test.js tests\importedTransactionReviewFrontendContract.test.js tests\monthlyReviewBatchFrontendContract.test.js tests\periodFrontendContract.test.js tests\period.test.js` | Passing |
| `node --test tests\debts.test.js` | 19 passing |
| `node --test tests\merchantRulesAndTrajectory.test.js tests\trajectory.test.js tests\trajectoryEngine.unit.test.js` | 9 passing |
| `npm.cmd test` | 395 tests, 393 passing, 0 failing, 2 skipped |

## Files Modified In This Stabilization Pass

- `lib/imports/bankStatementImports.js`
- `lib/monthlyReviews/applyMonthlyReview.js`
- `lib/monthlyReviews/monthlyReviews.js`
- `lib/raf/debts.js`
- `tests/allocationCategories.test.js`
- `tests/bmoParserCollapsedAmounts.test.js`
- `tests/createIncome.test.js`
- `tests/debts.test.js`
- `tests/goals.test.js`
- `tests/goalsFrontendContract.test.js`
- `tests/importedTransactionReview.test.js`
- `tests/importedTransactionReviewFrontendContract.test.js`
- `tests/liveApi.test.js`
- `tests/merchantRulesAndTrajectory.test.js`
- `tests/monthlyReviewBatchFrontendContract.test.js`
- `tests/period.test.js`
- `tests/periodFrontendContract.test.js`
- `tests/trajectory.test.js`
- `tests/helpers/loadTsModule.js`
- `docs/stabilization/test-regression-audit.md`

Prior security and persistence-hardening work in the same broader branch also touched Postgres adapter, Remi context, logging, environment validation, and security documentation.

## Financial Semantics Changed

No intentional product-level financial semantics changed.

Production fixes clarified existing intended behavior:

- Debt balances remain derived from starting balance, payments, and auditable adjustments.
- Debt cycle dates and payment status are evaluated against RAF's active period, not the wall clock.
- Auto-generated debt charges are not synthesized for legacy debt rows missing `createdAt`.
- Payoff trajectory continues to use planned future `monthlyPayment` against the current derived balance.
- Legacy bucket surplus rules without explicit destination fields default to their own slug, while confirmed review transactions still require a resolvable allocation bucket.

## Remaining Failures

None in the normal local suite.

## Remaining Gated Tests

- `tests/postgresRlsIsolation.integration.test.js`: 2 tests skipped unless live non-production PostgreSQL validation is explicitly enabled with the required env vars.

## Unresolved Architectural Concerns

- Real PostgreSQL RLS isolation is still not validated in this local run.
- The Postgres compatibility adapter still supports legacy `raw_json` fallback for unmigrated domains.
- Import parser diagnostic logging is sanitized, but remains noisy in the test runner and should move behind a debug flag before production observability work is closed.
- Remi tool handlers still need continued consolidation around explicit deterministic context builders as additional domains migrate to direct repositories.
