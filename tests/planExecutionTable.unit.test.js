/**
 * Unit tests for Plan Execution table derivation logic.
 *
 * Tests cover the 7 spec-required cases plus helpers.
 * Run: node --test tests/planExecutionTable.unit.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMoneyToCents,
  derivePlanExecutionRow,
  derivePlanExecutionRows,
} from '../lib/planExecution/derivePlanExecutionRows.js';

// ---------------------------------------------------------------------------
// parseMoneyToCents
// ---------------------------------------------------------------------------

test('parseMoneyToCents converts a decimal string correctly', () => {
  assert.equal(parseMoneyToCents('123.45'), 12345);
});

test('parseMoneyToCents handles a bare integer string', () => {
  assert.equal(parseMoneyToCents('100'), 10000);
});

test('parseMoneyToCents handles a numeric argument directly', () => {
  assert.equal(parseMoneyToCents(50.5), 5050);
});

test('parseMoneyToCents returns 0 for null', () => {
  assert.equal(parseMoneyToCents(null), 0);
});

test('parseMoneyToCents returns 0 for undefined', () => {
  assert.equal(parseMoneyToCents(undefined), 0);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem({ allocated = '0.00', added = '0.00', used = '0.00' } = {}) {
  return {
    bucketId: 'bucket_test',
    slug: 'test',
    label: 'Test Bucket',
    thisMonth: { allocated, added, used, remaining: null },
  };
}

// ---------------------------------------------------------------------------
// Test 1 — used < allocated → WITHIN_ALLOCATION, positive remaining
// ---------------------------------------------------------------------------

test('Test 1: used < allocated → WITHIN_ALLOCATION with positive remaining', () => {
  const row = derivePlanExecutionRow(makeItem({ allocated: '200.00', used: '150.00' }));

  assert.ok(row, 'should return a row');
  assert.equal(row.status, 'WITHIN_ALLOCATION');
  assert.equal(row.remainingCents, 5000); // 200.00 - 150.00 = 50.00
});

// ---------------------------------------------------------------------------
// Test 2 — used = allocated → WITHIN_ALLOCATION, zero remaining
// ---------------------------------------------------------------------------

test('Test 2: used = allocated → WITHIN_ALLOCATION with zero remaining', () => {
  const row = derivePlanExecutionRow(makeItem({ allocated: '100.00', used: '100.00' }));

  assert.ok(row);
  assert.equal(row.status, 'WITHIN_ALLOCATION');
  assert.equal(row.remainingCents, 0);
});

// ---------------------------------------------------------------------------
// Test 3 — used > allocated → ABOVE_ALLOCATION, negative remaining
// ---------------------------------------------------------------------------

test('Test 3: used > allocated → ABOVE_ALLOCATION with negative remaining (-$40)', () => {
  const row = derivePlanExecutionRow(makeItem({ allocated: '100.00', used: '140.00' }));

  assert.ok(row);
  assert.equal(row.status, 'ABOVE_ALLOCATION');
  assert.equal(row.remainingCents, -4000); // 100.00 - 140.00 = -40.00
});

// ---------------------------------------------------------------------------
// Test 4 — allocated=0, used>0 → NO_ALLOCATION_USED
// ---------------------------------------------------------------------------

test('Test 4: allocated=0, used>0 → NO_ALLOCATION_USED', () => {
  const row = derivePlanExecutionRow(makeItem({ allocated: '0.00', used: '75.50' }));

  assert.ok(row);
  assert.equal(row.status, 'NO_ALLOCATION_USED');
  assert.equal(row.usedCents, 7550);
  assert.equal(row.allocatedCents, 0);
});

test('Test 4b: all zeros → null (filtered out)', () => {
  const row = derivePlanExecutionRow(makeItem({ allocated: '0.00', used: '0.00', added: '0.00' }));
  assert.equal(row, null);
});

// ---------------------------------------------------------------------------
// Test 5 — credits affecting remaining
// ---------------------------------------------------------------------------

test('Test 5a: credits (added) rescue an otherwise-over-allocation (WITHIN_ALLOCATION)', () => {
  // allocated=100, added=50, used=120 → remaining = 100+50−120 = 30
  const row = derivePlanExecutionRow(makeItem({ allocated: '100.00', added: '50.00', used: '120.00' }));

  assert.ok(row);
  assert.equal(row.status, 'WITHIN_ALLOCATION');
  assert.equal(row.remainingCents, 3000); // 30.00
});

test('Test 5b: credits insufficient to cover overspend (ABOVE_ALLOCATION)', () => {
  // allocated=100, added=10, used=150 → remaining = 100+10−150 = −40
  const row = derivePlanExecutionRow(makeItem({ allocated: '100.00', added: '10.00', used: '150.00' }));

  assert.ok(row);
  assert.equal(row.status, 'ABOVE_ALLOCATION');
  assert.equal(row.remainingCents, -4000);
});

// ---------------------------------------------------------------------------
// Test 6 — category ordering preserved
// ---------------------------------------------------------------------------

test('Test 6: derivePlanExecutionRows preserves input order', () => {
  const items = [
    { bucketId: 'a', slug: 'a', label: 'A', thisMonth: { allocated: '50.00', added: '0.00', used: '10.00', remaining: null } },
    { bucketId: 'b', slug: 'b', label: 'B', thisMonth: { allocated: '80.00', added: '0.00', used: '90.00', remaining: null } },
    { bucketId: 'c', slug: 'c', label: 'C', thisMonth: { allocated: '30.00', added: '0.00', used: '5.00', remaining: null } },
  ];

  const rows = derivePlanExecutionRows(items);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].bucketId, 'a');
  assert.equal(rows[1].bucketId, 'b');
  assert.equal(rows[2].bucketId, 'c');
});

test('Test 6b: zero-activity bucket filtered without disturbing adjacent active buckets', () => {
  const items = [
    { bucketId: 'a', slug: 'a', label: 'A', thisMonth: { allocated: '50.00', added: '0.00', used: '10.00', remaining: null } },
    { bucketId: 'zero', slug: 'zero', label: 'Zero', thisMonth: { allocated: '0.00', added: '0.00', used: '0.00', remaining: null } },
    { bucketId: 'c', slug: 'c', label: 'C', thisMonth: { allocated: '30.00', added: '0.00', used: '5.00', remaining: null } },
  ];

  const rows = derivePlanExecutionRows(items);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].bucketId, 'a');
  assert.equal(rows[1].bucketId, 'c');
});

// ---------------------------------------------------------------------------
// Test 7 — zero-data state
// ---------------------------------------------------------------------------

test('Test 7: empty array returns empty array', () => {
  assert.deepEqual(derivePlanExecutionRows([]), []);
});

test('Test 7b: all-zero items filtered → empty array', () => {
  const items = [
    { bucketId: 'x', slug: 'x', label: 'X', thisMonth: { allocated: '0.00', added: '0.00', used: '0.00', remaining: null } },
    { bucketId: 'y', slug: 'y', label: 'Y', thisMonth: { allocated: null, added: null, used: null, remaining: null } },
  ];
  assert.deepEqual(derivePlanExecutionRows(items), []);
});

// ---------------------------------------------------------------------------
// Test 8 — edge: allocated=0, added>0, used=0 → WITHIN_ALLOCATION (not NO_ALLOCATION_USED)
// ---------------------------------------------------------------------------

test('Test 8: allocated=0 but added>0 (credit refund) → WITHIN_ALLOCATION, not NO_ALLOCATION_USED', () => {
  // A credit/refund happened even though no income was allocated — the bucket
  // has a positive "effective allocation" from credits alone.
  const row = derivePlanExecutionRow(makeItem({ allocated: '0.00', added: '25.00', used: '0.00' }));

  assert.ok(row);
  assert.equal(row.status, 'WITHIN_ALLOCATION');
  assert.equal(row.remainingCents, 2500);
});
