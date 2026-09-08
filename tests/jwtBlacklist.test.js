import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { blacklistToken, createToken, verifyToken } from '../lib/auth/jwt.js';
import { createInMemoryDb } from '../lib/server/inMemoryDb.js';
import { createSqliteDb } from '../lib/server/sqliteDb.js';

test('JWT tokens include jti and logout blacklist rejects the token through the DB adapter', async () => {
  const db = createInMemoryDb();
  const token = createToken({ userId: 'user_1', email: 'amber@example.test' }, 3600);

  const claims = await verifyToken(token, { db });
  assert.equal(claims.userId, 'user_1');
  assert.equal(typeof claims.jti, 'string');
  assert.ok(claims.jti.length > 20);

  assert.equal(await blacklistToken(token, { db }), true);
  assert.equal(await verifyToken(token, { db }), null);

  assert.equal(db.state.tokenBlacklist.length, 1);
  assert.equal(db.state.tokenBlacklist[0].jti, claims.jti);
  assert.equal(db.state.tokenBlacklist[0].expiresAt, new Date(claims.exp * 1000).toISOString());
});

test('SQLite token blacklist survives adapter restart', async () => {
  const dbPath = path.join(os.tmpdir(), `raf-token-blacklist-${crypto.randomUUID()}`);
  const token = createToken({ userId: 'user_1', email: 'amber@example.test' }, 3600);

  let db = createSqliteDb({ dbPath });
  try {
    assert.equal(await blacklistToken(token, { db }), true);
  } finally {
    db.close();
  }

  db = createSqliteDb({ dbPath });
  try {
    assert.equal(await verifyToken(token, { db }), null);
  } finally {
    db.close();
    fs.rmSync(dbPath, { recursive: true, force: true });
  }
});

test('expired token blacklist rows can be cleaned up without accepting expired tokens', async () => {
  const db = createInMemoryDb();
  const token = createToken({ userId: 'user_1', email: 'amber@example.test' }, -1);

  assert.equal(await verifyToken(token, { db }), null);
  assert.equal(await blacklistToken(token, { db }), true);
  assert.equal(db.state.tokenBlacklist.length, 1);

  const removed = await db.transaction((tx) => tx.cleanupExpiredBlacklistedTokens());
  assert.equal(removed, 1);
  assert.equal(db.state.tokenBlacklist.length, 0);
});
