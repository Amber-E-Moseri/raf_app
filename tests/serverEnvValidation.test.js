import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadServerEnv } from '../lib/server/env.js';

function withIsolatedEnv(run) {
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

test('loadServerEnv fails clearly when RAF_DB_PATH is missing', () => withIsolatedEnv(() => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-env-'));
  try {
    assert.throws(
      () => loadServerEnv({ cwd }),
      /Invalid server environment configuration[\s\S]*RAF_DB_PATH/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));

test('loadServerEnv parses .env and validates PORT range', () => withIsolatedEnv(() => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-env-'));
  try {
    fs.writeFileSync(path.join(cwd, '.env'), 'RAF_DB_PATH=./db/test.sqlite\nPORT=abc\n', 'utf8');
    assert.throws(
      () => loadServerEnv({ cwd }),
      /PORT must be an integer from 1 to 65535/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}));
