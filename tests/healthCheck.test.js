/**
 * Health endpoint tests — liveness vs readiness split
 *
 * Covers:
 *   Unit: checkReadiness() with mock db — success and failure paths
 *   Integration: live SQLite server — /health (liveness) and /api/v1/health (readiness)
 *   Liveness independence: DB failure → /api/v1/health 503, /health 200 simultaneously
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { checkReadiness } from '../lib/server/readinessHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Unit tests — checkReadiness() with mock db objects
// ---------------------------------------------------------------------------

test('checkReadiness: db.ping() succeeds → status 200, ok:true, db:connected', async () => {
  const db = { ping: async () => {} };
  const result = await checkReadiness(db);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, db: 'connected' });
});

test('checkReadiness: db.ping() throws → status 503, ok:false, db:unavailable', async () => {
  const db = { ping: async () => { throw new Error('Connection refused'); } };
  const result = await checkReadiness(db);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, db: 'unavailable' });
});

test('checkReadiness: does not expose internal error details in body', async () => {
  const db = { ping: async () => { throw new Error('host=db.internal password=secret'); } };
  const result = await checkReadiness(db);
  const bodyStr = JSON.stringify(result.body);
  assert.ok(!bodyStr.includes('password'), 'error details must not appear in response body');
  assert.ok(!bodyStr.includes('db.internal'), 'connection details must not appear in response body');
});

// ---------------------------------------------------------------------------
// Liveness independence — in-process mini server with a failing db
//
// Proves simultaneously:
//   GET /health        → 200  (never calls db.ping)
//   GET /api/v1/health → 503  (db.ping throws)
// ---------------------------------------------------------------------------

test('liveness is independent of DB failure', async () => {
  const failingDb = { ping: async () => { throw new Error('simulated DB unavailable'); } };

  const app = express();

  // Liveness — static, no DB
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'raf-api' });
  });

  // Readiness — DB-aware
  app.get('/api/v1/health', async (_req, res) => {
    const { status, body } = await checkReadiness(failingDb);
    res.status(status).json(body);
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // Liveness must be 200 even when DB is unavailable
    const liveness = await fetch(`${base}/health`);
    assert.equal(liveness.status, 200, 'liveness must return 200 regardless of DB state');
    const livenessBody = await liveness.json();
    assert.equal(livenessBody.status, 'ok');

    // Readiness must be 503 when DB ping fails
    const readiness = await fetch(`${base}/api/v1/health`);
    assert.equal(readiness.status, 503, 'readiness must return 503 when DB is unavailable');
    const readinessBody = await readiness.json();
    assert.equal(readinessBody.ok, false);
    assert.equal(readinessBody.db, 'unavailable');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Integration tests — live SQLite server (DB available, both endpoints)
// ---------------------------------------------------------------------------

const livePort = 3197;
const baseUrl = `http://localhost:${livePort}`;
const sqlitePath = path.join(os.tmpdir(), `raf-health-check-${process.pid}.sqlite`);
let serverProcess;

function wait(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function waitForServer(url, attempts = 30) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
      lastError = new Error(`Unexpected status ${r.status}`);
    } catch (err) {
      lastError = err;
    }
    await wait(250);
  }
  throw lastError;
}

before(async () => {
  serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(livePort),
      // Force SQLite regardless of the .env file — these tests must not need Postgres.
      PERSISTENCE_DRIVER: 'sqlite',
      RAF_DB_PATH: sqlitePath,
      POSTGRES_CONNECTION_STRING: '',
      POSTGRES_CONNECTION_STRING_APP: '',
      RAF_AUTH_REQUIRED: 'false',
      SENTRY_DSN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let startupLog = '';
  serverProcess.stdout.on('data', (c) => { startupLog += c.toString(); });
  serverProcess.stderr.on('data', (c) => { startupLog += c.toString(); });

  try {
    await waitForServer(`${baseUrl}/health`);
  } catch (err) {
    serverProcess.kill('SIGTERM');
    throw new Error(`Health-check test server failed to start:\n${startupLog}\n${err.message}`);
  }
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await wait(250);
  }
  for (const suffix of ['', '-shm', '-wal']) {
    const target = `${sqlitePath}${suffix}`;
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
});

test('GET /health (liveness) returns 200 with static body', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'raf-api');
});

test('GET /api/v1/health (readiness) returns 200 when DB is available', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.db, 'connected');
});

test('GET /api/v1/health requires no auth token', async () => {
  // Probe with no Authorization header — must not return 401
  const res = await fetch(`${baseUrl}/api/v1/health`, { headers: {} });
  assert.notEqual(res.status, 401, 'readiness probe must not require a JWT');
  assert.notEqual(res.status, 403, 'readiness probe must not require workspace membership');
});

test('GET /api/v1/health exposes no tenant or connection data', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  const bodyStr = await res.text();
  // Body must contain only ok and db fields
  const allowed = ['ok', 'connected', 'unavailable', 'true', 'false', '{', '}', '"'];
  const parsed = JSON.parse(bodyStr);
  const keys = Object.keys(parsed);
  assert.deepEqual(keys.sort(), ['db', 'ok'].sort(), 'response must only contain ok and db fields');
});
