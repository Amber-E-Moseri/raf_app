import test from 'node:test';
import assert from 'node:assert/strict';

import { getCashFlowForecastReport, CashFlowForecastHttpError } from '../lib/reports/getCashFlowForecastReport.js';
import { GET as getCashFlowForecastRoute } from '../app/api/v1/reports/cash-flow-forecast/route.js';

const START_DATE = '2026-09-04';

function createDbDouble({
  household = {
    id: 'household_1',
    name: 'Test Household',
    timezone: 'America/Toronto',
    activeMonth: '2026-09-01',
    periodStartDay: 1,
    savingsFloor: '500.00',
    savingsFloorEnabled: true,
  },
  accounts = [
    { id: 'acct_1', accountType: 'checking', currentBalance: '2000.00' },
  ],
  incomeEntries = [
    { id: 'inc_1', sourceName: 'Payroll', receivedDate: '2026-08-15', amount: '3000.00' },
    { id: 'inc_2', sourceName: 'Payroll', receivedDate: '2026-07-15', amount: '3000.00' },
    { id: 'inc_3', sourceName: 'Payroll', receivedDate: '2026-06-15', amount: '3000.00' },
  ],
  fixedBills = [
    { id: 'bill_1', name: 'Rent', amountCents: 120000, dueDayOfMonth: 1, categorySlug: 'housing' },
  ],
  allocationCategories = [
    { id: 'cat_1', slug: 'groceries', label: 'Groceries', isActive: true },
  ],
  transactions = [],
  debts = [],
} = {}) {
  return {
    async transaction(callback) {
      return callback({
        async getHousehold() {
          return household;
        },
        async listFinancialAccounts() {
          return accounts;
        },
        async listIncomeEntries() {
          return incomeEntries;
        },
        async listFixedBills() {
          return fixedBills;
        },
        async listAllocationCategories() {
          return allocationCategories;
        },
        async listTransactions() {
          return transactions;
        },
        async listDebts() {
          return debts;
        },
        async listUpcomingExpenses() {
          return [];
        },
      });
    },
  };
}

// ── Report layer: happy path ─────────────────────────────────────────────────

test('getCashFlowForecastReport returns a complete forecast for 30 days', async () => {
  const db = createDbDouble();

  const result = await getCashFlowForecastReport({
    db,
    householdId: 'household_1',
    days: 30,
    startDate: START_DATE,
  });

  assert.equal(result.days, 30);
  assert.equal(result.startDate, START_DATE);
  assert.equal(typeof result.endDate, 'string');
  assert.equal(typeof result.forecastPeriod, 'string');
  assert.equal(typeof result.generatedAt, 'string');
  assert.equal(Array.isArray(result.projections), true);
  assert.equal(result.projections.length, 30);
  assert.ok(result.summaryMetrics);
  assert.ok(result.assumptions);
  assert.equal(typeof result.assumptions.startingBalance, 'string');
  assert.equal(result.assumptions.savingsFloorEnabled, true);
  assert.equal(typeof result.assumptions.avgMonthlyIncome, 'string');
});

test('getCashFlowForecastReport accepts days=60 and days=90', async () => {
  const db = createDbDouble();

  const result60 = await getCashFlowForecastReport({ db, householdId: 'household_1', days: 60, startDate: START_DATE });
  assert.equal(result60.days, 60);
  assert.equal(result60.projections.length, 60);

  const result90 = await getCashFlowForecastReport({ db, householdId: 'household_1', days: 90, startDate: START_DATE });
  assert.equal(result90.days, 90);
  assert.equal(result90.projections.length, 90);
});

test('getCashFlowForecastReport defaults days to 30 when omitted', async () => {
  const db = createDbDouble();

  const result = await getCashFlowForecastReport({ db, householdId: 'household_1', startDate: START_DATE });
  assert.equal(result.days, 30);
});

test('getCashFlowForecastReport reflects fixed bill as confirmed obligation', async () => {
  const db = createDbDouble({
    fixedBills: [{ id: 'bill_1', name: 'Rent', amountCents: 150000, dueDayOfMonth: 1, categorySlug: 'housing' }],
  });

  const result = await getCashFlowForecastReport({ db, householdId: 'household_1', days: 30, startDate: START_DATE });

  const billDay = result.projections.find((p) => p.projectedFixedBills.bills.length > 0);
  assert.ok(billDay, 'at least one projection day should carry the fixed bill');
  const bill = billDay.projectedFixedBills.bills[0];
  assert.equal(bill.billId, 'bill_1');
  assert.equal(bill.confidence, 'confirmed');
  assert.equal(bill.description, 'Rent');
});

test('getCashFlowForecastReport excludes liability accounts from starting balance', async () => {
  const db = createDbDouble({
    accounts: [
      { id: 'acct_checking', accountType: 'checking', currentBalance: '5000.00' },
      { id: 'acct_credit', accountType: 'credit_card', currentBalance: '1500.00' },
      { id: 'acct_loan', accountType: 'loan', currentBalance: '20000.00' },
    ],
  });

  const result = await getCashFlowForecastReport({ db, householdId: 'household_1', days: 30, startDate: START_DATE });

  // Only the checking account ($5000) should count; credit_card and loan are liabilities
  assert.equal(result.assumptions.startingBalance, '5000.00');
});

// ── Report layer: invalid input / error paths ─────────────────────────────────

test('getCashFlowForecastReport throws 400 when householdId is missing', async () => {
  const db = createDbDouble();

  await assert.rejects(
    () => getCashFlowForecastReport({ db, householdId: null, days: 30, startDate: START_DATE }),
    (err) => {
      assert.ok(err instanceof CashFlowForecastHttpError);
      assert.equal(err.status, 400);
      return true;
    },
  );
});

test('getCashFlowForecastReport throws 400 when days is not 30, 60, or 90', async () => {
  const db = createDbDouble();

  for (const invalid of [7, 45, 120, 'weekly']) {
    await assert.rejects(
      () => getCashFlowForecastReport({ db, householdId: 'household_1', days: invalid, startDate: START_DATE }),
      (err) => {
        assert.ok(err instanceof CashFlowForecastHttpError, `expected CashFlowForecastHttpError for days=${invalid}`);
        assert.equal(err.status, 400);
        return true;
      },
      `should reject invalid days value: ${JSON.stringify(invalid)}`,
    );
  }
});

test('getCashFlowForecastReport throws 404 when household is not found', async () => {
  const db = {
    async transaction(callback) {
      return callback({
        async getHousehold() {
          return null; // household not found
        },
        async listFinancialAccounts() { return []; },
        async listIncomeEntries() { return []; },
        async listFixedBills() { return []; },
        async listAllocationCategories() { return []; },
        async listTransactions() { return []; },
        async listDebts() { return []; },
        async listUpcomingExpenses() { return []; },
      });
    },
  };

  await assert.rejects(
    () => getCashFlowForecastReport({ db, householdId: 'does_not_exist', days: 30, startDate: START_DATE }),
    (err) => {
      assert.ok(err instanceof CashFlowForecastHttpError);
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test('getCashFlowForecastReport throws when db has no transaction method', async () => {
  await assert.rejects(
    () => getCashFlowForecastReport({ db: {}, householdId: 'household_1', days: 30, startDate: START_DATE }),
    /transaction/,
  );
});

// ── API route: happy path ─────────────────────────────────────────────────────

test('GET /reports/cash-flow-forecast returns 200 with forecast payload for days=30', async () => {
  const db = createDbDouble();

  const response = await getCashFlowForecastRoute(
    new Request(`http://localhost/api/v1/reports/cash-flow-forecast?days=30&_startDate=${START_DATE}`, {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db, householdId: 'household_1' },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.days, 30);
  assert.equal(payload.startDate, typeof payload.startDate === 'string' ? payload.startDate : START_DATE);
  assert.equal(Array.isArray(payload.projections), true);
  assert.equal(payload.projections.length, 30);
  assert.ok(payload.summaryMetrics);
  assert.ok(payload.assumptions);
});

test('GET /reports/cash-flow-forecast returns 200 for days=60 and days=90', async () => {
  const db = createDbDouble();

  for (const days of [60, 90]) {
    const response = await getCashFlowForecastRoute(
      new Request(`http://localhost/api/v1/reports/cash-flow-forecast?days=${days}`, {
        headers: { 'x-household-id': 'household_1' },
      }),
      { db, householdId: 'household_1' },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.days, days);
    assert.equal(payload.projections.length, days);
  }
});

// ── API route: invalid input / auth paths ─────────────────────────────────────

test('GET /reports/cash-flow-forecast returns 400 when household ID is absent', async () => {
  const db = createDbDouble();

  const response = await getCashFlowForecastRoute(
    new Request('http://localhost/api/v1/reports/cash-flow-forecast?days=30'),
    { db },
    // no householdId in context, no x-household-id header
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(typeof payload.error, 'string');
});

test('GET /reports/cash-flow-forecast returns 400 for invalid days values', async () => {
  const db = createDbDouble();

  for (const days of ['7', '45', 'weekly']) {
    const response = await getCashFlowForecastRoute(
      new Request(`http://localhost/api/v1/reports/cash-flow-forecast?days=${days}`, {
        headers: { 'x-household-id': 'household_1' },
      }),
      { db, householdId: 'household_1' },
    );
    assert.equal(response.status, 400, `expected 400 for days=${days}`);
    const payload = await response.json();
    assert.equal(typeof payload.error, 'string');
  }
});

test('GET /reports/cash-flow-forecast returns 404 when household is not found', async () => {
  const db = {
    async transaction(callback) {
      return callback({
        async getHousehold() { return null; },
        async listFinancialAccounts() { return []; },
        async listIncomeEntries() { return []; },
        async listFixedBills() { return []; },
        async listAllocationCategories() { return []; },
        async listTransactions() { return []; },
        async listDebts() { return []; },
        async listUpcomingExpenses() { return []; },
      });
    },
  };

  const response = await getCashFlowForecastRoute(
    new Request('http://localhost/api/v1/reports/cash-flow-forecast?days=30', {
      headers: { 'x-household-id': 'missing_household' },
    }),
    { db, householdId: 'missing_household' },
  );

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(typeof payload.error, 'string');
});

test('GET /reports/cash-flow-forecast returns 500 when db context is missing', async () => {
  // No db in context and no globalThis.__RAF_DB__ — getDb() will throw
  const response = await getCashFlowForecastRoute(
    new Request('http://localhost/api/v1/reports/cash-flow-forecast?days=30', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { householdId: 'household_1' }, // no db
  );

  assert.equal(response.status, 500);
});
