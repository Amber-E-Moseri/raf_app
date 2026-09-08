import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSqliteDb } from '../lib/server/sqliteDb.js';

test('SQLite adapter persists data across adapter restarts', async () => {
  const sqlitePath = path.join(os.tmpdir(), `raf-persistence-${process.pid}-${Date.now()}.sqlite`);

  try {
    const first = createSqliteDb({ dbPath: sqlitePath });
    const householdId = first.defaultHouseholdId;

    await first.transaction(async (tx) => {
      await tx.insertGoal({
        householdId,
        bucketId: 'bucket_1',
        name: 'Persisted Goal',
        targetAmount: '1000.00',
        targetDate: '2027-01-01',
        notes: null,
        active: true,
      });
    });
    first.close();

    const second = createSqliteDb({ dbPath: sqlitePath });
    const goals = await second.transaction(async (tx) => tx.listGoals({ householdId }));
    second.close();

    assert.equal(goals.some((goal) => goal.name === 'Persisted Goal'), true);
  } finally {
    for (const suffix of ['', '-shm', '-wal']) {
      const target = `${sqlitePath}${suffix}`;
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    }
  }
});
