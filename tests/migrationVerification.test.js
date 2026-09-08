import test from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryDb } from '../lib/server/inMemoryDb.js';
import { verifyMigrationReconciliation } from '../lib/server/migrationVerification.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function copyState(from, to) {
  for (const key of Object.keys(from.state)) {
    to.state[key] = clone(from.state[key]);
  }
}

test('migration reconciliation passes when source and target financial state match', async () => {
  const source = createInMemoryDb();
  const target = createInMemoryDb();
  const workspaceId = source.defaultHouseholdId;

  await source.transaction(async (tx) => {
    await tx.insertIncomeEntry({
      id: '11111111-1111-4111-8111-111111111111',
      householdId: workspaceId,
      sourceName: 'Payroll',
      amount: '1000.00',
      receivedDate: '2026-03-10',
      notes: null,
      idempotencyKey: 'migration-payroll',
    });
    await tx.insertTransaction({
      id: '22222222-2222-4222-8222-222222222222',
      householdId: workspaceId,
      transactionDate: '2026-03-11',
      description: 'Groceries',
      amount: '75.00',
      direction: 'debit',
      categoryId: null,
      linkedDebtId: null,
      linkedGoalId: null,
      source: 'manual',
    });
  });

  copyState(source, target);

  const result = await verifyMigrationReconciliation({
    sourceDb: source,
    targetDb: target,
    workspaceIds: [workspaceId],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.results[0].mismatches, []);
});

test('migration reconciliation reports mismatched financial state', async () => {
  const source = createInMemoryDb();
  const target = createInMemoryDb();
  const workspaceId = source.defaultHouseholdId;
  copyState(source, target);

  await target.transaction(async (tx) => {
    await tx.insertTransaction({
      id: '33333333-3333-4333-8333-333333333333',
      householdId: workspaceId,
      transactionDate: '2026-03-11',
      description: 'Unexpected target-only transaction',
      amount: '75.00',
      direction: 'debit',
      categoryId: null,
      linkedDebtId: null,
      linkedGoalId: null,
      source: 'manual',
    });
  });

  const result = await verifyMigrationReconciliation({
    sourceDb: source,
    targetDb: target,
    workspaceIds: [workspaceId],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.results[0].mismatches, ['counts', 'financials']);
});
