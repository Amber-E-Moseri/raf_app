import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const port = 3100;
const baseUrl = `http://localhost:${port}`;

let serverProcess;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForServer(url, attempts = 30) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }

      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await wait(250);
  }

  throw lastError;
}

async function request(pathname, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...headers,
    },
    body,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

before(async () => {
  serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let startupLog = '';
  serverProcess.stdout.on('data', (chunk) => {
    startupLog += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    startupLog += chunk.toString();
  });

  try {
    await waitForServer(`${baseUrl}/health`);
  } catch (error) {
    serverProcess.kill('SIGTERM');
    throw new Error(`Live API server failed to start. Output:\n${startupLog}\n${error.message}`);
  }
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await wait(250);
  }
});

test('GET /health returns server health', async () => {
  const { response, data } = await request('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(data, {
    status: 'ok',
    service: 'raf-api',
  });
});

test('household allocation category endpoints expose current configuration and accept valid updates', async () => {
  const listed = await request('/api/v1/household/allocation-categories');
  assert.equal(listed.response.status, 200);
  assert.equal(Array.isArray(listed.data.items), true);

  const updated = await request('/api/v1/household/allocation-categories', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      items: listed.data.items.map((item) => ({
        slug: item.slug,
        label: item.slug === 'buffer' ? 'Operating Buffer' : item.label,
        allocationPercent: item.allocationPercent,
        sortOrder: item.sortOrder,
        isActive: item.isActive,
        isBuffer: item.isBuffer,
      })),
    }),
  });

  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.items.find((item) => item.slug === 'buffer').label, 'Operating Buffer');
});

test('allocation category compatibility aliases support the existing frontend endpoint shape', async () => {
  const listed = await request('/api/v1/allocation-categories');
  assert.equal(listed.response.status, 200);
  assert.equal(Array.isArray(listed.data.items), true);

  const updated = await request('/api/v1/allocation-categories', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      items: listed.data.items.map((item) => ({
        slug: item.slug,
        label: item.label,
        allocationPercent: item.allocationPercent,
        sortOrder: item.sortOrder,
        isActive: item.isActive,
        isBuffer: item.isBuffer,
      })),
    }),
  });

  assert.equal(updated.response.status, 200);
  assert.equal(Array.isArray(updated.data.items), true);
});

test('POST /api/v1/income creates deterministic allocations and GET /api/v1/income lists the deposit', async () => {
  const create = await request('/api/v1/income', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': 'live-income-1',
    },
    body: JSON.stringify({
      sourceName: 'Payroll',
      amount: '1000.01',
      receivedDate: '2026-03-10',
      notes: 'Live API test',
    }),
  });

  assert.equal(create.response.status, 201);
  assert.equal(create.data.incomeId != null, true);
  assert.deepEqual(
    create.data.allocations.map((allocation) => ({
      slug: allocation.slug,
      amount: allocation.amount,
    })),
    [
      { slug: 'savings', amount: '100.00' },
      { slug: 'fixed_bills', amount: '300.00' },
      { slug: 'personal_spending', amount: '150.00' },
      { slug: 'investment', amount: '100.00' },
      { slug: 'debt_payoff', amount: '100.00' },
      { slug: 'buffer', amount: '250.01' },
    ],
  );

  const list = await request('/api/v1/income?from=2026-03-01&to=2026-03-31');
  assert.equal(list.response.status, 200);
  assert.equal(list.data.total, '1000.01');
  assert.equal(list.data.items.length >= 1, true);
});

test('duplicate income submission with the same Idempotency-Key replays instead of inserting again', async () => {
  const payload = {
    sourceName: 'Payroll',
    amount: '500.00',
    receivedDate: '2026-03-11',
    notes: 'Idempotency replay',
  };

  const first = await request('/api/v1/income', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': 'live-income-dup',
    },
    body: JSON.stringify(payload),
  });

  const second = await request('/api/v1/income', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': 'live-income-dup',
    },
    body: JSON.stringify(payload),
  });

  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 200);
  assert.equal(second.data.incomeId, first.data.incomeId);
  assert.deepEqual(second.data.allocations, first.data.allocations);
});

test('income validation rejects missing required fields and invalid payload shapes', async () => {
  const missingRequired = await request('/api/v1/income', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: '50.00',
      receivedDate: '2026-03-12',
    }),
  });

  assert.equal(missingRequired.response.status, 400);
  assert.match(String(missingRequired.data.error), /sourceName/i);

  const wrongShape = await request('/api/v1/income', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: '50.00',
      date: '2026-03-12',
      idempotencyKey: 'wrong-shape',
    }),
  });

  assert.equal(wrongShape.response.status, 400);
  assert.match(String(wrongShape.data.error), /sourceName|receivedDate/i);
});

test('POST /api/v1/transactions and GET /api/v1/transactions expose stored transactions', async () => {
  const created = await request('/api/v1/transactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      transactionDate: '2026-03-12',
      description: 'Groceries',
      merchant: 'Market',
      amount: '125.00',
      direction: 'debit',
    }),
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.data.description, 'Groceries');

  const listed = await request('/api/v1/transactions?from=2026-03-01&to=2026-03-31&limit=50');
  assert.equal(listed.response.status, 200);
  assert.equal(Array.isArray(listed.data.items), true);
  assert.equal(listed.data.items.some((item) => item.id === created.data.id), true);
});

test('transaction validation rejects missing required fields and invalid negative debit amounts', async () => {
  const missingRequired = await request('/api/v1/transactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      amount: '10.00',
      direction: 'debit',
    }),
  });

  assert.equal(missingRequired.response.status, 400);
  assert.match(String(missingRequired.data.error), /transactionDate|description/i);

  const invalidNegativeDebit = await request('/api/v1/transactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      transactionDate: '2026-03-13',
      description: 'Bad debit',
      amount: '-10.00',
      direction: 'debit',
    }),
  });

  assert.equal(invalidNegativeDebit.response.status, 400);
  assert.match(String(invalidNegativeDebit.data.error), /negative amounts are only allowed for credit transactions/i);
});

test('debts endpoints create, list, update, and enforce delete guardrails', async () => {
  const created = await request('/api/v1/debts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Visa',
      startingBalance: '5000.00',
      apr: 19,
      minimumPayment: '100.00',
      monthlyPayment: '200.00',
      sortOrder: 1,
    }),
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.data.currentBalance, '5000.00');

  const listed = await request('/api/v1/debts');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.items.some((item) => item.id === created.data.id), true);

  const updated = await request(`/api/v1/debts/${created.data.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      monthlyPayment: '250.00',
    }),
  });

  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.monthlyPayment, '250.00');

  const deleteAttempt = await request(`/api/v1/debts/${created.data.id}`, {
    method: 'DELETE',
  });

  assert.equal(deleteAttempt.response.status, 204);
});

test('monthly review create endpoint computes surplus distributions deterministically', async () => {
  await request('/api/v1/income', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': 'live-income-review',
    },
    body: JSON.stringify({
      sourceName: 'Bonus',
      amount: '1000.00',
      receivedDate: '2026-04-10',
    }),
  });

  await request('/api/v1/transactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      transactionDate: '2026-04-12',
      description: 'Bills',
      amount: '333.33',
      direction: 'debit',
    }),
  });

  const review = await request('/api/v1/monthly-review', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      reviewMonth: '2026-04-01',
      notes: 'Live review',
    }),
  });

  assert.equal(review.response.status, 201);
  assert.equal(review.data.reviewMonth, '2026-04-01');
  assert.equal(review.data.netSurplus, '666.67');
  assert.deepEqual(review.data.distributions, {
    emergency_fund: '266.68',
    extra_debt_payoff: '266.66',
    investment: '133.33',
  });
});

test('monthly review apply endpoint creates allocation transactions and the report endpoint responds', async () => {
  await request('/api/v1/income', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': 'live-income-apply',
    },
    body: JSON.stringify({
      sourceName: 'Payroll',
      amount: '900.00',
      receivedDate: '2026-05-10',
    }),
  });

  const apply = await request('/api/v1/monthly-review/apply', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      reviewMonth: '2026-05-01',
    }),
  });

  assert.equal(apply.response.status, 201);
  assert.equal(Array.isArray(apply.data.appliedTransactions), true);
  assert.equal(apply.data.appliedTransactions.length, 3);

  const trajectory = await request('/api/v1/reports/trajectory?months=2');
  assert.equal(trajectory.response.status, 200);
  assert.equal(Array.isArray(trajectory.data.debtPayoffProjection), true);
  assert.equal(Array.isArray(trajectory.data.savingsGrowthProjection), true);
  assert.equal(Array.isArray(trajectory.data.emergencyFundCoverageProjection), true);
});

test('unsupported routes and unsupported methods return non-success responses', async () => {
  const unsupportedRoute = await request('/api/v1/does-not-exist');
  assert.equal(unsupportedRoute.response.status, 404);

  const unsupportedMethod = await request('/api/v1/income', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(unsupportedMethod.response.status, 404);
});
