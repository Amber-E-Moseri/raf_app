import test from 'node:test';
import assert from 'node:assert/strict';

import { GET as getDashboardRoute } from '../app/api/v1/reports/dashboard/route.js';
import { GET as getDashboardAggregateRoute } from '../app/api/v1/reports/dashboard-aggregate/route.js';
import { GET as getFinancialHealthRoute } from '../app/api/v1/reports/financial-health/route.js';
import { GET as getIncomeAllocationsRoute } from '../app/api/v1/reports/income-allocations/route.js';
import { GET as getMonthlyReviewReportRoute } from '../app/api/v1/reports/monthly-review/route.js';
import { GET as getSurplusRecommendationsRoute } from '../app/api/v1/reports/surplus-recommendations/route.js';
import { GET as getHouseholdRoute, PATCH as patchHouseholdRoute } from '../app/api/v1/household/route.js';
import { GET as listMonthlyReviewsRoute, POST as createMonthlyReviewRoute } from '../app/api/v1/monthly-reviews/route.js';
import { PATCH as patchMonthlyReviewRoute } from '../app/api/v1/monthly-reviews/[id]/route.js';
import { getFinancialHealthReport } from '../lib/reports/getFinancialHealthReport.js';
import { getIncomeAllocationsReport } from '../lib/reports/getIncomeAllocationsReport.js';
import { getDashboardReport } from '../lib/reports/getDashboardReport.js';
import { getMonthlyReviewReport } from '../lib/reports/getMonthlyReviewReport.js';
import { createMonthlyReview } from '../lib/monthlyReviews/monthlyReviews.js';
import { buildNetSurplusExplanation } from '../lib/raf/reporting.js';

function createDbDouble({
  incomeEntries = [],
  incomeAllocations = [],
  transactions = [],
  debtPayments = [],
  debts = [],
  debtAdjustments = [],
  fixedBills = [],
  goals = [],
  allocationCategories = [
    { id: 'cat_fixed_bills', slug: 'fixed_bills', isActive: true },
    { id: 'cat_personal_spending', slug: 'personal_spending', isActive: true },
  ],
  surplusSplitRules = [],
  monthlyReviews = [],
  household = {
    id: 'household_1',
    name: 'Household 1',
    timezone: 'America/Toronto',
    activeMonth: '2026-03-01',
    periodStartDay: 1,
    savingsFloor: '50.00',
    savingsFloorEnabled: false,
    monthlyEssentialsBaseline: '200.00',
  },
} = {}) {
  const state = {
    monthlyReviews: monthlyReviews.map((row) => ({ ...row })),
    household: { ...household },
  };

  const tx = {
    async listIncomeEntries({ from, to }) {
      return incomeEntries.filter((entry) => entry.receivedDate >= from && entry.receivedDate < incrementMonth(to));
    },
    async listIncomeAllocations({ from, to }) {
      return incomeAllocations.filter((entry) => entry.receivedDate >= from && entry.receivedDate < incrementMonth(to));
    },
    async listTransactions({ from, to }) {
      if (!from || !to) {
        return transactions;
      }

      return transactions.filter((entry) => entry.transactionDate >= from && entry.transactionDate < incrementMonth(to));
    },
    async listDebtPayments({ from, to }) {
      return debtPayments.filter((entry) => entry.paymentDate >= from && entry.paymentDate < incrementMonth(to));
    },
    async listDebts() {
      return debts;
    },
    async listDebtAdjustments({ debtId = null }) {
      return debtAdjustments.filter((entry) => (debtId ? entry.debtId === debtId : true));
    },
    async listFixedBills() {
      return fixedBills;
    },
    async listGoals() {
      return goals;
    },
    async listAllocationCategories({ includeSuperseded = false, asOf = null } = {}) {
      const rows = allocationCategories.filter((row) => {
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
        return rows;
      }

      const sortedSnapshots = [...new Set(rows.map((row) => row.snapshotId))]
        .sort((left, right) => {
          const leftRow = rows.find((row) => row.snapshotId === left);
          const rightRow = rows.find((row) => row.snapshotId === right);
          return String(rightRow?.effectiveFrom ?? '').localeCompare(String(leftRow?.effectiveFrom ?? ''));
        });
      const activeSnapshotId = sortedSnapshots[0];
      return rows.filter((row) => row.snapshotId === activeSnapshotId);
    },
    async listIncomeAllocationsBySlug({ slug, from, to }) {
      return incomeAllocations.filter((entry) => {
        if (entry.slug !== slug) {
          return false;
        }

        if (!from || !to) {
          return true;
        }

        return entry.receivedDate >= from && entry.receivedDate < incrementMonth(to);
      });
    },
    async listSurplusSplitRules() {
      return surplusSplitRules;
    },
    async getHousehold() {
      return state.household;
    },
    async updateHousehold({ patch }) {
      state.household = { ...state.household, ...patch };
      return state.household;
    },
    async getMonthlyReviewByMonth({ reviewMonth }) {
      return state.monthlyReviews.find((row) => row.reviewMonth === reviewMonth) ?? null;
    },
    async insertMonthlyReview(payload) {
      const review = { id: `review_${state.monthlyReviews.length + 1}`, ...payload };
      state.monthlyReviews.push(review);
      return review;
    },
    async listMonthlyReviews({ from, to }) {
      return state.monthlyReviews.filter((row) => row.reviewMonth >= from && row.reviewMonth <= to);
    },
    async getMonthlyReviewById({ reviewId }) {
      return state.monthlyReviews.find((row) => row.id === reviewId) ?? null;
    },
    async updateMonthlyReview({ reviewId, patch }) {
      const index = state.monthlyReviews.findIndex((row) => row.id === reviewId);
      state.monthlyReviews[index] = { ...state.monthlyReviews[index], ...patch };
      return state.monthlyReviews[index];
    },
    async getIncomeEntryById({ incomeId }) {
      return incomeEntries.find((entry) => entry.id === incomeId) ?? null;
    },
    async listIncomeAllocations({ incomeEntryId, from, to }) {
      if (incomeEntryId) {
        return incomeAllocations.filter((entry) => entry.incomeEntryId === incomeEntryId);
      }

      if (!from || !to) {
        return incomeAllocations;
      }

      return incomeAllocations.filter((entry) => entry.receivedDate >= from && entry.receivedDate < incrementMonth(to));
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

function incrementMonth(month) {
  const value = new Date(`${month}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

test('getDashboardReport aggregates period income, spending, savings, and alert status', async () => {
  const db = createDbDouble({
    incomeEntries: [
      { receivedDate: '2026-03-10', amount: '1000.00' },
      { receivedDate: '2026-04-10', amount: '800.00' },
    ],
    incomeAllocations: [
      { receivedDate: '2026-03-10', slug: 'savings', allocatedAmount: '100.00' },
      { receivedDate: '2026-04-10', slug: 'savings', allocatedAmount: '80.00' },
    ],
    transactions: [
      { transactionDate: '2026-03-12', amount: '700.00', direction: 'debit' },
      { transactionDate: '2026-04-12', amount: '900.00', direction: 'debit' },
      { transactionDate: '2026-04-20', amount: '-10.00', direction: 'credit' },
    ],
    debtPayments: [
      { paymentDate: '2026-03-15', amount: '100.00' },
      { paymentDate: '2026-04-16', amount: '300.00' },
    ],
  });

  const result = await getDashboardReport({
    db,
    householdId: 'household_1',
    from: '2026-03-01',
    to: '2026-04-01',
  });

  assert.deepEqual(result, {
    periods: [
      {
        month: '2026-03-01',
        incomeTotal: '1000.00',
        spendingTotal: '700.00',
        surplusOrDeficit: '300.00',
        savingsActual: '100.00',
        alertStatus: 'ok',
        explanations: {
          netSurplus: buildNetSurplusExplanation({
            month: '2026-03-01',
            incomeCents: 100000,
            spendingCents: 70000,
          }),
        },
      },
      {
        month: '2026-04-01',
        incomeTotal: '800.00',
        spendingTotal: '900.00',
        surplusOrDeficit: '-100.00',
        savingsActual: '80.00',
        alertStatus: 'risky',
        explanations: {
          netSurplus: buildNetSurplusExplanation({
            month: '2026-04-01',
            incomeCents: 80000,
            spendingCents: 90000,
          }),
        },
      },
    ],
    upcoming_fixed_bills_this_month: [],
    total_expected_fixed_bills_this_month: '0.00',
    bucket_balances: [
      {
        bucket_id: 'cat_fixed_bills',
        bucket_name: 'fixed_bills',
        slug: 'fixed_bills',
        balance: '0.00',
        percent_of_total: 0,
      },
      {
        bucket_id: 'cat_personal_spending',
        bucket_name: 'personal_spending',
        slug: 'personal_spending',
        balance: '0.00',
        percent_of_total: 0,
      },
    ],
    monthly_bucket_progress: [
      {
        bucket_id: 'cat_fixed_bills',
        bucket_name: 'fixed_bills',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
      {
        bucket_id: 'cat_personal_spending',
        bucket_name: 'personal_spending',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
    ],
    ytd_bucket_progress: [
      {
        bucket_id: 'cat_fixed_bills',
        bucket_name: 'fixed_bills',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
      {
        bucket_id: 'cat_personal_spending',
        bucket_name: 'personal_spending',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
    ],
    ttd_bucket_progress: [
      {
        bucket_id: 'cat_fixed_bills',
        bucket_name: 'fixed_bills',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
      {
        bucket_id: 'cat_personal_spending',
        bucket_name: 'personal_spending',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
    ],
    goal_progress: [],
  });
});

test('getDashboardReport accepts paginated transaction results from the DB adapter', async () => {
  const db = createDbDouble({
    incomeEntries: [{ receivedDate: '2026-03-10', amount: '1000.00' }],
    incomeAllocations: [{ receivedDate: '2026-03-10', slug: 'savings', allocatedAmount: '100.00' }],
    transactions: [{ transactionDate: '2026-03-12', amount: '700.00', direction: 'debit' }],
    debtPayments: [{ paymentDate: '2026-03-15', amount: '100.00' }],
  });

  const originalListTransactions = db.transaction;
  db.transaction = async (callback) => originalListTransactions.call(db, async (tx) => callback({
    ...tx,
    async listTransactions({ from, to }) {
      const items = await tx.listTransactions({ from, to });
      return { items, nextCursor: null };
    },
  }));

  const result = await getDashboardReport({
    db,
    householdId: 'household_1',
    from: '2026-03-01',
    to: '2026-03-01',
  });

  assert.equal(result.periods[0].spendingTotal, '700.00');
  assert.equal(result.total_expected_fixed_bills_this_month, '0.00');
  assert.equal(Array.isArray(result.bucket_balances), true);
  assert.equal(Array.isArray(result.monthly_bucket_progress), true);
  assert.deepEqual(result.goal_progress, []);
});

test('dashboard totals include only active fixed bills', async () => {
  const db = createDbDouble({
    fixedBills: [
      {
        id: 'bill_1',
        householdId: 'household_1',
        name: 'Rent',
        categorySlug: 'fixed_bills',
        expectedAmount: '1800.00',
        dueDayOfMonth: 1,
        active: true,
      },
      {
        id: 'bill_2',
        householdId: 'household_1',
        name: 'Phone',
        categorySlug: 'fixed_bills',
        expectedAmount: '80.00',
        dueDayOfMonth: 12,
        active: true,
      },
      {
        id: 'bill_3',
        householdId: 'household_1',
        name: 'Streaming',
        categorySlug: 'personal_spending',
        expectedAmount: '19.99',
        dueDayOfMonth: 20,
        active: false,
      },
    ],
  });

  const result = await getDashboardReport({
    db,
    householdId: 'household_1',
    from: '2026-03-01',
    to: '2026-03-01',
  });

  assert.deepEqual(result.upcoming_fixed_bills_this_month, [
    {
      id: 'bill_1',
      name: 'Rent',
      category_slug: 'fixed_bills',
      expected_amount: '1800.00',
      due_day_of_month: 1,
    },
    {
      id: 'bill_2',
      name: 'Phone',
      category_slug: 'fixed_bills',
      expected_amount: '80.00',
      due_day_of_month: 12,
    },
  ]);
  assert.equal(result.total_expected_fixed_bills_this_month, '1880.00');
});

test('dashboard reporting includes monthly bucket progress and goal progress', async () => {
  const db = createDbDouble({
    allocationCategories: [
      { id: 'bucket_savings', label: 'Savings', slug: 'savings', isActive: true, sortOrder: 1 },
      { id: 'bucket_giving', label: 'Giving', slug: 'giving', isActive: true, sortOrder: 2 },
    ],
    incomeAllocations: [
      { allocationCategoryId: 'bucket_savings', receivedDate: '2026-03-01', allocatedAmount: '2000.00' },
      { allocationCategoryId: 'bucket_giving', receivedDate: '2026-03-01', allocatedAmount: '500.00' },
    ],
    transactions: [
      { id: 'txn_2', transactionDate: '2026-03-12', amount: '200.00', direction: 'debit', categoryId: 'bucket_savings' },
      { id: 'txn_3', transactionDate: '2026-03-12', amount: '100.00', direction: 'credit', categoryId: 'bucket_giving' },
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
      },
    ],
  });

  const result = await getDashboardReport({
    db,
    householdId: 'household_1',
    from: '2026-03-01',
    to: '2026-03-01',
  });

  assert.deepEqual(result.goal_progress, [
    {
      goal_id: 'goal_1',
      goal_name: 'Emergency Fund',
      bucket_id: 'bucket_savings',
      bucket: 'Savings',
      bucket_name: 'Savings',
      target_amount: '5000.00',
      bucket_balance: '1800.00',
      reserved_amount: '0.00',
      current_amount: '0.00',
      remaining_amount: '5000.00',
      progress_percent: 0,
    },
  ]);
  assert.deepEqual(result.bucket_balances, [
    {
      bucket_id: 'bucket_savings',
      bucket_name: 'Savings',
      slug: 'savings',
      balance: '1800.00',
      percent_of_total: 75,
    },
    {
      bucket_id: 'bucket_giving',
      bucket_name: 'Giving',
      slug: 'giving',
      balance: '600.00',
      percent_of_total: 25,
    },
  ]);
  assert.deepEqual(result.monthly_bucket_progress, [
    {
      bucket_id: 'bucket_savings',
      bucket_name: 'Savings',
      allocated_this_month: '2000.00',
      added_this_month: '0.00',
      used_this_month: '200.00',
      reserved_for_goals_this_month: '0.00',
      available_this_month: '1800.00',
      remaining_this_month: '1800.00',
      percent_used_this_month: 10,
      percent_reserved_for_goals_this_month: 0,
    },
    {
      bucket_id: 'bucket_giving',
      bucket_name: 'Giving',
      allocated_this_month: '500.00',
      added_this_month: '100.00',
      used_this_month: '0.00',
      reserved_for_goals_this_month: '0.00',
      available_this_month: '600.00',
      remaining_this_month: '600.00',
      percent_used_this_month: 0,
      percent_reserved_for_goals_this_month: 0,
    },
  ]);
});

test('dashboard monthly bucket progress separates current-month goal reservations from bucket availability', async () => {
  const db = createDbDouble({
    allocationCategories: [
      { id: 'bucket_savings', label: 'Savings', slug: 'savings', isActive: true, sortOrder: 1 },
      { id: 'bucket_giving', label: 'Giving', slug: 'giving', isActive: true, sortOrder: 2 },
    ],
    incomeAllocations: [
      { allocationCategoryId: 'bucket_savings', receivedDate: '2026-03-01', allocatedAmount: '500.00' },
      { allocationCategoryId: 'bucket_giving', receivedDate: '2026-03-01', allocatedAmount: '250.00' },
      { allocationCategoryId: 'bucket_savings', receivedDate: '2026-02-01', allocatedAmount: '900.00' },
    ],
    transactions: [
      { id: 'txn_goal_1', transactionDate: '2026-03-05', amount: '200.00', direction: 'credit', categoryId: 'bucket_savings', linkedGoalId: 'goal_active' },
      { id: 'txn_goal_2', transactionDate: '2026-02-12', amount: '300.00', direction: 'credit', categoryId: 'bucket_savings', linkedGoalId: 'goal_active' },
      { id: 'txn_goal_3', transactionDate: '2026-03-08', amount: '125.00', direction: 'credit', categoryId: 'bucket_savings', linkedGoalId: 'goal_archived' },
      { id: 'txn_goal_4', transactionDate: '2026-03-10', amount: '40.00', direction: 'credit', categoryId: 'bucket_giving', linkedGoalId: 'goal_other_bucket' },
    ],
    goals: [
      {
        id: 'goal_active',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Emergency Fund',
        targetAmount: '1000.00',
        targetDate: null,
        notes: null,
        active: true,
      },
      {
        id: 'goal_archived',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Old Goal',
        targetAmount: '1000.00',
        targetDate: null,
        notes: null,
        active: false,
      },
      {
        id: 'goal_other_bucket',
        householdId: 'household_1',
        bucketId: 'bucket_giving',
        name: 'Giving Goal',
        targetAmount: '100.00',
        targetDate: null,
        notes: null,
        active: true,
      },
    ],
  });

  const result = await getDashboardReport({
    db,
    householdId: 'household_1',
    from: '2026-03-01',
    to: '2026-03-01',
  });

  assert.deepEqual(result.monthly_bucket_progress, [
    {
      bucket_id: 'bucket_savings',
      bucket_name: 'Savings',
      allocated_this_month: '500.00',
      added_this_month: '325.00',
      used_this_month: '0.00',
      reserved_for_goals_this_month: '200.00',
      available_this_month: '625.00',
      remaining_this_month: '825.00',
      percent_used_this_month: 0,
      percent_reserved_for_goals_this_month: 40,
    },
    {
      bucket_id: 'bucket_giving',
      bucket_name: 'Giving',
      allocated_this_month: '250.00',
      added_this_month: '40.00',
      used_this_month: '0.00',
      reserved_for_goals_this_month: '40.00',
      available_this_month: '250.00',
      remaining_this_month: '290.00',
      percent_used_this_month: 0,
      percent_reserved_for_goals_this_month: 16,
    },
  ]);
});

test('dashboard goal progress clamps overfunded goals at zero remaining and 100 percent progress', async () => {
  const db = createDbDouble({
    allocationCategories: [
      { id: 'bucket_savings', label: 'Savings', slug: 'savings', isActive: true, sortOrder: 1 },
    ],
    incomeAllocations: [
      { allocationCategoryId: 'bucket_savings', receivedDate: '2026-03-01', allocatedAmount: '750.00' },
    ],
    transactions: [
      { id: 'txn_1', categoryId: 'bucket_savings', transactionDate: '2026-03-20', amount: '750.00', direction: 'credit', linkedGoalId: 'goal_1' },
    ],
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
  });

  const result = await getDashboardReport({
    db,
    householdId: 'household_1',
    from: '2026-03-01',
    to: '2026-03-01',
  });

  assert.deepEqual(result.goal_progress, [
    {
      goal_id: 'goal_1',
      goal_name: 'Emergency Fund',
      bucket_id: 'bucket_savings',
      bucket: 'Savings',
      bucket_name: 'Savings',
      target_amount: '500.00',
      bucket_balance: '1500.00',
      reserved_amount: '750.00',
      current_amount: '750.00',
      remaining_amount: '0.00',
      progress_percent: 100,
    },
  ]);
});

test('dashboard goal progress resolves goals linked to a superseded bucket snapshot', async () => {
  const db = createDbDouble({
    allocationCategories: [
      { id: 'bucket_savings_old', snapshotId: 'snapshot_old', effectiveFrom: '2026-01-01', supersededAt: '2026-03-01', label: 'Savings', slug: 'savings', isActive: true, sortOrder: 1 },
      { id: 'bucket_savings_current', snapshotId: 'snapshot_current', effectiveFrom: '2026-03-01', supersededAt: null, label: 'Savings', slug: 'savings', isActive: true, sortOrder: 1 },
    ],
    incomeAllocations: [
      { allocationCategoryId: 'bucket_savings_current', receivedDate: '2026-03-01', allocatedAmount: '500.00' },
    ],
    transactions: [
      { id: 'txn_1', categoryId: 'bucket_savings_current', transactionDate: '2026-03-20', amount: '125.00', direction: 'credit', linkedGoalId: 'goal_1' },
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
      },
    ],
  });

  const result = await getDashboardReport({
    db,
    householdId: 'household_1',
    from: '2026-03-01',
    to: '2026-03-01',
  });

  assert.deepEqual(result.goal_progress, [
    {
      goal_id: 'goal_1',
      goal_name: 'Emergency Fund',
      bucket_id: 'bucket_savings_current',
      bucket: 'Savings',
      bucket_name: 'Savings',
      target_amount: '1000.00',
      bucket_balance: '625.00',
      reserved_amount: '125.00',
      current_amount: '125.00',
      remaining_amount: '875.00',
      progress_percent: 12.5,
    },
  ]);
  assert.equal(result.monthly_bucket_progress[0].reserved_for_goals_this_month, '125.00');
});

test('createMonthlyReview computes surplus distributions with remainder routed to emergency_fund', async () => {
  const db = createDbDouble({
    incomeEntries: [{ receivedDate: '2026-03-10', amount: '1000.00' }],
    transactions: [{ transactionDate: '2026-03-12', amount: '333.33', direction: 'debit' }],
    debtPayments: [{ paymentDate: '2026-03-12', amount: '100.00' }],
    surplusSplitRules: [
      { slug: 'emergency_fund', splitPercent: '0.5000', sortOrder: 1, isActive: true },
      { slug: 'debt_payoff', splitPercent: '0.3000', sortOrder: 2, isActive: true },
      { slug: 'investing', splitPercent: '0.2000', sortOrder: 3, isActive: true },
    ],
  });

  const result = await createMonthlyReview({
    db,
    householdId: 'household_1',
    input: {
      reviewMonth: '2026-03-01',
      notes: 'March closeout',
    },
  });

  assert.equal(result.netSurplus, '666.67');
  assert.deepEqual(result.distributions, {
    emergency_fund: '333.34',
    debt_payoff: '200.00',
    investing: '133.33',
  });
  assert.equal(result.alertStatus, 'ok');
});

test('getIncomeAllocationsReport returns an income entry with labeled allocation rows', async () => {
  const db = createDbDouble({
    incomeEntries: [{ id: 'income_1', sourceName: 'Payroll', amount: '1000.00', receivedDate: '2026-03-10', notes: null }],
    incomeAllocations: [
      { incomeEntryId: 'income_1', slug: 'savings', label: 'Savings', amount: '100.00' },
      { incomeEntryId: 'income_1', slug: 'buffer', label: 'Buffer', amount: '900.00' },
    ],
  });

  const result = await getIncomeAllocationsReport({
    db,
    householdId: 'household_1',
    incomeId: 'income_1',
  });

  assert.deepEqual(result, {
    sourceName: 'Payroll',
    amount: '1000.00',
    receivedDate: '2026-03-10',
    allocations: [
      { slug: 'savings', label: 'Savings', amount: '100.00' },
      { slug: 'buffer', label: 'Buffer', amount: '900.00' },
    ],
  });
});

test('getFinancialHealthReport computes live health metrics from household, income, payments, and reviews', async () => {
  const db = createDbDouble({
    household: {
      id: 'household_1',
      activeMonth: '2026-03-01',
      savingsFloor: '50.00',
      monthlyEssentialsBaseline: '200.00',
    },
    incomeEntries: [{ id: 'income_1', sourceName: 'Payroll', amount: '1000.00', receivedDate: '2026-03-10', notes: null }],
    incomeAllocations: [
      { incomeEntryId: 'income_1', receivedDate: '2026-03-10', slug: 'savings', label: 'Savings', amount: '100.00', allocatedAmount: '100.00' },
    ],
    transactions: [
      { id: 'txn_1', transactionDate: '2026-03-11', amount: '700.00', direction: 'debit', categoryId: null, linkedDebtId: null, description: 'Bills', merchant: null },
    ],
    debtPayments: [{ debtId: 'debt_1', paymentDate: '2026-03-12', amount: '100.00' }],
    monthlyReviews: [
      {
        id: 'review_1',
        reviewMonth: '2026-02-01',
        netSurplus: '20.00',
        splitApplied: { emergency_fund: '1.0000' },
        distributions: { emergency_fund: '300.00' },
        alertStatus: 'ok',
        notes: null,
      },
    ],
  });

  const result = await getFinancialHealthReport({
    db,
    householdId: 'household_1',
  });

  assert.deepEqual(result, {
    reviewMonth: '2026-03-01',
    activeMonthIncome: '1000.00',
    monthlyDebtPayments: '100.00',
    debtRatio: '0.1000',
    savingsBalance: '100.00',
    savingsFloor: '50.00',
    savingsFloorEnabled: false,
    availableSavings: '100.00',
    emergencyFundBalance: '300.00',
    monthlyEssentials: '200.00',
    emergencyCoverageMonths: 1.5,
    healthScore: 85,
    healthPillars: [
      {
        key: 'budget_discipline',
        label: 'Budget Discipline',
        score: 100,
        value: 'Overspending ratio 0.0%',
      },
      {
        key: 'surplus_generation',
        label: 'Surplus Generation',
        score: 100,
        value: 'Surplus to income 30.0%',
      },
      {
        key: 'debt_ratio',
        label: 'Debt Ratio',
        score: 100,
        value: 'Minimum debt load 0.0%',
      },
      {
        key: 'debt_reduction',
        label: 'Debt Reduction',
        score: 100,
        value: 'No active debt this month',
      },
      {
        key: 'savings_coverage',
        label: 'Savings Coverage',
        score: 8,
        value: '0.5 months covered',
      },
      {
        key: 'spending_stability',
        label: 'Spending Stability',
        score: 100,
        value: '0 of 2 categories overused',
      },
    ],
    alertStatus: 'ok',
  });
});

test('getFinancialHealthReport accepts an explicit month and returns the monthly score breakdown for that period', async () => {
  const db = createDbDouble({
    household: {
      id: 'household_1',
      activeMonth: '2026-03-01',
      savingsFloor: '100.00',
      monthlyEssentialsBaseline: '500.00',
    },
    allocationCategories: [
      { id: 'cat_fixed_bills', slug: 'fixed_bills', label: 'Fixed Bills', isActive: true, sortOrder: 1 },
      { id: 'cat_personal_spending', slug: 'personal_spending', label: 'Personal Spending', isActive: true, sortOrder: 2 },
      { id: 'cat_savings', slug: 'savings', label: 'Savings', isActive: true, sortOrder: 3 },
    ],
    incomeEntries: [
      { id: 'income_jan', sourceName: 'Payroll', amount: '1200.00', receivedDate: '2026-01-10', notes: null },
      { id: 'income_feb', sourceName: 'Payroll', amount: '2000.00', receivedDate: '2026-02-10', notes: null },
    ],
    incomeAllocations: [
      { incomeEntryId: 'income_jan', allocationCategoryId: 'cat_savings', receivedDate: '2026-01-10', slug: 'savings', allocatedAmount: '300.00' },
      { incomeEntryId: 'income_feb', allocationCategoryId: 'cat_fixed_bills', receivedDate: '2026-02-10', slug: 'fixed_bills', allocatedAmount: '1000.00' },
      { incomeEntryId: 'income_feb', allocationCategoryId: 'cat_personal_spending', receivedDate: '2026-02-10', slug: 'personal_spending', allocatedAmount: '500.00' },
      { incomeEntryId: 'income_feb', allocationCategoryId: 'cat_savings', receivedDate: '2026-02-10', slug: 'savings', allocatedAmount: '200.00' },
    ],
    transactions: [
      { id: 'txn_feb_1', transactionDate: '2026-02-14', amount: '700.00', direction: 'debit', categoryId: 'cat_personal_spending', linkedDebtId: null, description: 'Weekend spend', merchant: null },
    ],
    debts: [
      {
        id: 'debt_1',
        householdId: 'household_1',
        name: 'Credit Card',
        startingBalance: '1000.00',
        apr: 12,
        minimumPayment: '50.00',
        monthlyPayment: '100.00',
        sortOrder: 0,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    debtPayments: [
      { debtId: 'debt_1', paymentDate: '2026-02-20', amount: '100.00' },
    ],
    debtAdjustments: [
      { debtId: 'debt_1', householdId: 'household_1', amount: '10.00', adjustmentType: 'interest', effectiveDate: '2026-02-05', note: 'Interest', createdAt: '2026-02-05T00:00:00.000Z' },
    ],
  });

  const result = await getFinancialHealthReport({
    db,
    householdId: 'household_1',
    month: '2026-02-01',
  });

  assert.equal(result.reviewMonth, '2026-02-01');
  assert.equal(result.activeMonthIncome, '2000.00');
  assert.equal(result.savingsBalance, '500.00');
  assert.equal(result.healthScore, 78);
  assert.deepEqual(
    result.healthPillars.map((pillar) => [pillar.key, pillar.score]),
    [
      ['budget_discipline', 88],
      ['surplus_generation', 100],
      ['debt_ratio', 94],
      ['debt_reduction', 100],
      ['savings_coverage', 17],
      ['spending_stability', 67],
    ],
  );
});

test('getMonthlyReviewReport computes deterministic monthly review recommendations', async () => {
  const db = createDbDouble({
    incomeEntries: [{ receivedDate: '2026-03-10', amount: '1000.00' }],
    transactions: [{ transactionDate: '2026-03-12', amount: '333.33', direction: 'debit' }],
    debtPayments: [{ paymentDate: '2026-03-12', amount: '100.00' }],
    surplusSplitRules: [
      { slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '0.5000', sortOrder: 1, isActive: true },
      { slug: 'debt_payoff', label: 'Debt Payoff', splitPercent: '0.3000', sortOrder: 2, isActive: true },
      { slug: 'investing', label: 'Investing', splitPercent: '0.2000', sortOrder: 3, isActive: true },
    ],
  });

  const result = await getMonthlyReviewReport({
    db,
    householdId: 'household_1',
    month: '2026-03-01',
  });

  assert.deepEqual(result, {
    reviewMonth: '2026-03-01',
    netSurplus: '666.67',
    distributions: [
      {
        slug: 'emergency_fund',
        label: 'Emergency Fund',
        amount: '333.34',
        splitPercent: '0.5000',
        destinationType: 'bucket',
        destinationBucketSlug: null,
        destinationGoalId: null,
        destinationDebtId: null,
      },
      {
        slug: 'debt_payoff',
        label: 'Debt Payoff',
        amount: '200.00',
        splitPercent: '0.3000',
        destinationType: 'bucket',
        destinationBucketSlug: null,
        destinationGoalId: null,
        destinationDebtId: null,
      },
      {
        slug: 'investing',
        label: 'Investing',
        amount: '133.33',
        splitPercent: '0.2000',
        destinationType: 'bucket',
        destinationBucketSlug: null,
        destinationGoalId: null,
        destinationDebtId: null,
      },
    ],
    alertStatus: 'ok',
    monthlySummary: {
      totalIncome: '1000.00',
      totalAllocated: '1000.00',
      totalSpent: '333.33',
      monthResult: '666.67',
      surplusAllocatedToGoals: '0.00',
      surplusAllocatedToDebt: '0.00',
      remainingSurplus: '0.00',
      finalMonthResult: '0.00',
      statusLabel: 'On Budget',
    },
    categorySummaries: [
      {
        bucketId: 'cat_fixed_bills',
        bucketName: 'fixed_bills',
        slug: 'fixed_bills',
        allocated: '0.00',
        added: '0.00',
        spent: '0.00',
        goalContributions: '0.00',
        available: '0.00',
        overused: false,
        overageAmount: '0.00',
      },
      {
        bucketId: 'cat_personal_spending',
        bucketName: 'personal_spending',
        slug: 'personal_spending',
        allocated: '0.00',
        added: '0.00',
        spent: '0.00',
        goalContributions: '0.00',
        available: '0.00',
        overused: false,
        overageAmount: '0.00',
      },
    ],
    overspendingImpact: {
      totalImpact: '0.00',
      categories: [],
    },
  });
});

test('monthly review category summaries use the shared goal contribution computation path', async () => {
  const db = createDbDouble({
    allocationCategories: [
      { id: 'bucket_savings', slug: 'savings', label: 'Savings', isActive: true, sortOrder: 1 },
    ],
    incomeEntries: [{ receivedDate: '2026-03-10', amount: '1000.00' }],
    incomeAllocations: [{ allocationCategoryId: 'bucket_savings', receivedDate: '2026-03-10', amount: '1000.00', allocatedAmount: '1000.00' }],
    transactions: [
      {
        id: 'txn_goal_credit',
        transactionDate: '2026-03-12',
        amount: '125.00',
        direction: 'credit',
        categoryId: 'bucket_savings',
        linkedGoalId: 'goal_1',
      },
    ],
    goals: [
      {
        id: 'goal_1',
        householdId: 'household_1',
        bucketId: 'bucket_savings',
        name: 'Emergency Fund',
        targetAmount: '1000.00',
        active: true,
      },
    ],
    surplusSplitRules: [
      { slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '1.0000', sortOrder: 1, isActive: true },
    ],
  });

  const result = await getMonthlyReviewReport({
    db,
    householdId: 'household_1',
    month: '2026-03-01',
  });

  assert.equal(result.categorySummaries[0].goalContributions, '125.00');
  assert.equal(result.categorySummaries[0].available, '1000.00');
});

test('report services handle empty-state data without persisting derived results', async () => {
  const db = createDbDouble({
    household: {
      id: 'household_1',
      activeMonth: '2026-03-01',
      savingsFloor: '0.00',
      monthlyEssentialsBaseline: '0.00',
    },
    surplusSplitRules: [
      { slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '1.0000', sortOrder: 1, isActive: true },
    ],
  });

  const dashboard = await getDashboardReport({
    db,
    householdId: 'household_1',
    from: '2026-03-01',
    to: '2026-03-01',
  });
  const financialHealth = await getFinancialHealthReport({
    db,
    householdId: 'household_1',
  });
  const monthlyReview = await getMonthlyReviewReport({
    db,
    householdId: 'household_1',
    month: '2026-03-01',
  });

  assert.deepEqual(dashboard, {
    periods: [
      {
        month: '2026-03-01',
        incomeTotal: '0.00',
        spendingTotal: '0.00',
        surplusOrDeficit: '0.00',
        savingsActual: '0.00',
        alertStatus: 'ok',
        explanations: {
          netSurplus: buildNetSurplusExplanation({
            month: '2026-03-01',
            incomeCents: 0,
            spendingCents: 0,
          }),
        },
      },
    ],
    upcoming_fixed_bills_this_month: [],
    total_expected_fixed_bills_this_month: '0.00',
    bucket_balances: [
      {
        bucket_id: 'cat_fixed_bills',
        bucket_name: 'fixed_bills',
        slug: 'fixed_bills',
        balance: '0.00',
        percent_of_total: 0,
      },
      {
        bucket_id: 'cat_personal_spending',
        bucket_name: 'personal_spending',
        slug: 'personal_spending',
        balance: '0.00',
        percent_of_total: 0,
      },
    ],
    monthly_bucket_progress: [
      {
        bucket_id: 'cat_fixed_bills',
        bucket_name: 'fixed_bills',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
      {
        bucket_id: 'cat_personal_spending',
        bucket_name: 'personal_spending',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
    ],
    ytd_bucket_progress: [
      {
        bucket_id: 'cat_fixed_bills',
        bucket_name: 'fixed_bills',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
      {
        bucket_id: 'cat_personal_spending',
        bucket_name: 'personal_spending',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
    ],
    ttd_bucket_progress: [
      {
        bucket_id: 'cat_fixed_bills',
        bucket_name: 'fixed_bills',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
      {
        bucket_id: 'cat_personal_spending',
        bucket_name: 'personal_spending',
        allocated_this_month: '0.00',
        added_this_month: '0.00',
        used_this_month: '0.00',
        reserved_for_goals_this_month: '0.00',
        available_this_month: '0.00',
        remaining_this_month: '0.00',
        percent_used_this_month: 0,
        percent_reserved_for_goals_this_month: 0,
      },
    ],
    goal_progress: [],
  });
  assert.deepEqual(financialHealth, {
    reviewMonth: '2026-03-01',
    activeMonthIncome: '0.00',
    monthlyDebtPayments: '0.00',
    debtRatio: '0.0000',
    savingsBalance: '0.00',
    savingsFloor: '0.00',
    savingsFloorEnabled: false,
    availableSavings: '0.00',
    emergencyFundBalance: '0.00',
    monthlyEssentials: '0.00',
    emergencyCoverageMonths: null,
    healthScore: 67,
    healthPillars: [
      {
        key: 'budget_discipline',
        label: 'Budget Discipline',
        score: 100,
        value: 'Overspending ratio 0.0%',
      },
      {
        key: 'surplus_generation',
        label: 'Surplus Generation',
        score: 0,
        value: 'Surplus to income 0.0%',
      },
      {
        key: 'debt_ratio',
        label: 'Debt Ratio',
        score: 100,
        value: 'Minimum debt load 0.0%',
      },
      {
        key: 'debt_reduction',
        label: 'Debt Reduction',
        score: 100,
        value: 'No active debt this month',
      },
      {
        key: 'savings_coverage',
        label: 'Savings Coverage',
        score: 0,
        value: 'Coverage baseline not set',
      },
      {
        key: 'spending_stability',
        label: 'Spending Stability',
        score: 100,
        value: '0 of 2 categories overused',
      },
    ],
    alertStatus: 'ok',
  });
  assert.deepEqual(monthlyReview, {
    reviewMonth: '2026-03-01',
    netSurplus: '0.00',
    distributions: [
      {
        slug: 'emergency_fund',
        label: 'Emergency Fund',
        amount: '0.00',
        splitPercent: '1.0000',
        destinationType: 'bucket',
        destinationBucketSlug: null,
        destinationGoalId: null,
        destinationDebtId: null,
      },
    ],
    alertStatus: 'ok',
    monthlySummary: {
      totalIncome: '0.00',
      totalAllocated: '0.00',
      totalSpent: '0.00',
      monthResult: '0.00',
      surplusAllocatedToGoals: '0.00',
      surplusAllocatedToDebt: '0.00',
      remainingSurplus: '0.00',
      finalMonthResult: '0.00',
      statusLabel: 'On Budget',
    },
    categorySummaries: [
      {
        bucketId: 'cat_fixed_bills',
        bucketName: 'fixed_bills',
        slug: 'fixed_bills',
        allocated: '0.00',
        added: '0.00',
        spent: '0.00',
        goalContributions: '0.00',
        available: '0.00',
        overused: false,
        overageAmount: '0.00',
      },
      {
        bucketId: 'cat_personal_spending',
        bucketName: 'personal_spending',
        slug: 'personal_spending',
        allocated: '0.00',
        added: '0.00',
        spent: '0.00',
        goalContributions: '0.00',
        available: '0.00',
        overused: false,
        overageAmount: '0.00',
      },
    ],
    overspendingImpact: {
      totalImpact: '0.00',
      categories: [],
    },
  });
  assert.equal(db.state.monthlyReviews.length, 0);
});

test('household route updates savings floor settings and financial health respects the enabled flag', async () => {
  const db = createDbDouble({
    household: {
      id: 'household_1',
      name: 'Household 1',
      timezone: 'America/Toronto',
      activeMonth: '2026-03-01',
      periodStartDay: 1,
      savingsFloor: '250.00',
      savingsFloorEnabled: false,
      monthlyEssentialsBaseline: '200.00',
    },
    incomeAllocations: [
      { incomeEntryId: 'income_1', receivedDate: '2026-03-10', slug: 'savings', label: 'Savings', amount: '100.00', allocatedAmount: '100.00' },
    ],
  });

  const listedResponse = await getHouseholdRoute(
    new Request('http://localhost/api/v1/household', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );

  assert.equal(listedResponse.status, 200);
  assert.equal((await listedResponse.json()).savingsFloorEnabled, false);

  const updatedResponse = await patchHouseholdRoute(
    new Request('http://localhost/api/v1/household', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        savingsFloor: '250.00',
        savingsFloorEnabled: true,
      }),
    }),
    { db },
  );

  assert.equal(updatedResponse.status, 200);
  assert.deepEqual(await updatedResponse.json(), {
    id: 'household_1',
    name: 'Household 1',
    timezone: 'America/Toronto',
    activeMonth: '2026-03-01',
    periodStartDay: 1,
    savingsFloor: '250.00',
    savingsFloorEnabled: true,
    monthlyEssentialsBaseline: '200.00',
  });

  const financialHealth = await getFinancialHealthReport({
    db,
    householdId: 'household_1',
  });

  assert.equal(financialHealth.savingsFloorEnabled, true);
  assert.equal(financialHealth.availableSavings, '-150.00');
});

test('financial health savings floor uses global savings bucket balance', async () => {
  const db = createDbDouble({
    household: {
      id: 'household_1',
      name: 'Household 1',
      timezone: 'America/Toronto',
      activeMonth: '2026-03-01',
      periodStartDay: 1,
      savingsFloor: '250.00',
      savingsFloorEnabled: true,
      monthlyEssentialsBaseline: '200.00',
    },
    incomeAllocations: [
      { incomeEntryId: 'income_prev', receivedDate: '2026-02-10', slug: 'savings', label: 'Savings', amount: '400.00', allocatedAmount: '400.00' },
      { incomeEntryId: 'income_curr', receivedDate: '2026-03-10', slug: 'savings', label: 'Savings', amount: '100.00', allocatedAmount: '100.00' },
    ],
  });

  const financialHealth = await getFinancialHealthReport({
    db,
    householdId: 'household_1',
  });

  assert.equal(financialHealth.savingsBalance, '500.00');
  assert.equal(financialHealth.availableSavings, '250.00');
});

test('financial health report uses period-aware debt history so paid-off debts stay paid in historical months', async () => {
  const db = createDbDouble({
    household: {
      id: 'household_1',
      name: 'Household 1',
      timezone: 'America/Toronto',
      activeMonth: '2026-06-01',
      periodStartDay: 1,
      savingsFloor: '0.00',
      savingsFloorEnabled: false,
      monthlyEssentialsBaseline: '200.00',
    },
    incomeEntries: [
      { receivedDate: '2026-03-10', amount: '1000.00' },
    ],
    debts: [
      {
        id: 'debt_1',
        householdId: 'household_1',
        name: 'Visa',
        startingBalance: '500.00',
        apr: 0,
        minimumPayment: '50.00',
        monthlyPayment: '50.00',
        sortOrder: 1,
        isActive: true,
      },
    ],
    debtPayments: [
      { debtId: 'debt_1', paymentDate: '2026-01-15', amount: '300.00' },
      { debtId: 'debt_1', paymentDate: '2026-02-15', amount: '200.00' },
    ],
  });

  const financialHealth = await getFinancialHealthReport({
    db,
    householdId: 'household_1',
    month: '2026-03-01',
  });

  assert.equal(financialHealth.monthlyDebtPayments, '0.00');
  assert.equal(financialHealth.debtRatio, '0.0000');
  assert.equal(
    financialHealth.healthPillars.find((pillar) => pillar.key === 'debt_reduction')?.value,
    'No active debt this month',
  );
});

test('surplus recommendations route exposes the spec-compatible alias', async () => {
  const db = createDbDouble({
    surplusSplitRules: [
      { slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '1.0000', sortOrder: 1, isActive: true },
    ],
  });

  const response = await getSurplusRecommendationsRoute(
    new Request('http://localhost/api/v1/reports/surplus-recommendations?month=2026-03-01', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );

  assert.equal(response.status, 200);
});

test('createMonthlyReview rejects duplicate review months', async () => {
  const db = createDbDouble({
    monthlyReviews: [
      {
        id: 'review_1',
        reviewMonth: '2026-03-01',
        netSurplus: '10.00',
        splitApplied: {},
        distributions: {},
        alertStatus: 'ok',
        notes: null,
      },
    ],
  });

  await assert.rejects(
    () =>
      createMonthlyReview({
        db,
        householdId: 'household_1',
        input: { reviewMonth: '2026-03-01' },
      }),
    /already exists/,
  );
});

test('monthly review list and patch routes return stored reviews and note updates', async () => {
  const db = createDbDouble({
    monthlyReviews: [
      {
        id: 'review_1',
        reviewMonth: '2026-03-01',
        netSurplus: '10.00',
        splitApplied: { emergency_fund: '1.0000' },
        distributions: { emergency_fund: '10.00' },
        alertStatus: 'ok',
        notes: null,
      },
    ],
  });

  const listResponse = await listMonthlyReviewsRoute(
    new Request('http://localhost/api/v1/monthly-reviews?from=2026-03-01&to=2026-03-01', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );

  assert.equal(listResponse.status, 200);
  assert.deepEqual(await listResponse.json(), {
    items: [
      {
        id: 'review_1',
        reviewMonth: '2026-03-01',
        netSurplus: '10.00',
        splitApplied: { emergency_fund: '1.0000' },
        distributions: { emergency_fund: '10.00' },
        alertStatus: 'ok',
        notes: null,
      },
    ],
  });

  const patchResponse = await patchMonthlyReviewRoute(
    new Request('http://localhost/api/v1/monthly-reviews/review_1', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({ notes: 'Updated note' }),
    }),
    { db, params: { id: 'review_1' } },
  );

  assert.equal(patchResponse.status, 200);
  assert.deepEqual(await patchResponse.json(), {
    id: 'review_1',
    reviewMonth: '2026-03-01',
    netSurplus: '10.00',
    splitApplied: { emergency_fund: '1.0000' },
    distributions: { emergency_fund: '10.00' },
    alertStatus: 'ok',
    notes: 'Updated note',
  });
});

test('dashboard and monthly review routes expose report payloads', async () => {
  const db = createDbDouble({
    incomeEntries: [{ id: 'income_1', sourceName: 'Payroll', receivedDate: '2026-03-10', amount: '1000.00' }],
    incomeAllocations: [{ incomeEntryId: 'income_1', receivedDate: '2026-03-10', slug: 'savings', label: 'Savings', amount: '100.00', allocatedAmount: '100.00' }],
    transactions: [{ transactionDate: '2026-03-12', amount: '500.00', direction: 'debit' }],
    debtPayments: [{ paymentDate: '2026-03-12', amount: '100.00' }],
    surplusSplitRules: [{ slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '1.0000', sortOrder: 1, isActive: true }],
  });

  const dashboardResponse = await getDashboardRoute(
    new Request('http://localhost/api/v1/reports/dashboard?from=2026-03-01&to=2026-03-01', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );

  assert.equal(dashboardResponse.status, 200);
  const dashboardPayload = await dashboardResponse.json();
  assert.equal(Array.isArray(dashboardPayload.upcoming_fixed_bills_this_month), true);
  assert.equal(typeof dashboardPayload.total_expected_fixed_bills_this_month, 'string');
  assert.equal(Array.isArray(dashboardPayload.bucket_balances), true);
  assert.equal(Array.isArray(dashboardPayload.monthly_bucket_progress), true);
  assert.equal(Array.isArray(dashboardPayload.goal_progress), true);
  assert.deepEqual(dashboardPayload.periods[0].explanations.netSurplus, {
    label: 'Net surplus',
    value: '500.00',
    components: [
      { label: 'Income', value: '1000.00', kind: 'add' },
      { label: 'Spending', value: '-500.00', kind: 'subtract' },
    ],
    assumptions: [
      'Spending includes recorded debit transactions in the selected month.',
      'Credits are not counted as spending.',
    ],
    provenance: 'Dashboard report period totals',
    asOf: '2026-03-01',
  });

  const aggregateResponse = await getDashboardAggregateRoute(
    new Request('http://localhost/api/v1/reports/dashboard-aggregate?from=2026-03-01&to=2026-03-01', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );
  assert.equal(aggregateResponse.status, 200);
  const aggregatePayload = await aggregateResponse.json();
  assert.equal(Array.isArray(aggregatePayload.dashboard.periods), true);
  assert.equal(aggregatePayload.dashboard.periods[0].explanations.netSurplus.value, '500.00');
  assert.equal(typeof aggregatePayload.financialHealth.healthScore, 'number');
  assert.equal(typeof aggregatePayload.surplusRecommendations.netSurplus, 'string');

  const incomeAllocationsResponse = await getIncomeAllocationsRoute(
    new Request('http://localhost/api/v1/reports/income-allocations?incomeId=income_1', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );
  assert.equal(incomeAllocationsResponse.status, 200);

  const financialHealthResponse = await getFinancialHealthRoute(
    new Request('http://localhost/api/v1/reports/financial-health', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );
  assert.equal(financialHealthResponse.status, 200);

  const monthlyReviewReportResponse = await getMonthlyReviewReportRoute(
    new Request('http://localhost/api/v1/reports/monthly-review?month=2026-03-01', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );
  assert.equal(monthlyReviewReportResponse.status, 200);

  const createResponse = await createMonthlyReviewRoute(
    new Request('http://localhost/api/v1/monthly-reviews', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({ reviewMonth: '2026-03-01' }),
    }),
    { db },
  );

  assert.equal(createResponse.status, 201);
  assert.deepEqual(await createResponse.json(), {
    id: 'review_1',
    householdId: 'household_1',
    reviewMonth: '2026-03-01',
    netSurplus: '500.00',
    splitApplied: { emergency_fund: '1.0000' },
    distributions: { emergency_fund: '500.00' },
    alertStatus: 'ok',
    notes: null,
  });
});
