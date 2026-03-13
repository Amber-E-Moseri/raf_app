import test from 'node:test';
import assert from 'node:assert/strict';

import { computeDepositAllocations } from './computeDepositAllocations.js';

test('allocates by percent and routes rounding remainder to buffer when present', () => {
  const allocations = computeDepositAllocations('100.00', [
    { id: '1', slug: 'savings', allocationPercent: '0.3333', sortOrder: 1, isActive: true },
    { id: '2', slug: 'debt_payoff', allocationPercent: '0.3333', sortOrder: 2, isActive: true },
    { id: '3', slug: 'buffer', allocationPercent: '0.3334', sortOrder: 3, isActive: true },
  ]);

  assert.deepEqual(
    allocations.map((entry) => ({ slug: entry.slug, amount: entry.allocatedAmount })),
    [
      { slug: 'savings', amount: '33.33' },
      { slug: 'debt_payoff', amount: '33.33' },
      { slug: 'buffer', amount: '33.34' },
    ],
  );
});

test('throws when active percents do not sum to 1.0000 +/- 0.0001', () => {
  assert.throws(
    () =>
      computeDepositAllocations('500.00', [
        { id: '1', slug: 'savings', allocationPercent: '0.5000', sortOrder: 1, isActive: true },
        { id: '2', slug: 'fixed_bills', allocationPercent: '0.4900', sortOrder: 2, isActive: true },
      ]),
    /must sum to 1\.0000 \+\/- 0\.0001/,
  );
});

test('routes remainder to the largest allocation category when buffer is absent', () => {
  const allocations = computeDepositAllocations('100.01', [
    { id: '1', slug: 'fixed_bills', allocationPercent: '0.5000', sortOrder: 2, isActive: true },
    { id: '2', slug: 'savings', allocationPercent: '0.3000', sortOrder: 1, isActive: true },
    { id: '3', slug: 'debt_payoff', allocationPercent: '0.2000', sortOrder: 3, isActive: true },
  ]);

  assert.deepEqual(
    allocations.map((entry) => ({ slug: entry.slug, amount: entry.allocatedAmount })),
    [
      { slug: 'savings', amount: '30.00' },
      { slug: 'fixed_bills', amount: '50.01' },
      { slug: 'debt_payoff', amount: '20.00' },
    ],
  );
});

test('uses slug and id tie-breakers so equal sort orders are still deterministic', () => {
  const allocations = computeDepositAllocations('10.00', [
    { id: '2', slug: 'buffer', allocationPercent: '0.5000', sortOrder: 1, isActive: true },
    { id: '1', slug: 'savings', allocationPercent: '0.5000', sortOrder: 1, isActive: true },
  ]);

  assert.deepEqual(
    allocations.map((entry) => entry.slug),
    ['buffer', 'savings'],
  );
});

test('uses deterministic tie-breaking when remainder goes to the largest category without buffer', () => {
  const allocations = computeDepositAllocations('100.01', [
    { id: '2', slug: 'travel', allocationPercent: '0.5000', sortOrder: 2, isActive: true },
    { id: '1', slug: 'savings', allocationPercent: '0.5000', sortOrder: 1, isActive: true },
  ]);

  assert.deepEqual(
    allocations.map((entry) => ({ slug: entry.slug, amount: entry.allocatedAmount })),
    [
      { slug: 'savings', amount: '50.01' },
      { slug: 'travel', amount: '50.00' },
    ],
  );
});
