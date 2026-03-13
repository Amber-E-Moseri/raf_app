import test from 'node:test';
import assert from 'node:assert/strict';

import { GET as getMerchantRulesRoute, POST as postMerchantRuleRoute } from '../app/api/v1/merchant-rules/route.js';
import { DELETE as deleteMerchantRuleRoute, PATCH as patchMerchantRuleRoute } from '../app/api/v1/merchant-rules/[id]/route.js';
import { GET as getTrajectoryRoute } from '../app/api/v1/reports/trajectory/route.js';
import { POST as applyMonthlyReviewRoute } from '../app/api/v1/monthly-reviews/apply/route.js';
import {
  createMerchantRule,
  deleteMerchantRule,
  listMerchantRules,
  matchMerchantRule,
  updateMerchantRule,
} from '../lib/imports/merchantRules.js';
import { getTrajectoryReport } from '../lib/reports/getTrajectoryReport.js';

function createDbDouble({
  merchantRules = [],
  household = { id: 'household_1', activeMonth: '2026-03-01' },
  incomeEntries = [],
  transactions = [],
  monthlyReviews = [],
  surplusSplitRules = [],
  debts = [],
  debtPayments = [],
} = {}) {
  const state = {
    merchantRules: merchantRules.map((rule) => ({ ...rule })),
    monthlyReviews: monthlyReviews.map((review) => ({ ...review })),
    deletedRuleId: null,
  };

  const tx = {
    async listMerchantRules() {
      return [...state.merchantRules];
    },
    async insertMerchantRule(payload) {
      const rule = { id: `rule_${state.merchantRules.length + 1}`, ...payload };
      state.merchantRules.push(rule);
      return rule;
    },
    async getMerchantRuleById({ ruleId }) {
      return state.merchantRules.find((rule) => rule.id === ruleId) ?? null;
    },
    async updateMerchantRule({ ruleId, patch }) {
      const index = state.merchantRules.findIndex((rule) => rule.id === ruleId);
      state.merchantRules[index] = { ...state.merchantRules[index], ...patch };
      return state.merchantRules[index];
    },
    async deleteMerchantRule({ ruleId }) {
      state.deletedRuleId = ruleId;
      state.merchantRules = state.merchantRules.filter((rule) => rule.id !== ruleId);
    },
    async getHousehold() {
      return household;
    },
    async listIncomeEntries() {
      return incomeEntries;
    },
    async listTransactions() {
      return transactions;
    },
    async listMonthlyReviews() {
      return state.monthlyReviews;
    },
    async listSurplusSplitRules() {
      return surplusSplitRules;
    },
    async listDebts() {
      return debts;
    },
    async listDebtPayments() {
      return debtPayments;
    },
    async getMonthlyReviewByMonth({ reviewMonth }) {
      return state.monthlyReviews.find((row) => row.reviewMonth === reviewMonth) ?? null;
    },
    async insertMonthlyReview(payload) {
      const review = { id: `review_${state.monthlyReviews.length + 1}`, ...payload };
      state.monthlyReviews.push(review);
      return review;
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

test('merchant rules CRUD supports list, create, patch, and delete', async () => {
  const db = createDbDouble({
    merchantRules: [{ id: 'rule_1', merchantPattern: 'coffee', categoryId: 'cat_food', priority: 2, enabled: true }],
  });

  const listed = await listMerchantRules({ db, householdId: 'household_1' });
  assert.equal(listed.items.length, 1);

  const created = await createMerchantRule({
    db,
    householdId: 'household_1',
    input: { merchantPattern: 'Hydro One', categoryId: 'cat_bills', priority: 5, enabled: true },
  });
  assert.equal(created.id, 'rule_2');
  assert.equal(created.enabled, true);

  const updated = await updateMerchantRule({
    db,
    householdId: 'household_1',
    ruleId: 'rule_1',
    input: { priority: 10 },
  });
  assert.equal(updated.priority, 10);

  await deleteMerchantRule({ db, householdId: 'household_1', ruleId: 'rule_2' });
  assert.equal(db.state.deletedRuleId, 'rule_2');
});

test('merchant rule matching prefers higher priority, ignores disabled rules, and is case-insensitive', () => {
  const rules = [
    { id: 'rule_1', merchantPattern: 'coffee', categoryId: 'cat_food', priority: 1, enabled: true, createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'rule_2', merchantPattern: 'COFFEE SHOP', categoryId: 'cat_premium', priority: 10, enabled: true, createdAt: '2026-03-02T00:00:00.000Z' },
    { id: 'rule_3', merchantPattern: 'coffee', categoryId: 'cat_disabled', priority: 100, enabled: false, createdAt: '2026-03-03T00:00:00.000Z' },
  ];

  const matched = matchMerchantRule(rules, 'Coffee Shop Toronto');
  assert.equal(matched.id, 'rule_2');
  assert.equal(matched.categoryId, 'cat_premium');
});

test('trajectory report projects income, surplus, debt balances, and emergency fund balance', async () => {
  const db = createDbDouble({
    incomeEntries: [
      { receivedDate: '2026-01-10', amount: '900.00' },
      { receivedDate: '2026-02-10', amount: '1200.00' },
      { receivedDate: '2026-03-10', amount: '900.00' },
    ],
    transactions: [
      { transactionDate: '2026-01-12', amount: '600.00', direction: 'debit' },
      { transactionDate: '2026-02-12', amount: '700.00', direction: 'debit' },
      { transactionDate: '2026-03-12', amount: '800.00', direction: 'debit' },
    ],
    monthlyReviews: [
      { reviewMonth: '2026-02-01', distributions: { emergency_fund: '100.00' } },
    ],
    surplusSplitRules: [
      { slug: 'emergency_fund', splitPercent: '0.5000', sortOrder: 1, isActive: true },
      { slug: 'investment', splitPercent: '0.5000', sortOrder: 2, isActive: true },
    ],
    debts: [
      { id: 'debt_1', startingBalance: '1000.00', monthlyPayment: '150.00', name: 'Visa' },
    ],
    debtPayments: [
      { debtId: 'debt_1', amount: '100.00' },
    ],
  });

  const result = await getTrajectoryReport({
    db,
    householdId: 'household_1',
    months: 2,
  });

  assert.deepEqual(result, {
    projections: [
      {
        month: '2026-03-01',
        projectedIncome: '1000.00',
        projectedSurplus: '300.00',
        debtBalances: [{ debtId: 'debt_1', projectedBalance: '750.00' }],
        emergencyFundBalance: '250.00',
      },
      {
        month: '2026-04-01',
        projectedIncome: '1000.00',
        projectedSurplus: '300.00',
        debtBalances: [{ debtId: 'debt_1', projectedBalance: '600.00' }],
        emergencyFundBalance: '400.00',
      },
    ],
  });
});

test('merchant rules, trajectory, and monthly review apply routes expose payloads', async () => {
  const db = createDbDouble({
    merchantRules: [{ id: 'rule_1', merchantPattern: 'coffee', categoryId: 'cat_food', priority: 2, enabled: true }],
    incomeEntries: [{ receivedDate: '2026-03-10', amount: '1000.00' }],
    transactions: [{ transactionDate: '2026-03-12', amount: '500.00', direction: 'debit' }],
    surplusSplitRules: [{ slug: 'emergency_fund', splitPercent: '1.0000', sortOrder: 1, isActive: true }],
  });

  const getResponse = await getMerchantRulesRoute(
    new Request('http://localhost/api/v1/merchant-rules', { headers: { 'x-household-id': 'household_1' } }),
    { db },
  );
  assert.equal(getResponse.status, 200);

  const postResponse = await postMerchantRuleRoute(
    new Request('http://localhost/api/v1/merchant-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-household-id': 'household_1' },
      body: JSON.stringify({ merchantPattern: 'Hydro', categoryId: 'cat_bills', enabled: true }),
    }),
    { db },
  );
  assert.equal(postResponse.status, 201);

  const patchResponse = await patchMerchantRuleRoute(
    new Request('http://localhost/api/v1/merchant-rules/rule_1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-household-id': 'household_1' },
      body: JSON.stringify({ priority: 4 }),
    }),
    { db, params: { id: 'rule_1' } },
  );
  assert.equal(patchResponse.status, 200);

  const deleteResponse = await deleteMerchantRuleRoute(
    new Request('http://localhost/api/v1/merchant-rules/rule_1', {
      method: 'DELETE',
      headers: { 'x-household-id': 'household_1' },
    }),
    { db, params: { id: 'rule_1' } },
  );
  assert.equal(deleteResponse.status, 204);

  const trajectoryResponse = await getTrajectoryRoute(
    new Request('http://localhost/api/v1/reports/trajectory?months=1', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );
  assert.equal(trajectoryResponse.status, 200);

  const applyResponse = await applyMonthlyReviewRoute(
    new Request('http://localhost/api/v1/monthly-reviews/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-household-id': 'household_1' },
      body: JSON.stringify({ reviewMonth: '2026-03-01' }),
    }),
    { db },
  );
  assert.equal(applyResponse.status, 201);
});
