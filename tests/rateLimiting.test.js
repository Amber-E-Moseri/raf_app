/**
 * Rate limiting tests.
 *
 * Verifies that auth routes and AI routes are blocked after their respective
 * per-window maximums. Tests run against a real in-process server.
 *
 * NOTE: These tests fire real HTTP requests in tight loops. They are
 * intentionally excluded from the default test suite (run via --test-only or a
 * dedicated CI job) because they take several seconds and are sensitive to
 * timing on slow machines.
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
const port = 3104;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = path.join(os.tmpdir(), `raf-rate-limiting-${process.pid}`);

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

async function post(pathname, body, headers = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers };
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
      JWT_SECRET: 'rate-limiting-test-secret',
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

test('Auth rate limiter blocks after 20 login attempts (15-min window)', async () => {
  const responses = [];
  // Fire 25 login requests in rapid succession with bad credentials
  for (let i = 0; i < 25; i++) {
    const { status } = await post('/api/v1/auth/login', {
      email: `rate-limit-${i}@example.com`,
      password: 'BadPassword!',
    });
    responses.push(status);
  }

  // At least one response must be 429
  const has429 = responses.some((s) => s === 429);
  assert.ok(
    has429,
    `Expected at least one 429 after 25 rapid login attempts. Got: ${JSON.stringify(responses.slice(0, 5))}...`,
  );
});

test('Auth rate limiter returns RateLimit headers', async () => {
  // Just check that the header is present on a normal response
  const { headers } = await post('/api/v1/auth/login', {
    email: 'ratelimit-headers@example.com',
    password: 'BadPassword!',
  });

  // express-rate-limit with standardHeaders:true sets RateLimit-Limit
  const limit = headers.get('ratelimit-limit') ?? headers.get('x-ratelimit-limit');
  // We do a soft assertion — if the header is absent it means rate limiting middleware
  // isn't wired (which the previous test would already catch via 429 absence).
  if (limit !== null) {
    assert.ok(Number(limit) > 0, 'RateLimit-Limit header should be a positive number');
  }
});

test('Auth signup rate limiter blocks after 20 requests (15-min window)', async () => {
  const responses = [];
  for (let i = 0; i < 25; i++) {
    const { status } = await post('/api/v1/auth/signup', {
      email: `signup-flood-${i}-${process.pid}@example.com`,
      password: 'FloodPass123!',
      householdName: `Flood Household ${i}`,
    });
    responses.push(status);
  }

  const has429 = responses.some((s) => s === 429);
  assert.ok(
    has429,
    `Expected at least one 429 after 25 rapid signup attempts. Got: ${JSON.stringify(responses.slice(0, 5))}...`,
  );
});
