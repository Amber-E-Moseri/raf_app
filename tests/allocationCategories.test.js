import test from 'node:test';
import assert from 'node:assert/strict';

import { GET, PUT } from '../app/api/v1/household/allocation-categories/route.js';
import {
  listHouseholdAllocationCategories,
  replaceHouseholdAllocationCategories,
} from '../lib/household/allocationCategories.js';
import { computeDepositAllocations } from '../lib/raf/computeDepositAllocations.js';

function createDbDouble(categories) {
  const state = {
    categories: categories.map((category) => ({ ...category })),
  };

  const tx = {
    async listAllocationCategories() {
      return state.categories.map((category) => ({ ...category }));
    },
    async replaceAllocationCategories({ items }) {
      const bySlug = new Map(state.categories.map((category) => [category.slug, category]));
      for (const item of items) {
        Object.assign(bySlug.get(item.slug), item);
      }
      return tx.listAllocationCategories();
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

function defaultCategories() {
  return [
    { id: 'cat_savings', slug: 'savings', label: 'Savings', allocationPercent: '0.1000', sortOrder: 1, isSystem: true, isActive: true, isBuffer: false },
    { id: 'cat_bills', slug: 'fixed_bills', label: 'Fixed Bills', allocationPercent: '0.3000', sortOrder: 2, isSystem: true, isActive: true, isBuffer: false },
    { id: 'cat_spending', slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '0.1500', sortOrder: 3, isSystem: true, isActive: true, isBuffer: false },
    { id: 'cat_investment', slug: 'investment', label: 'Investment', allocationPercent: '0.1000', sortOrder: 4, isSystem: false, isActive: true, isBuffer: false },
    { id: 'cat_debt', slug: 'debt_payoff', label: 'Debt Payoff', allocationPercent: '0.1000', sortOrder: 5, isSystem: false, isActive: true, isBuffer: false },
    { id: 'cat_buffer', slug: 'buffer', label: 'Buffer', allocationPercent: '0.2500', sortOrder: 9, isSystem: true, isActive: true, isBuffer: true },
  ];
}

test('listHouseholdAllocationCategories returns formatted category rows', async () => {
  const db = createDbDouble(defaultCategories());

  const result = await listHouseholdAllocationCategories({
    db,
    householdId: 'household_1',
  });

  assert.equal(result.items.length, 6);
  assert.deepEqual(result.items[0], {
    id: 'cat_savings',
    name: 'Savings',
    label: 'Savings',
    slug: 'savings',
    percent: '0.1000',
    allocationPercent: '0.1000',
    isActive: true,
    active: true,
    sortOrder: 1,
    isSystem: true,
    isBuffer: false,
  });
});

test('replaceHouseholdAllocationCategories updates editable fields and preserves a single active buffer', async () => {
  const db = createDbDouble(defaultCategories());

  const result = await replaceHouseholdAllocationCategories({
    db,
    householdId: 'household_1',
    input: {
      items: [
        { slug: 'savings', label: 'Reserve', allocationPercent: '0.1500', sortOrder: 1, isActive: true, isBuffer: false },
        { slug: 'fixed_bills', label: 'Fixed Bills', allocationPercent: '0.2500', sortOrder: 2, isActive: true, isBuffer: false },
        { slug: 'personal_spending', label: 'Daily Spending', allocationPercent: '0.1500', sortOrder: 3, isActive: true, isBuffer: false },
        { slug: 'investment', label: 'Investing', allocationPercent: '0.1000', sortOrder: 4, isActive: true, isBuffer: false },
        { slug: 'debt_payoff', label: 'Debt Payoff', allocationPercent: '0.1000', sortOrder: 5, isActive: true, isBuffer: false },
        { slug: 'buffer', label: 'Operating Buffer', allocationPercent: '0.2500', sortOrder: 6, isActive: true, isBuffer: true },
      ],
    },
  });

  assert.equal(result.items.find((item) => item.slug === 'buffer').isBuffer, true);
  assert.equal(result.items.find((item) => item.slug === 'buffer').label, 'Operating Buffer');
  assert.equal(result.items.find((item) => item.slug === 'savings').label, 'Reserve');
});

test('replaceHouseholdAllocationCategories rejects invalid active percentage totals', async () => {
  const db = createDbDouble(defaultCategories());

  await assert.rejects(
    () => replaceHouseholdAllocationCategories({
      db,
      householdId: 'household_1',
      input: {
        items: defaultCategories().map((category) => ({
          slug: category.slug,
          label: category.label,
          allocationPercent: category.slug === 'buffer' ? '0.2000' : category.allocationPercent,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          isBuffer: category.isBuffer,
        })),
      },
    }),
    /must sum to 1\.0000/,
  );
});

test('computeDepositAllocations routes remainder to the configured buffer category', () => {
  const result = computeDepositAllocations('100.01', [
    { id: 'cat_a', slug: 'primary', allocationPercent: '0.5000', sortOrder: 1, isActive: true, isBuffer: false },
    { id: 'cat_b', slug: 'reserve', allocationPercent: '0.5000', sortOrder: 2, isActive: true, isBuffer: true },
  ]);

  assert.deepEqual(result, [
    { categoryId: 'cat_a', slug: 'primary', allocationPercent: '0.5000', allocatedAmount: '50.00' },
    { categoryId: 'cat_b', slug: 'reserve', allocationPercent: '0.5000', allocatedAmount: '50.01' },
  ]);
});

test('household allocation category routes expose GET and PUT payloads', async () => {
  const db = createDbDouble(defaultCategories());

  const getResponse = await GET(
    new Request('http://localhost/api/v1/household/allocation-categories', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );

  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).items.length, 6);

  const putResponse = await PUT(
    new Request('http://localhost/api/v1/household/allocation-categories', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        items: defaultCategories().map((category) => ({
          slug: category.slug,
          label: category.label,
          allocationPercent: category.allocationPercent,
          sortOrder: category.sortOrder,
          isActive: category.isActive,
          isBuffer: category.isBuffer,
        })),
      }),
    }),
    { db },
  );

  assert.equal(putResponse.status, 200);
  assert.equal(Array.isArray((await putResponse.json()).items), true);
});
