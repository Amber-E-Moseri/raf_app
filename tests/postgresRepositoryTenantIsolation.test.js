/**
 * Branch D Phase 5: Tenant isolation tests for repository-backed Postgres domains.
 *
 * Creates two separate users / workspaces via the live API (Postgres driver),
 * then verifies that each domain's data from Workspace A is invisible to Workspace B.
 *
 * Requires POSTGRES_CONNECTION_STRING to be set (same source as the server under test).
 * Gated so CI / SQLite environments skip gracefully.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const connectionString = process.env.POSTGRES_CONNECTION_STRING ?? '';
const shouldRun = Boolean(connectionString);
const maybeTest = shouldRun ? test : test.skip;

const port = 3199;
const baseUrl = `http://127.0.0.1:${port}`;
const jwtSecret = 'pg-repo-isolation-test-secret-2026';

let serverProcess;
let startupLog = '';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, attempts = 60) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(300);
  }
  throw lastError;
}

async function request(pathname, { method = 'GET', token, workspaceId, headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
      ...headers,
    },
    body,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { status: response.status, data };
}

async function signup(email) {
  const { status, data } = await request('/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Isolate99!', householdName: `${email} Household` }),
  });
  assert.equal(status, 201, `signup failed for ${email}: ${JSON.stringify(data)}`);
  return { token: data.token, workspaceId: data.workspace.id };
}

before(async () => {
  if (!shouldRun) return;

  serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      PERSISTENCE_DRIVER: 'postgres',
      POSTGRES_CONNECTION_STRING: connectionString,
      RAF_AUTH_REQUIRED: 'true',
      JWT_SECRET: jwtSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (chunk) => { startupLog += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { startupLog += chunk.toString(); });

  try {
    await waitForServer(`${baseUrl}/health`);
  } catch (error) {
    serverProcess?.kill('SIGTERM');
    throw new Error(`Server failed to start. Output:\n${startupLog}\n${error.message}`);
  }
});

after(async () => {
  if (!shouldRun || !serverProcess || serverProcess.killed) return;
  await new Promise((resolve) => {
    serverProcess.once('exit', resolve);
    serverProcess.kill('SIGTERM');
    setTimeout(resolve, 5000);
  });
});

// ---------------------------------------------------------------------------
// Allocation categories
// ---------------------------------------------------------------------------

maybeTest('alloc categories: Workspace B sees its own seeded data, not Workspace A replacements', async () => {
  const a = await signup(`alloc-a-${Date.now()}@example.test`);
  const b = await signup(`alloc-b-${Date.now()}@example.test`);

  // Replace alloc categories in Workspace A
  const replacePayload = JSON.stringify({
    items: [
      { slug: 'savings', label: 'Savings', sortOrder: 1, allocationPercent: '0.5000', isActive: true },
      { slug: 'buffer', label: 'Buffer', sortOrder: 9, allocationPercent: '0.5000', isActive: true },
    ],
  });
  const replaced = await request('/api/v1/household/allocation-categories', {
    method: 'PUT',
    token: a.token,
    workspaceId: a.workspaceId,
    headers: { 'content-type': 'application/json' },
    body: replacePayload,
  });
  assert.equal(replaced.status, 200, `replace failed: ${JSON.stringify(replaced.data)}`);

  // Workspace B must still have its own seeded categories (7 items from createWorkspace seed)
  const bCategories = await request('/api/v1/household/allocation-categories', {
    token: b.token,
    workspaceId: b.workspaceId,
  });
  assert.equal(bCategories.status, 200);
  // B should have 7 seeded categories, not 2 from A's replacement
  assert.ok(
    bCategories.data.items.length >= 2 && bCategories.data.items.length !== 2,
    `Workspace B unexpectedly got ${bCategories.data.items.length} categories (expected 7, not A's 2)`,
  );
  // A's workspace_id must not appear in B's response
  const bJson = JSON.stringify(bCategories.data);
  assert.ok(!bJson.includes(a.workspaceId), 'Workspace B response must not leak Workspace A id');
});

// ---------------------------------------------------------------------------
// Surplus split rules
// ---------------------------------------------------------------------------

maybeTest('surplus split rules: Workspace B cannot read Workspace A rules after replace', async () => {
  const a = await signup(`surplus-a-${Date.now()}@example.test`);
  const b = await signup(`surplus-b-${Date.now()}@example.test`);

  // Replace surplus rules in A
  const replacePayload = JSON.stringify({
    items: [
      { slug: 'secret_rule', label: 'Secret', splitPercent: '1.0000', sortOrder: 1, destinationType: 'bucket', destinationBucketSlug: 'savings', isActive: true },
    ],
  });
  const replaced = await request('/api/v1/household/surplus-split-rules', {
    method: 'PUT',
    token: a.token,
    workspaceId: a.workspaceId,
    headers: { 'content-type': 'application/json' },
    body: replacePayload,
  });
  assert.equal(replaced.status, 200, `replace failed: ${JSON.stringify(replaced.data)}`);

  // B's rules must not include A's secret_rule
  const bRules = await request('/api/v1/household/surplus-split-rules', {
    token: b.token,
    workspaceId: b.workspaceId,
  });
  assert.equal(bRules.status, 200);
  const bSlugs = (bRules.data.items ?? []).map((r) => r.slug);
  assert.ok(!bSlugs.includes('secret_rule'), `Workspace B must not see Workspace A's secret_rule; got: ${JSON.stringify(bSlugs)}`);
});

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

maybeTest('income: Workspace B cannot list or see Workspace A income entries', async () => {
  const a = await signup(`income-a-${Date.now()}@example.test`);
  const b = await signup(`income-b-${Date.now()}@example.test`);

  // Create income in Workspace A
  const created = await request('/api/v1/income', {
    method: 'POST',
    token: a.token,
    workspaceId: a.workspaceId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceName: 'A Paycheck', amount: '3000.00', receivedDate: '2026-08-01' }),
  });
  assert.equal(created.status, 201, `income create failed: ${JSON.stringify(created.data)}`);

  // Workspace B listing must return zero items for the same date range
  const bIncome = await request('/api/v1/income?from=2026-08-01&to=2026-08-31', {
    token: b.token,
    workspaceId: b.workspaceId,
  });
  assert.equal(bIncome.status, 200);
  assert.equal(bIncome.data.items.length, 0, `Workspace B must not see Workspace A income; got ${bIncome.data.items.length} items`);
});

maybeTest('income: Workspace B using Workspace A income ID gets 404', async () => {
  const a = await signup(`income-id-a-${Date.now()}@example.test`);
  const b = await signup(`income-id-b-${Date.now()}@example.test`);

  const created = await request('/api/v1/income', {
    method: 'POST',
    token: a.token,
    workspaceId: a.workspaceId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceName: 'A Private', amount: '1000.00', receivedDate: '2026-08-15' }),
  });
  assert.equal(created.status, 201);
  const aIncomeId = created.data.incomeId;

  // Workspace B tries to read A's income by ID
  const bRead = await request(`/api/v1/income/${aIncomeId}`, {
    token: b.token,
    workspaceId: b.workspaceId,
  });
  assert.ok(bRead.status === 404 || bRead.status === 403, `Expected 404/403, got ${bRead.status}`);
});

// ---------------------------------------------------------------------------
// Debts
// ---------------------------------------------------------------------------

maybeTest('debts: Workspace B cannot list Workspace A debts', async () => {
  const a = await signup(`debt-a-${Date.now()}@example.test`);
  const b = await signup(`debt-b-${Date.now()}@example.test`);

  const created = await request('/api/v1/debts', {
    method: 'POST',
    token: a.token,
    workspaceId: a.workspaceId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'A Secret Debt', startingBalance: '5000.00', apr: '19.99', monthlyPayment: '200.00' }),
  });
  assert.equal(created.status, 201, `debt create failed: ${JSON.stringify(created.data)}`);

  const bDebts = await request('/api/v1/debts', {
    token: b.token,
    workspaceId: b.workspaceId,
  });
  assert.equal(bDebts.status, 200);
  assert.equal(bDebts.data.items.length, 0, `Workspace B must not see Workspace A debts; got ${bDebts.data.items.length}`);
});

maybeTest('debts: Workspace B using Workspace A debt ID gets 404', async () => {
  const a = await signup(`debt-id-a-${Date.now()}@example.test`);
  const b = await signup(`debt-id-b-${Date.now()}@example.test`);

  const created = await request('/api/v1/debts', {
    method: 'POST',
    token: a.token,
    workspaceId: a.workspaceId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'A Debt', startingBalance: '1000.00', apr: '5.0', monthlyPayment: '100.00' }),
  });
  assert.equal(created.status, 201);
  const aDebtId = created.data.id ?? created.data.debt?.id;

  const bRead = await request(`/api/v1/debts/${aDebtId}`, {
    token: b.token,
    workspaceId: b.workspaceId,
  });
  assert.ok(bRead.status === 404 || bRead.status === 403, `Expected 404/403, got ${bRead.status}`);
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

maybeTest('goals: Workspace B cannot list Workspace A goals', async () => {
  const a = await signup(`goal-a-${Date.now()}@example.test`);
  const b = await signup(`goal-b-${Date.now()}@example.test`);

  const created = await request('/api/v1/goals', {
    method: 'POST',
    token: a.token,
    workspaceId: a.workspaceId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'A Secret Goal', targetAmount: '10000.00', bucketId: 'savings' }),
  });
  assert.equal(created.status, 201, `goal create failed: ${JSON.stringify(created.data)}`);

  const bGoals = await request('/api/v1/goals', {
    token: b.token,
    workspaceId: b.workspaceId,
  });
  assert.equal(bGoals.status, 200);
  assert.equal(bGoals.data.items.length, 0, `Workspace B must not see Workspace A goals; got ${bGoals.data.items.length}`);
});

// ---------------------------------------------------------------------------
// Fixed bills
// ---------------------------------------------------------------------------

maybeTest('fixed bills: Workspace B cannot list Workspace A fixed bills', async () => {
  const a = await signup(`bill-a-${Date.now()}@example.test`);
  const b = await signup(`bill-b-${Date.now()}@example.test`);

  const created = await request('/api/v1/fixed-bills', {
    method: 'POST',
    token: a.token,
    workspaceId: a.workspaceId,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'A Secret Rent', categorySlug: 'fixed_bills', expectedAmount: '1500.00', dueDayOfMonth: 1 }),
  });
  assert.equal(created.status, 201, `fixed bill create failed: ${JSON.stringify(created.data)}`);

  const bBills = await request('/api/v1/fixed-bills', {
    token: b.token,
    workspaceId: b.workspaceId,
  });
  assert.equal(bBills.status, 200);
  assert.equal(bBills.data.items.length, 0, `Workspace B must not see Workspace A fixed bills; got ${bBills.data.items.length}`);
});
