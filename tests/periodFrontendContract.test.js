import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("app wiring includes the global period provider and month-aware pages", async () => {
  const [appSource, layoutSource, dashboardSource, transactionsSource, monthlyReviewSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/AppLayout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Transactions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MonthlyReview.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /<PeriodProvider>/);
  assert.match(layoutSource, /usePeriod\(\)/);
  assert.match(layoutSource, /setActiveMonth\(option\.value\)/);
  assert.match(layoutSource, /jumpToCurrentMonth\(\)/);
  assert.match(layoutSource, /disabled=\{isCurrentMonth\}/);
  assert.match(layoutSource, /Current month/);
  assert.match(dashboardSource, /usePeriod\(\)/);
  assert.match(dashboardSource, /historical snapshot/);
  assert.match(transactionsSource, /usePeriod\(\)/);
  assert.match(transactionsSource, /isCurrentMonth/);
  assert.match(monthlyReviewSource, /usePeriod\(\)/);
  assert.match(monthlyReviewSource, /jumpToCurrentMonth/);
});
