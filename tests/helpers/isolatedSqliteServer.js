import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { loadServerEnv } from '../../lib/server/env.js';

const POSTGRES_ENV_KEYS = [
  'POSTGRES_CONNECTION_STRING',
  'POSTGRES_CONNECTION_STRING_APP',
  'DATABASE_URL',
  'SUPABASE_DATABASE_URL',
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePrefix(value) {
  return String(value ?? 'raf-isolated-server')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'raf-isolated-server';
}

export async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) {
    throw new Error('Could not allocate an available test server port.');
  }
  return port;
}

async function assertPortAvailable(port, host) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  }).finally(async () => {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
}

function withRestoredProcessEnv(run) {
  const previous = { ...process.env };
  try {
    return run();
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
}

export function assertIsolatedSqliteEnvResolvesToSqlite({ cwd, env }) {
  return withRestoredProcessEnv(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, env);

    const resolved = loadServerEnv({ cwd });
    assert.equal(
      resolved.persistenceDriver,
      'sqlite',
      `isolated SQLite test resolved ${resolved.persistenceDriver}; refusing to start server`,
    );
    assert.equal(
      Boolean(resolved.postgresConnectionString),
      false,
      'isolated SQLite test resolved a Postgres connection string; refusing to start server',
    );
    return resolved;
  });
}

async function waitForServer(url, { attempts = 50, intervalMs = 200 } = {}) {
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
    await wait(intervalMs);
  }
  throw lastError;
}

export async function startIsolatedSqliteServer({
  repoRoot,
  testName,
  port: requestedPort,
  authRequired = false,
  jwtSecret = 'isolated-sqlite-test-secret',
  extraEnv = {},
  host = '127.0.0.1',
  startupPath = '/health',
  startupAttempts = 50,
  startupIntervalMs = 200,
} = {}) {
  if (!repoRoot) {
    throw new Error('repoRoot is required to start an isolated SQLite test server.');
  }

  const prefix = normalizePrefix(testName);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const dbPath = path.join(tempDir, 'raf.sqlite');
  const port = requestedPort ?? await getAvailablePort();
  const baseUrl = `http://${host}:${port}`;
  const env = {
    ...process.env,
    PORT: String(port),
    PERSISTENCE_DRIVER: 'sqlite',
    RAF_DB_PATH: dbPath,
    RAF_AUTH_REQUIRED: authRequired ? 'true' : 'false',
    JWT_SECRET: jwtSecret,
    SENTRY_DSN: '',
    ...Object.fromEntries(POSTGRES_ENV_KEYS.map((key) => [key, ''])),
    ...extraEnv,
  };

  try {
    if (requestedPort != null) {
      await assertPortAvailable(port, host);
    }
    assert.equal(env.PERSISTENCE_DRIVER, 'sqlite', 'isolated helper requires PERSISTENCE_DRIVER=sqlite');
    for (const key of POSTGRES_ENV_KEYS) {
      assert.equal(env[key], '', `isolated helper requires ${key} to be cleared`);
    }

    assertIsolatedSqliteEnvResolvesToSqlite({ cwd: repoRoot, env });
  } catch (error) {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }

  const child = spawn(process.execPath, ['index.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let startupLog = '';
  child.stdout.on('data', (chunk) => { startupLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { startupLog += chunk.toString(); });

  try {
    await waitForServer(`${baseUrl}${startupPath}`, {
      attempts: startupAttempts,
      intervalMs: startupIntervalMs,
    });
    assert.match(
      startupLog,
      /\[RAF\] persistence: sqlite/,
      `isolated SQLite server did not confirm sqlite persistence. Output:\n${startupLog}`,
    );
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`Isolated SQLite server failed to start. Output:\n${startupLog}\n${error.message}`);
  }

  let stopped = false;
  async function stop() {
    if (!stopped && child && !child.killed) {
      stopped = true;
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill('SIGTERM');
        setTimeout(resolve, 5000);
      });
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return {
    process: child,
    baseUrl,
    dbPath,
    port,
    tempDir,
    startupLog: () => startupLog,
    stop,
  };
}
