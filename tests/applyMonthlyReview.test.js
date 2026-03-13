import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as applyMonthlyReviewRoute } from '../app/api/v1/monthly-review/apply/route.js';
import { POST as applyMonthlyReviewAliasRoute } from '../app/api/v1/monthly-reviews/apply/route.js';
import { applyMonthlyReview } from '../lib/monthlyReviews/applyMonthlyReview.js';

function incrementMonth(month) {
  const value = new Date(`${month}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

function createDbDouble({
  household = { id: 'household_1' },
  incomeEntries = [],
  transactions = [],
  debtPayments = [],
  surplusSplitRules = [],
  allocationCategories = [],
  monthlyReviews = [],
} = {}) {
  const state = {
    monthlyReviews: monthlyReviews.map((review) => ({ ...review })),
    transactions: transactions.map((transaction) => ({ ...transaction })),
    insertedTransactions: [],
  };

  const tx = {
    async getHousehold() {
      return household;
    },
    async getMonthlyReviewByMonth({ reviewMonth }) {
      return state.monthlyReviews.find((review) => review.reviewMonth === reviewMonth) ?? null;
    },
    async listIncomeEntries({ from, to }) {
      return incomeEntries.filter((entry) => entry.receivedDate >= from && entry.receivedDate < incrementMonth(to));
    },
    async listTransactions({ from, to }) {
      return state.transactions.filter((entry) => entry.transactionDate >= from && entry.transactionDate < incrementMonth(to));
    },
    async listDebtPayments({ from, to }) {
      return debtPayments.filter((entry) => entry.paymentDate >= from && entry.paymentDate < incrementMonth(to));
    },
    async listSurplusSplitRules() {
      return surplusSplitRules;
    },
    async listAllocationCategories() {
      return allocationCategories;
    },
    async insertMonthlyReview(payload) {
      const review = { id: `review_${state.monthlyReviews.length + 1}`, ...payload };
      state.monthlyReviews.push(review);
      return review;
    },
    async insertTransaction(payload) {
      const transaction = { id: `txn_${state.transactions.length + 1}`, ...payload };
      state.transactions.push(transaction);
      state.insertedTransactions.push(transaction);
      return transaction;
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

test('applyMonthlyReview creates surplus allocation transactions from active split rules', async () => {
  const db = createDbDouble({
    incomeEntries: [{ receivedDate: '2026-03-10', amount: '1000.00' }],
    transactions: [{ transactionDate: '2026-03-12', amount: '333.33', direction: 'debit' }],
    debtPayments: [{ paymentDate: '2026-03-12', amount: '100.00' }],
    surplusSplitRules: [
      { slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '0.5000', sortOrder: 1, isActive: true },
      { slug: 'extra_debt_payoff', label: 'Extra Debt Payoff', splitPercent: '0.3000', sortOrder: 2, isActive: true },
      { slug: 'investment', label: 'Investment', splitPercent: '0.2000', sortOrder: 3, isActive: true },
    ],
    allocationCategories: [
      { id: 'cat_debt', slug: 'debt_payoff' },
      { id: 'cat_investment', slug: 'investment' },
    ],
  });

  const result = await applyMonthlyReview({
    db,
    householdId: 'household_1',
    input: { reviewMonth: '2026-03-01', notes: 'Apply March review' },
  });

  assert.equal(result.review.netSurplus, '666.67');
  assert.deepEqual(result.review.distributions, {
    emergency_fund: '333.34',
    extra_debt_payoff: '200.00',
    investment: '133.33',
  });
  assert.deepEqual(result.appliedTransactions, [
    {
      id: 'txn_2',
      transactionDate: '2026-03-01',
      description: 'Monthly review allocation: Emergency Fund',
      merchant: null,
      amount: '333.34',
      direction: 'debit',
      categoryId: null,
      linkedDebtId: null,
    },
    {
      id: 'txn_3',
      transactionDate: '2026-03-01',
      description: 'Monthly review allocation: Extra Debt Payoff',
      merchant: null,
      amount: '200.00',
      direction: 'debit',
      categoryId: 'cat_debt',
      linkedDebtId: null,
    },
    {
      id: 'txn_4',
      transactionDate: '2026-03-01',
      description: 'Monthly review allocation: Investment',
      merchant: null,
      amount: '133.33',
      direction: 'debit',
      categoryId: 'cat_investment',
      linkedDebtId: null,
    },
  ]);
});

test('applyMonthlyReview records deficits without creating allocation transactions', async () => {
  const db = createDbDouble({
    incomeEntries: [{ receivedDate: '2026-03-10', amount: '250.00' }],
    transactions: [{ transactionDate: '2026-03-12', amount: '400.00', direction: 'debit' }],
    surplusSplitRules: [
      { slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '1.0000', sortOrder: 1, isActive: true },
    ],
  });

  const result = await applyMonthlyReview({
    db,
    householdId: 'household_1',
    input: { reviewMonth: '2026-03-01' },
  });

  assert.equal(result.review.netSurplus, '-150.00');
  assert.deepEqual(result.review.distributions, {
    emergency_fund: '0.00',
  });
  assert.deepEqual(result.appliedTransactions, []);
  assert.equal(db.state.insertedTransactions.length, 0);
});

test('monthly review apply routes return created review and transactions', async () => {
  const db = createDbDouble({
    incomeEntries: [{ receivedDate: '2026-03-10', amount: '100.00' }],
    surplusSplitRules: [
      { slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '1.0000', sortOrder: 1, isActive: true },
    ],
  });

  const response = await applyMonthlyReviewRoute(
    new Request('http://localhost/api/v1/monthly-review/apply', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({ reviewMonth: '2026-03-01' }),
    }),
    { db },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    review: {
      id: 'review_1',
      householdId: 'household_1',
      reviewMonth: '2026-03-01',
      netSurplus: '100.00',
      splitApplied: { emergency_fund: '1.0000' },
      distributions: { emergency_fund: '100.00' },
      alertStatus: 'ok',
      notes: null,
    },
    appliedTransactions: [
      {
        id: 'txn_1',
        transactionDate: '2026-03-01',
        description: 'Monthly review allocation: Emergency Fund',
        merchant: null,
        amount: '100.00',
        direction: 'debit',
        categoryId: null,
        linkedDebtId: null,
      },
    ],
  });

  const aliasResponse = await applyMonthlyReviewAliasRoute(
    new Request('http://localhost/api/v1/monthly-reviews/apply', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({ reviewMonth: '2026-04-01' }),
    }),
    {
      db: createDbDouble({
        incomeEntries: [{ receivedDate: '2026-04-10', amount: '50.00' }],
        surplusSplitRules: [
          { slug: 'emergency_fund', label: 'Emergency Fund', splitPercent: '1.0000', sortOrder: 1, isActive: true },
        ],
      }),
    },
  );

  assert.equal(aliasResponse.status, 201);
});
