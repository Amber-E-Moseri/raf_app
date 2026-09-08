import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const port = 3102;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = path.join(os.tmpdir(), `raf-priv-esc-${process.pid}`);

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
    body: { email, password: 'PrivEsc123!', householdName },
  });
  assert.equal(status, 201);
  return { token: data.token, workspaceId: data.workspace.id };
}

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
      JWT_SECRET: 'priv-esc-test-secret',
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

test('PATCH /remi/upgrade returns 501 — no self-promotion to paid tier', async () => {
  const { token, workspaceId } = await signup('priv-esc-owner@example.com', 'Priv Esc Workspace');
  const { status } = await request('/api/v1/remi/upgrade', {
    method: 'PATCH',
    token,
    workspaceId,
    body: { tier: 'paid' },
  });
  assert.equal(status, 501, 'Expected 501 — upgrade endpoint must be disabled until Stripe is wired');
});

test('PATCH /remi/upgrade with no auth returns 401', async () => {
  const { status } = await request('/api/v1/remi/upgrade', {
    method: 'PATCH',
    body: { tier: 'paid' },
  });
  assert.ok([401, 403].includes(status), `Expected 401 or 403, got ${status}`);
});

test('Viewer cannot write financial data — viewer token gets 403, owner token gets 201', async () => {
  // Owner creates workspace
  const { token: ownerToken, workspaceId } = await signup('priv-esc-viewer-owner@example.com', 'Viewer Test');

  // Viewer creates their own account
  const { token: viewerToken, workspaceId: viewerWorkspaceId } =
    await signup('priv-esc-viewer@example.com', 'Viewer Own');

  // Owner invites viewer with role 'viewer'
  const invRes = await request(`/api/v1/workspaces/${workspaceId}/invitations`, {
    method: 'POST',
    token: ownerToken,
    workspaceId,
    body: { email: 'priv-esc-viewer@example.com', role: 'viewer' },
  });
  assert.equal(invRes.status, 201, `invitation failed: ${JSON.stringify(invRes.data)}`);
  const rawToken = invRes.data.invitation.rawToken;

  // Viewer accepts the invitation
  const acceptRes = await request(`/api/v1/invitations/${rawToken}/accept`, {
    method: 'POST',
    token: viewerToken,
    workspaceId: viewerWorkspaceId,
  });
  assert.equal(acceptRes.status, 200, `accept failed: ${JSON.stringify(acceptRes.data)}`);
  assert.equal(acceptRes.data.role, 'viewer');

  // Viewer attempts to write — must be denied
  const viewerWrite = await request('/api/v1/transactions', {
    method: 'POST',
    token: viewerToken,
    workspaceId,   // owner's workspace, where viewer has viewer-role membership
    body: { transactionDate: '2026-01-01', description: 'Viewer write attempt', amount: '10.00', direction: 'debit' },
  });
  assert.equal(viewerWrite.status, 403, `Viewer must be denied financial:write, got ${viewerWrite.status}`);

  // Owner should still be able to write
  const ownerWrite = await request('/api/v1/transactions', {
    method: 'POST',
    token: ownerToken,
    workspaceId,
    body: { transactionDate: '2026-01-01', description: 'Owner write', amount: '10.00', direction: 'debit' },
  });
  assert.ok([200, 201].includes(ownerWrite.status), `Owner must be allowed financial:write, got ${ownerWrite.status}`);
});

test('Unauthenticated request to financial endpoint returns 401', async () => {
  const { status } = await request('/api/v1/transactions', { method: 'GET' });
  assert.ok([401, 403].includes(status), `Expected 401/403, got ${status}`);
});

test('Authenticated user without workspace header cannot access financial data', async () => {
  const { token } = await signup('priv-esc-noworkspace@example.com', 'No Workspace Test');
  // Send token but no workspace header
  const { status } = await request('/api/v1/transactions', {
    method: 'GET',
    token,
    // intentionally omit workspaceId
  });
  assert.ok([400, 401, 403].includes(status), `Expected 400/401/403 without workspace header, got ${status}`);
});
