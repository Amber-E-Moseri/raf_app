import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("monthly review frontend uses the apply endpoint and helper", async () => {
  const [apiSource, pageSource] = await Promise.all([
    readFile(new URL("../src/api/monthlyReviewApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MonthlyReview.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(apiSource, /postJson<ApplyMonthlyReviewResponse>\("\/monthly-reviews\/apply", payload\)/);
  assert.match(pageSource, /import \{ applyMonthlyReview \} from "\.\.\/api\/monthlyReviewApi"/);
  assert.match(pageSource, /await applyMonthlyReview\(\{/);
});
