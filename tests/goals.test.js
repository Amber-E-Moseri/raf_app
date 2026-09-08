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
import { computeFinancialHealthSnapshot } from '../lib/raf/reporting.js';

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
    async listAllocationCategories({ includeSuperseded = false, asOf = null } = {}) {
      const rows = state.allocationCategories.filter((row) => {
        if (includeSuperseded) {
          return true;
        }

        if (row.snapshotId == null) {
          return true;
        }

        const targetDate = asOf ?? '9999-12-31';
        return row.effectiveFrom <= targetDate && (!row.supersededAt || row.supersededAt > targetDate);
      });

      if (includeSuperseded || !rows.some((row) => row.snapshotId != null)) {
        return rows.map((row) => ({ ...row }));
      }

      const sortedSnapshots = [...new Set(rows.map((row) => row.snapshotId))]
        .sort((left, right) => {
          const leftRow = rows.find((row) => row.snapshotId === left);
          const rightRow = rows.find((row) => row.snapshotId === right);
          return String(rightRow?.effectiveFrom ?? '').localeCompare(String(leftRow?.effectiveFrom ?? ''));
        });
      const activeSnapshotId = sortedSnapshots[0];
      return rows.filter((row) => row.snapshotId === activeSnapshotId).map((row) => ({ ...row }));
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
    async deleteGoal({ goalId }) {
      state.goals = state.goals.filter((row) => row.id !== goalId);
      return true;
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

test('creating a goal accepts blank optional fields from the frontend as nulls', async () => {
  const db = createDbDouble();

  const result = await createGoal({
    db,
    householdId: 'household_1',
    input: {
      bucket_id: 'bucket_savings',
      name: 'Travel Fund',
      target_amount: '1500.00',
      target_date: null,
      notes: null,
      active: true,
    },
  });

  assert.equal(result.target_date, null);
  assert.equal(result.notes, null);
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

test('deleting an already archived goal removes it permanently', async () => {
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
        active: false,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-14T00:00:00.000Z',
      },
    ],
  });

  await deleteGoal({
    db,
    householdId: 'household_1',
    goalId: 'goal_1',
  });

  assert.equal(db.state.goals.length, 0);
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
      { id: 'txn_1', categoryId: 'bucket_savings', transactionDate: '2026-03-10', amount: '800.00', direction: 'credit', linkedGoalId: 'goal_1' },
      { id: 'txn_2', categoryId: 'bucket_savings', transactionDate: '2026-03-11', amount: '200.00', direction: 'credit' },
      { id: 'txn_3', categoryId: 'bucket_giving', transactionDate: '2026-04-01', amount: '50.00', direction: 'debit' },
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
      bucket_balance: '3000.00', // allocated $2000 + credit $800 (linked) + credit $200 (unlinked)
      target_amount: '5000.00',
      reserved_amount: '800.00', // only the explicitly linked credit counts toward progress
      current_amount: '800.00',
      remaining_amount: '4200.00',
      progress_percent: 16,
    },
  ]);
});

test('goal progress stays at zero when the linked bucket has money but no goal-linked transactions', async () => {
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

  assert.equal(result[0].bucket_balance, '600.00');
  assert.equal(result[0].reserved_amount, '0.00');
  assert.equal(result[0].current_amount, '0.00');
  assert.equal(result[0].remaining_amount, '1000.00');
  assert.equal(result[0].progress_percent, 0);
});

test('goal progress resolves historical bucket ids to the active bucket snapshot by slug', async () => {
  const db = createDbDouble({
    allocationCategories: [
      {
        id: 'bucket_savings_old',
        snapshotId: 'snapshot_old',
        effectiveFrom: '2026-01-01',
        supersededAt: '2026-03-01',
        label: 'Savings',
        slug: 'savings',
        isActive: true,
        sortOrder: 1,
      },
      {
        id: 'bucket_savings_current',
        snapshotId: 'snapshot_current',
        effectiveFrom: '2026-03-01',
        supersededAt: null,
        label: 'Savings',
        slug: 'savings',
        isActive: true,
        sortOrder: 1,
      },
    ],
    incomeAllocations: [
      { allocationCategoryId: 'bucket_savings_current', allocatedAmount: '500.00' },
    ],
    transactions: [
      { id: 'txn_1', categoryId: 'bucket_savings_current', transactionDate: '2026-03-10', amount: '125.00', direction: 'credit', linkedGoalId: 'goal_1' },
    ],
    goals: [
      {
        id: 'goal_1',
        householdId: 'household_1',
        bucketId: 'bucket_savings_old',
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

  assert.deepEqual(result, [
    {
      goal_id: 'goal_1',
      goal_name: 'Emergency Fund',
      bucket_id: 'bucket_savings_current',
      bucket: 'Savings',
      bucket_name: 'Savings',
      bucket_balance: '625.00', // allocated $500 + credit $125 (linked)
      target_amount: '1000.00',
      reserved_amount: '125.00',
      current_amount: '125.00',
      remaining_amount: '875.00',
      progress_percent: 12.5,
    },
  ]);
});

test('goal progress clamps remaining at zero and progress at 100 when linked goal transactions exceed target', async () => {
  const db = createDbDouble({
    goals: [
      {
        id: 'goal_1',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Emergency Fund',
        targetAmount: '500.00',
        targetDate: null,
        notes: null,
        active: true,
      },
    ],
    allocationCategories: [
      { id: 'bucket_savings', householdId: 'household_1', slug: 'savings', label: 'Savings', isActive: true, sortOrder: 1 },
    ],
    incomeAllocations: [
      { incomeEntryId: 'income_1', allocationCategoryId: 'bucket_savings', allocatedAmount: '800.00' },
    ],
    transactions: [
      { id: 'txn_1', householdId: 'household_1', categoryId: 'bucket_savings', transactionDate: '2026-03-12', amount: '750.00', direction: 'credit', linkedGoalId: 'goal_1' },
    ],
  });

  const result = await listGoalProgress({
    db,
    householdId: 'household_1',
  });

  assert.equal(result[0].bucket_balance, '1550.00'); // allocated $800 + credit $750 (linked)
  assert.equal(result[0].reserved_amount, '750.00');
  assert.equal(result[0].current_amount, '750.00');
  assert.equal(result[0].remaining_amount, '0.00');
  assert.equal(result[0].progress_percent, 100);
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

// ── G3: debit-direction equivalence regression ────────────────────────────────
//
// sumGoalLinkedTransactionCents (Goals API) must count debits as positive
// contributions, matching sumGoalLinkedContributionCents (Dashboard).
// A debit linked to a goal represents money moved INTO the goal (e.g. from
// savings bucket into an emergency fund account) — direction is irrelevant.
// This test fails if the signed-math branch is reintroduced.

test('G3: debit-linked transaction counts as goal progress (direction-independence)', async () => {
  const db = createDbDouble({
    allocationCategories: [
      { id: 'bucket_savings', label: 'Savings', slug: 'savings', isActive: true, sortOrder: 1 },
    ],
    incomeAllocations: [
      { allocationCategoryId: 'bucket_savings', allocatedAmount: '500.00' },
    ],
    transactions: [
      { id: 'txn_debit', categoryId: 'bucket_savings', transactionDate: '2026-03-10', amount: '200.00', direction: 'debit', linkedGoalId: 'goal_1' },
    ],
    goals: [
      { id: 'goal_1', householdId: 'household_1', bucketId: 'bucket_savings', name: 'Emergency Fund', targetAmount: '1000.00', active: true },
    ],
  });

  const result = await listGoalProgress({ db, householdId: 'household_1' });

  // Debit $200 linked to goal → $200 progress (not $0 from signed clamp)
  assert.equal(result[0].current_amount, '200.00');
  assert.equal(result[0].remaining_amount, '800.00');
  assert.equal(result[0].progress_percent, 20);
  // Bucket balance reflects the debit as spending: $500 - $200 = $300
  assert.equal(result[0].bucket_balance, '300.00');
  // The two are different — bucket balance ≠ goal progress — demonstrating independence
  assert.notEqual(result[0].bucket_balance, result[0].current_amount);
});

// ── G1: BLW fixture extension ─────────────────────────────────────────────────
//
// Reproduces the March-period BLW Canada demo. The $140 savings debit is
// the Emergency Fund contribution — it's a debit FROM savings bucket going TO
// the emergency fund account. sumGoalLinkedTransactionCents uses Math.abs, so
// this debit counts as +$140 toward the goal (same as the dashboard).
// Shows: bucket balance and goal progress are independent fields; linking
// updates current_amount but not bucket_balance.

test('G1: BLW fixture — bucket balance and goal progress are independently correct', async () => {
  const baseState = {
    allocationCategories: [
      { id: 'bucket_savings', label: 'Savings', slug: 'savings', isActive: true, sortOrder: 1 },
      { id: 'bucket_travel', label: 'Travel', slug: 'travel', isActive: true, sortOrder: 2 },
    ],
    // BLW Canada March: $242.125 rounded to cents for RAF storage
    incomeAllocations: [
      { allocationCategoryId: 'bucket_savings', allocatedAmount: '242.13' },
    ],
    transactions: [
      {
        id: 'txn_emergency',
        categoryId: 'bucket_savings',
        transactionDate: '2026-03-18',
        amount: '140.00',
        direction: 'debit', // money leaving savings bucket → going to emergency fund account
        description: 'Emergency Fund',
      },
    ],
    goals: [
      {
        id: 'goal_emergency',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Emergency Fund',
        targetAmount: '2000.00', // matches savings_floor from BLW fixture
        targetDate: null,
        notes: null,
        active: true,
      },
      {
        id: 'goal_vacation',
        householdId: 'household_1',
        bucketId: 'bucket_travel',
        name: 'Vacation',
        targetAmount: '1200.00',
        targetDate: null,
        notes: null,
        active: true,
      },
    ],
  };

  // Before linking: goal progress = $0, bucket balance reflects allocation - debit.
  const unlinkedDb = createDbDouble(baseState);
  const unlinkedProgress = await listGoalProgress({ db: unlinkedDb, householdId: 'household_1' });
  const unlinkedEmergency = unlinkedProgress.find((g) => g.goal_id === 'goal_emergency');
  const vacation = unlinkedProgress.find((g) => g.goal_id === 'goal_vacation');

  assert.equal(unlinkedEmergency.bucket_name, 'Savings');
  assert.equal(unlinkedEmergency.bucket_balance, '102.13'); // $242.13 allocated − $140.00 debit
  assert.equal(unlinkedEmergency.current_amount, '0.00');   // no goal-linked transactions yet
  assert.equal(unlinkedEmergency.progress_percent, 0);
  assert.equal(vacation.bucket_name, 'Travel');

  // After linking: goal progress = $140, bucket balance unchanged.
  const linkedDb = createDbDouble({
    ...baseState,
    transactions: baseState.transactions.map((t) => ({ ...t, linkedGoalId: 'goal_emergency' })),
  });
  const linkedProgress = await listGoalProgress({ db: linkedDb, householdId: 'household_1' });
  const linkedEmergency = linkedProgress.find((g) => g.goal_id === 'goal_emergency');

  assert.equal(linkedEmergency.bucket_balance, '102.13'); // unchanged — goal-linking doesn't move it
  assert.equal(linkedEmergency.current_amount, '140.00'); // debit counts as +$140 contribution
  assert.equal(linkedEmergency.remaining_amount, '1860.00');
  assert.equal(linkedEmergency.progress_percent, 7);
  // G0.6 consequence: emergencyFundBalance is driven by monthlyReviews.distributions,
  // so it is not tested here — it is covered in the G0.6/G3 test below.
});

// ── G2: Deactivated-bucket enforcement ───────────────────────────────────────
//
// Attempt to create/update a goal linked to a deactivated bucket.
// requireActiveBucket() throws HTTP 422. This is the real server-side
// enforcement path, not a convention — the test traces the actual handler.

test('G2: goal create and update reject a deactivated bucket with HTTP 422', async () => {
  const db = createDbDouble({
    allocationCategories: [
      { id: 'bucket_savings', label: 'Savings', slug: 'savings', isActive: true },
      { id: 'bucket_inactive', label: 'Paused', slug: 'paused', isActive: false },
    ],
    goals: [
      {
        id: 'goal_1',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Active Goal',
        targetAmount: '1000.00',
        active: true,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ],
  });

  const createResponse = await POST(
    new Request('http://localhost/api/v1/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-household-id': 'household_1' },
      body: JSON.stringify({ bucket_id: 'bucket_inactive', name: 'Bad Goal', target_amount: '500.00' }),
    }),
    { db },
  );
  assert.equal(createResponse.status, 422);
  assert.match((await createResponse.json()).error, /active allocation bucket/);

  const updateResponse = await PUT(
    new Request('http://localhost/api/v1/goals/goal_1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-household-id': 'household_1' },
      body: JSON.stringify({ bucket_id: 'bucket_inactive' }),
    }),
    { db, params: { id: 'goal_1' } },
  );
  assert.equal(updateResponse.status, 422);
  assert.match((await updateResponse.json()).error, /active allocation bucket/);
});

// ── G0.6 / G3: emergencyFundBalance isolation ────────────────────────────────
//
// Proves that linking a transaction to a goal has ZERO effect on the
// emergencyFundBalance field in computeFinancialHealthSnapshot. That field
// reads ONLY from monthlyReviews.distributions.emergency_fund — no goals,
// no linkedGoalId, no transaction scan.

test('G0.6 / G3: goal-linked transactions do not affect emergencyFundBalance in the financial health report', () => {
  // computeFinancialHealthSnapshot takes pre-fetched data, not a db connection.
  // emergencyFundBalance is derived ONLY from monthlyReviews.distributions.emergency_fund.
  const household = { savingsFloor: '0.00', savingsFloorEnabled: false, monthlyEssentialsBaseline: '0.00' };
  const monthlyReviews = [{ distributions: { emergency_fund: '200.00' } }];

  const txnUnlinked = { id: 'txn_1', categoryId: 'bucket_savings', amount: '140.00', direction: 'debit' };
  const txnLinked = { ...txnUnlinked, linkedGoalId: 'goal_emergency' };

  const unlinked = computeFinancialHealthSnapshot({
    household,
    activeMonthIncomeEntries: [],
    activeMonthTransactions: [txnUnlinked],
    activeMonthDebtPayments: [],
    monthlyReviews,
  });

  const linked = computeFinancialHealthSnapshot({
    household,
    activeMonthIncomeEntries: [],
    activeMonthTransactions: [txnLinked],
    activeMonthDebtPayments: [],
    monthlyReviews,
  });

  // emergencyFundBalance must not change when a transaction is linked to a goal
  assert.equal(unlinked.emergencyFundBalance, linked.emergencyFundBalance);
  // The value comes solely from monthlyReviews.distributions.emergency_fund
  assert.equal(linked.emergencyFundBalance, '200.00');
});
