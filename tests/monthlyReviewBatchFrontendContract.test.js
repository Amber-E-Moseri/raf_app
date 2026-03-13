import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("monthly review page exposes a mass apply range flow", async () => {
  const [apiSource, pageSource] = await Promise.all([
    readFile(new URL("../src/api/monthlyReviewApi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MonthlyReview.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(apiSource, /export async function applyMonthlyReviewsInRange\(/);
  assert.match(pageSource, /title="Mass Apply Review"/);
  assert.match(pageSource, /await applyMonthlyReviewsInRange\(/);
  assert.match(pageSource, /Start month/);
  assert.match(pageSource, /End month/);
});
