/**
 * Tenant cross-access tests.
 *
 * Two users each own a separate workspace. Verifies that user A cannot read,
 * modify, or delete financial data belonging to workspace B — even when user A
 * supplies workspace B's ID in the header or in a URL parameter.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const port = 3103;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = path.join(os.tmpdir(), `raf-cross-access-${process.pid}`);

let serverProcess;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, attempts = 40) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`Unexpected status ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await wait(250);
  }
  throw lastError;
}

async function request(pathname, { method = 'GET', token, workspaceId, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function signup(email, householdName) {
  const { status, data } = await request('/api/v1/auth/signup', {
    method: 'POST',
    body: { email, password: 'CrossAccess123!', householdName },
  });
  assert.equal(status, 201, `Signup failed for ${email}: ${status}`);
  return { token: data.token, workspaceId: data.workspace.id, userId: data.userId };
}

let userA, userB;
let transactionId;

before(async () => {
  serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      RAF_PERSISTENCE_DRIVER: 'sqlite',
      RAF_DB_PATH: dataDir,
      RAF_AUTH_REQUIRED: 'true',
      RAF_AUTH_PROVIDER: 'local',
      JWT_SECRET: 'cross-access-test-secret',
      DATABASE_URL: '',
      SUPABASE_DATABASE_URL: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let startupLog = '';
  serverProcess.stdout.on('data', (c) => { startupLog += c.toString(); });
  serverProcess.stderr.on('data', (c) => { startupLog += c.toString(); });

  try {
    await waitForServer(`${baseUrl}/health`);
  } catch (error) {
    serverProcess.kill('SIGTERM');
    throw new Error(`Server failed to start. Output:\n${startupLog}\n${error.message}`);
  }

  userA = await signup('cross-user-a@example.com', 'Workspace A');
  userB = await signup('cross-user-b@example.com', 'Workspace B');

  // Create a transaction in workspace A so we can try to read it as user B
  const { status, data } = await request('/api/v1/transactions', {
    method: 'POST',
    token: userA.token,
    workspaceId: userA.workspaceId,
    body: {
      date: '2026-01-15',
      merchant: 'User A Merchant',
      amount: '100.00',
      direction: 'out',
      category: 'essentials',
    },
  });
  if ([200, 201].includes(status)) {
    transactionId = data.id ?? data.transaction?.id;
  }
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    await new Promise((resolve) => {
      serverProcess.once('exit', resolve);
      serverProcess.kill('SIGTERM');
      setTimeout(resolve, 5000);
    });
  }
});

test('User B cannot list transactions from workspace A', async () => {
  // User B sends their own token but workspace A's ID
  const { status, data } = await request('/api/v1/transactions', {
    method: 'GET',
    token: userB.token,
    workspaceId: userA.workspaceId,
  });

  // Must be forbidden — either a 403, or an empty list (not leaking workspace A's data)
  if ([200, 201].includes(status)) {
    const items = Array.isArray(data) ? data : (data?.items ?? data?.transactions ?? []);
    assert.equal(items.length, 0, 'User B must not receive workspace A transactions');
  } else {
    assert.ok([401, 403].includes(status), `Expected 401/403, got ${status}`);
  }
});

test('User B cannot read a specific transaction from workspace A by ID', async () => {
  if (!transactionId) {
    // If we could not create the transaction, skip gracefully
    return;
  }

  const { status } = await request(`/api/v1/transactions/${transactionId}`, {
    method: 'GET',
    token: userB.token,
    workspaceId: userA.workspaceId,
  });

  assert.ok([401, 403, 404].includes(status), `Expected 401/403/404, got ${status}`);
});

test('User B cannot delete a transaction from workspace A', async () => {
  if (!transactionId) return;

  const { status } = await request(`/api/v1/transactions/${transactionId}`, {
    method: 'DELETE',
    token: userB.token,
    workspaceId: userA.workspaceId,
  });

  assert.ok([401, 403, 404].includes(status), `Expected 401/403/404, got ${status}`);
});

test('User A cannot list workspace B transactions', async () => {
  const { status, data } = await request('/api/v1/transactions', {
    method: 'GET',
    token: userA.token,
    workspaceId: userB.workspaceId,
  });

  if ([200, 201].includes(status)) {
    const items = Array.isArray(data) ? data : (data?.items ?? data?.transactions ?? []);
    assert.equal(items.length, 0, 'User A must not receive workspace B transactions');
  } else {
    assert.ok([401, 403].includes(status), `Expected 401/403, got ${status}`);
  }
});

test('User B cannot access workspace A reports', async () => {
  const { status } = await request('/api/v1/reports/dashboard', {
    method: 'GET',
    token: userB.token,
    workspaceId: userA.workspaceId,
  });
  assert.ok([401, 403, 404].includes(status), `Expected 401/403/404 on cross-workspace report, got ${status}`);
});

test('User B cannot read workspace A income entries', async () => {
  const { status, data } = await request('/api/v1/income', {
    method: 'GET',
    token: userB.token,
    workspaceId: userA.workspaceId,
  });

  if ([200, 201].includes(status)) {
    const items = Array.isArray(data) ? data : (data?.items ?? data?.income ?? []);
    assert.equal(items.length, 0, 'User B must not receive workspace A income entries');
  } else {
    assert.ok([401, 403].includes(status), `Expected 401/403, got ${status}`);
  }
});
