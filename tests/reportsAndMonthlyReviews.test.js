import test from 'node:test';
import assert from 'node:assert/strict';

import { GET as getDashboardRoute } from '../app/api/v1/reports/dashboard/route.js';
import { GET as getFinancialHealthRoute } from '../app/api/v1/reports/financial-health/route.js';
import { GET as getIncomeAllocationsRoute } from '../app/api/v1/reports/income-allocations/route.js';
import { GET as getMonthlyReviewReportRoute } from '../app/api/v1/reports/monthly-review/route.js';
import { GET as getSurplusRecommendationsRoute } from '../app/api/v1/reports/surplus-recommendations/route.js';
import { GET as listMonthlyReviewsRoute, POST as createMonthlyReviewRoute } from '../app/api/v1/monthly-reviews/route.js';
import { PATCH as patchMonthlyReviewRoute } from '../app/api/v1/monthly-reviews/[id]/route.js';
import { getFinancialHealthReport } from '../lib/reports/getFinancialHealthReport.js';
import { getIncomeAllocationsReport } from '../lib/reports/getIncomeAllocationsReport.js';
import { getDashboardReport } from '../lib/reports/getDashboardReport.js';
import { getMonthlyReviewReport } from '../lib/reports/getMonthlyReviewReport.js';
import { createMonthlyReview } from '../lib/monthlyReviews/monthlyReviews.js';

function createDbDouble({
  incomeEntries = [],
  incomeAllocations = [],
  transactions = [],
  debtPayments = [],
  surplusSplitRules = [],
  monthlyReviews = [],
  household = {
    id: 'household_1',
    activeMonth: '2026-03-01',
    savingsFloor: '50.00',
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
      return transactions.filter((entry) => entry.transactionDate >= from && entry.transactionDate < incrementMonth(to));
    },
    async listDebtPayments({ from, to }) {
      return debtPayments.filter((entry) => entry.paymentDate >= from && entry.paymentDate < incrementMonth(to));
    },
    async listIncomeAllocationsBySlug({ slug }) {
      return incomeAllocations.filter((entry) => entry.slug === slug);
    },
    async listSurplusSplitRules() {
      return surplusSplitRules;
    },
    async getHousehold() {
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
      },
      {
        month: '2026-04-01',
        incomeTotal: '800.00',
        spendingTotal: '900.00',
        surplusOrDeficit: '-100.00',
        savingsActual: '80.00',
        alertStatus: 'risky',
      },
    ],
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
    activeMonthIncome: '1000.00',
    monthlyDebtPayments: '100.00',
    debtRatio: '0.1000',
    savingsBalance: '100.00',
    savingsFloor: '50.00',
    availableSavings: '50.00',
    emergencyFundBalance: '300.00',
    monthlyEssentials: '200.00',
    emergencyCoverageMonths: 1.5,
    alertStatus: 'ok',
  });
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
      { slug: 'emergency_fund', label: 'Emergency Fund', amount: '333.34' },
      { slug: 'debt_payoff', label: 'Debt Payoff', amount: '200.00' },
      { slug: 'investing', label: 'Investing', amount: '133.33' },
    ],
    alertStatus: 'ok',
  });
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
      },
    ],
  });
  assert.deepEqual(financialHealth, {
    activeMonthIncome: '0.00',
    monthlyDebtPayments: '0.00',
    debtRatio: '0.0000',
    savingsBalance: '0.00',
    savingsFloor: '0.00',
    availableSavings: '0.00',
    emergencyFundBalance: '0.00',
    monthlyEssentials: '0.00',
    emergencyCoverageMonths: null,
    alertStatus: 'ok',
  });
  assert.deepEqual(monthlyReview, {
    reviewMonth: '2026-03-01',
    netSurplus: '0.00',
    distributions: [
      { slug: 'emergency_fund', label: 'Emergency Fund', amount: '0.00' },
    ],
    alertStatus: 'ok',
  });
  assert.equal(db.state.monthlyReviews.length, 0);
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
