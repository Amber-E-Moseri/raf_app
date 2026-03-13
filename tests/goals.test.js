import test from 'node:test';
import assert from 'node:assert/strict';

import { GET, POST } from '../app/api/v1/goals/route.js';
import { DELETE, PUT } from '../app/api/v1/goals/[id]/route.js';
import {
  createGoal,
  deleteGoal,
  listGoalProgress,
  listGoals,
  updateGoal,
} from '../lib/goals/goals.js';

function createDbDouble({
  allocationCategories = [
    { id: 'bucket_savings', label: 'Savings', slug: 'savings', isActive: true, sortOrder: 1 },
    { id: 'bucket_giving', label: 'Giving', slug: 'giving', isActive: true, sortOrder: 2 },
  ],
  incomeAllocations = [],
  transactions = [],
  goals = [],
} = {}) {
  const state = {
    allocationCategories: allocationCategories.map((row) => ({ ...row })),
    incomeAllocations: incomeAllocations.map((row) => ({ ...row })),
    transactions: transactions.map((row) => ({ ...row })),
    goals: goals.map((row) => ({ ...row })),
  };

  const tx = {
    async listAllocationCategories() {
      return state.allocationCategories.map((row) => ({ ...row }));
    },
    async listTransactions() {
      return state.transactions.map((row) => ({ ...row }));
    },
    async listIncomeAllocations() {
      return state.incomeAllocations.map((row) => ({ ...row }));
    },
    async listGoals() {
      return state.goals.map((row) => ({ ...row }));
    },
    async insertGoal(payload) {
      const created = {
        id: `goal_${state.goals.length + 1}`,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
        ...payload,
      };
      state.goals.push(created);
      return { ...created };
    },
    async getGoalById({ goalId }) {
      return state.goals.find((row) => row.id === goalId) ?? null;
    },
    async updateGoal({ goalId, patch }) {
      const index = state.goals.findIndex((row) => row.id === goalId);
      state.goals[index] = {
        ...state.goals[index],
        ...patch,
        updatedAt: '2026-03-14T00:00:00.000Z',
      };
      return { ...state.goals[index] };
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

test('creating a goal stores a household-scoped progress target linked to a bucket', async () => {
  const db = createDbDouble();

  const result = await createGoal({
    db,
    householdId: 'household_1',
    input: {
      bucket_id: 'bucket_savings',
      name: 'Emergency Fund',
      target_amount: '5000.00',
      target_date: '2026-12-31',
      notes: 'Six months of expenses',
      active: true,
    },
  });

  assert.deepEqual(result, {
    id: 'goal_1',
    household_id: 'household_1',
    bucket_id: 'bucket_savings',
    name: 'Emergency Fund',
    target_amount: '5000.00',
    target_date: '2026-12-31',
    notes: 'Six months of expenses',
    active: true,
    created_at: '2026-03-13T00:00:00.000Z',
    updated_at: '2026-03-13T00:00:00.000Z',
  });
});

test('editing a goal updates editable fields only', async () => {
  const db = createDbDouble({
    goals: [
      {
        id: 'goal_1',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Emergency Fund',
        targetAmount: '5000.00',
        targetDate: null,
        notes: null,
        active: true,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ],
  });

  const result = await updateGoal({
    db,
    householdId: 'household_1',
    goalId: 'goal_1',
    input: {
      target_amount: '6000.00',
      notes: 'Expanded target',
    },
  });

  assert.equal(result.target_amount, '6000.00');
  assert.equal(result.notes, 'Expanded target');
});

test('deleting a goal deactivates it without altering transactions', async () => {
  const db = createDbDouble({
    transactions: [
      { id: 'txn_1', categoryId: 'bucket_savings', transactionDate: '2026-03-10', amount: '100.00', direction: 'credit' },
    ],
    goals: [
      {
        id: 'goal_1',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Emergency Fund',
        targetAmount: '5000.00',
        targetDate: null,
        notes: null,
        active: true,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ],
  });

  await deleteGoal({
    db,
    householdId: 'household_1',
    goalId: 'goal_1',
  });

  assert.equal(db.state.goals[0].active, false);
  assert.equal(db.state.transactions.length, 1);
});

test('bucket linkage validation requires an active allocation bucket', async () => {
  const db = createDbDouble({
    allocationCategories: [
      { id: 'bucket_savings', label: 'Savings', slug: 'savings', isActive: false },
    ],
  });

  await assert.rejects(
    () => createGoal({
      db,
      householdId: 'household_1',
      input: {
        bucket_id: 'bucket_savings',
        name: 'Emergency Fund',
        target_amount: '5000.00',
      },
    }),
    /bucket_id must reference an active allocation bucket/,
  );
});

test('goal progress is derived from the current reserved bucket balance', async () => {
  const db = createDbDouble({
    incomeAllocations: [
      { allocationCategoryId: 'bucket_savings', allocatedAmount: '2000.00' },
      { allocationCategoryId: 'bucket_giving', allocatedAmount: '500.00' },
    ],
    transactions: [
      { id: 'txn_1', categoryId: 'bucket_savings', transactionDate: '2026-03-10', amount: '200.00', direction: 'debit' },
      { id: 'txn_2', categoryId: 'bucket_giving', transactionDate: '2026-04-01', amount: '50.00', direction: 'debit' },
    ],
    goals: [
      {
        id: 'goal_1',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Emergency Fund',
        targetAmount: '5000.00',
        targetDate: null,
        notes: null,
        active: true,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ],
  });

  const result = await listGoalProgress({
    db,
    householdId: 'household_1',
  });

  assert.deepEqual(result, [
    {
      goal_id: 'goal_1',
      goal_name: 'Emergency Fund',
      bucket_id: 'bucket_savings',
      bucket: 'Savings',
      bucket_name: 'Savings',
      target_amount: '5000.00',
      reserved_amount: '1800.00',
      current_amount: '1800.00',
      remaining_amount: '3200.00',
      progress_percent: 36,
    },
  ]);
});

test('goal progress ignores target date windows and uses current reserved balance', async () => {
  const db = createDbDouble({
    incomeAllocations: [
      { allocationCategoryId: 'bucket_savings', allocatedAmount: '600.00' },
    ],
    transactions: [
      { id: 'txn_1', categoryId: 'bucket_savings', transactionDate: '2025-06-10', amount: '50.00', direction: 'debit' },
      { id: 'txn_2', categoryId: 'bucket_savings', transactionDate: '2027-01-15', amount: '50.00', direction: 'credit' },
    ],
    goals: [
      {
        id: 'goal_1',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Emergency Fund',
        targetAmount: '1000.00',
        targetDate: null,
        notes: null,
        active: true,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ],
  });

  const result = await listGoalProgress({
    db,
    householdId: 'household_1',
  });

  assert.equal(result[0].reserved_amount, '600.00');
  assert.equal(result[0].current_amount, '600.00');
  assert.equal(result[0].remaining_amount, '400.00');
  assert.equal(result[0].progress_percent, 60);
});

test('goal routes expose GET, POST, PUT, and DELETE', async () => {
  const db = createDbDouble();

  const postResponse = await POST(
    new Request('http://localhost/api/v1/goals', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        bucket_id: 'bucket_savings',
        name: 'Emergency Fund',
        target_amount: '5000.00',
      }),
    }),
    { db },
  );
  assert.equal(postResponse.status, 201);

  const getResponse = await GET(
    new Request('http://localhost/api/v1/goals', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).items.length, 1);

  const putResponse = await PUT(
    new Request('http://localhost/api/v1/goals/goal_1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        target_amount: '5500.00',
      }),
    }),
    { db, params: { id: 'goal_1' } },
  );
  assert.equal(putResponse.status, 200);

  const deleteResponse = await DELETE(
    new Request('http://localhost/api/v1/goals/goal_1', {
      method: 'DELETE',
      headers: { 'x-household-id': 'household_1' },
    }),
    { db, params: { id: 'goal_1' } },
  );
  assert.equal(deleteResponse.status, 204);

  const listed = await listGoals({ db, householdId: 'household_1' });
  assert.equal(listed.items[0].active, false);
});
