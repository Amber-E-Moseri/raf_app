import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Dashboard Start Here onboarding is gated by fresh workspace activity and per-workspace dismissal', async () => {
  const source = await readFile(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');

  assert.match(source, /title="Start Here"/);
  assert.match(source, /Log income/);
  assert.match(source, /Track spending/);
  assert.match(source, /Review surplus/);
  assert.match(source, /data\.incomeCount === 0 && data\.recentTransactions\.length === 0 && !startHereDismissed/);
  assert.match(source, /raf:start-here-dismissed:\$\{workspaceId\}/);
  assert.match(source, /localStorage\.setItem\(onboardingDismissalKey\(workspaceId\), "true"\)/);
  assert.match(source, /to: "\/income\/new"/);
  assert.match(source, /to: "\/transactions"/);
  assert.match(source, /to: "\/monthly-review"/);
});
