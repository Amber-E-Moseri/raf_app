import test from 'node:test';
import assert from 'node:assert/strict';

import { computeCashFlowForecast } from '../lib/raf/cashFlowForecasting.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const START_DATE = '2026-09-04'; // deterministic fixed date

const household = { savingsFloorEnabled: false, savingsFloor: '0.00' };

const householdWithFloor = {
  savingsFloorEnabled: true,
  savingsFloor: '1000.00',
};

const accounts = [
  { id: 'acc1', accountType: 'checking', status: 'active', currentBalance: '5000.00' },
];

const incomeEntries = [
  { receivedDate: '2026-08-15', amount: '3000.00' },
  { receivedDate: '2026-07-15', amount: '3000.00' },
  { receivedDate: '2026-06-15', amount: '3000.00' },
];

const fixedBills = [
  { id: 'bill1', name: 'Rent', expected_amount: '1200.00', due_day_of_month: 1, active: true, category_slug: 'fixed_bills' },
  { id: 'bill2', name: 'Electric', expected_amount: '120.00', due_day_of_month: 15, active: true, category_slug: 'fixed_bills' },
];

const debts = [
  { id: 'debt1', name: 'Car loan', monthlyPayment: '350.00', paymentDueDay: 10, isActive: true, status: 'current' },
];

const allocationCategories = [
  { id: 'cat1', slug: 'groceries', label: 'Groceries', isActive: true, allocationPercent: '0.1000' },
];

const transactions = [
  { transactionDate: '2026-08-10', direction: 'debit', amount: '300.00', categoryId: 'cat1' },
  { transactionDate: '2026-07-12', direction: 'debit', amount: '280.00', categoryId: 'cat1' },
  { transactionDate: '2026-06-09', direction: 'debit', amount: '320.00', categoryId: 'cat1' },
];

// ── Validation tests ──────────────────────────────────────────────────────────

test('throws on missing startDate', () => {
  assert.throws(
    () => computeCashFlowForecast({ days: 30 }),
    /startDate must be a YYYY-MM-DD string/,
  );
});

test('throws on invalid startDate format', () => {
  assert.throws(
    () => computeCashFlowForecast({ startDate: '09-04-2026', days: 30 }),
    /startDate must be a YYYY-MM-DD string/,
  );
});

test('throws when days is zero or negative', () => {
  assert.throws(
    () => computeCashFlowForecast({ startDate: START_DATE, days: 0 }),
    /days must be an integer between 1 and 365/,
  );
});

test('throws when days exceeds 365', () => {
  assert.throws(
    () => computeCashFlowForecast({ startDate: START_DATE, days: 366 }),
    /days must be an integer between 1 and 365/,
  );
});

// ── Basic structure ───────────────────────────────────────────────────────────

test('returns correct number of projections', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household });
  assert.equal(result.projections.length, 30);
  assert.equal(result.days, 30);
  assert.equal(result.startDate, START_DATE);
});

test('projections have sequential day numbers starting at 1', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household });
  result.projections.forEach((p, i) => {
    assert.equal(p.dayNumber, i + 1);
  });
});

test('returns correct start and end dates for 30-day window', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household });
  assert.equal(result.startDate, '2026-09-04');
  assert.equal(result.endDate, '2026-10-03');
});

test('returns correct start and end dates for 60-day window', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 60, accounts, household });
  assert.equal(result.endDate, '2026-11-02');
});

// ── Starting balance ──────────────────────────────────────────────────────────

test('starting balance sums active non-liability accounts', () => {
  const accs = [
    { id: 'a1', accountType: 'checking', status: 'active', currentBalance: '2000.00' },
    { id: 'a2', accountType: 'savings', status: 'active', currentBalance: '3000.00' },
    { id: 'a3', accountType: 'credit_card', status: 'active', currentBalance: '500.00' },
    { id: 'a4', accountType: 'checking', status: 'archived', currentBalance: '1000.00' },
  ];
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts: accs, household });
  assert.equal(result.assumptions.startingBalance, '5000.00');
});

test('excludes credit_card, loan, and line_of_credit from starting balance', () => {
  const accs = [
    { id: 'a1', accountType: 'checking', status: 'active', currentBalance: '1000.00' },
    { id: 'a2', accountType: 'credit_card', status: 'active', currentBalance: '400.00' },
    { id: 'a3', accountType: 'loan', status: 'active', currentBalance: '200.00' },
    { id: 'a4', accountType: 'line_of_credit', status: 'active', currentBalance: '100.00' },
  ];
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts: accs, household });
  assert.equal(result.assumptions.startingBalance, '1000.00');
});

// ── Income baseline ───────────────────────────────────────────────────────────

test('computes average monthly income from last 3 months', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts,
    household,
    incomeEntries,
  });
  assert.equal(result.assumptions.avgMonthlyIncome, '3000.00');
  assert.equal(result.assumptions.incomeConfidence, 'expected');
});

test('income confidence is expected when history exists, estimated when zero', () => {
  const withHistory = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, incomeEntries });
  const noHistory = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household });
  assert.equal(withHistory.assumptions.incomeConfidence, 'expected');
  assert.equal(noHistory.assumptions.incomeConfidence, 'estimated');
});

test('income appears on the 15th of each month in the window', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, incomeEntries });
  const incomeDays = result.projections.filter((p) => Number(p.projectedIncome.amount) > 0);
  assert.equal(incomeDays.length, 1);
  assert.equal(incomeDays[0].date, '2026-09-15');
  assert.equal(incomeDays[0].projectedIncome.confidence, 'expected');
});

test('income appears in both months for a 60-day window crossing a month boundary', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 60, accounts, household, incomeEntries });
  const incomeDays = result.projections.filter((p) => Number(p.projectedIncome.amount) > 0);
  assert.equal(incomeDays.length, 2);
  assert.equal(incomeDays[0].date, '2026-09-15');
  assert.equal(incomeDays[1].date, '2026-10-15');
});

// ── Fixed bills ───────────────────────────────────────────────────────────────

test('fixed bills appear on their due day', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, fixedBills });

  const sep1 = result.projections.find((p) => p.date === '2026-09-15');
  assert.ok(sep1);
  const elec = sep1.projectedFixedBills.bills.find((b) => b.billId === 'bill2');
  assert.ok(elec);
  assert.equal(elec.amount, '120.00');
  assert.equal(elec.confidence, 'confirmed');
});

test('inactive fixed bills are excluded from forecast', () => {
  const bills = [
    { id: 'b1', name: 'Rent', expected_amount: '1200.00', due_day_of_month: 1, active: false },
  ];
  const result = computeCashFlowForecast({ startDate: '2026-09-01', days: 30, accounts, household, fixedBills: bills });
  const allBills = result.projections.flatMap((p) => p.projectedFixedBills.bills);
  assert.equal(allBills.length, 0);
});

test('fixed bill due day clamped to last day of short months', () => {
  // Feb has 28 days in 2026; a bill due on the 31st should land on the 28th
  const bills = [{ id: 'b1', name: 'Test', expected_amount: '100.00', due_day_of_month: 31, active: true }];
  const result = computeCashFlowForecast({ startDate: '2026-02-01', days: 28, accounts, household, fixedBills: bills });
  const day28 = result.projections.find((p) => p.date === '2026-02-28');
  assert.ok(day28);
  assert.equal(day28.projectedFixedBills.bills.length, 1);
});

test('assumptions report correct fixed bills count', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, fixedBills });
  assert.equal(result.assumptions.fixedBillsCount, 2);
});

// ── Debt payments ─────────────────────────────────────────────────────────────

test('debt payments appear on their due day', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, debts });
  const sep10 = result.projections.find((p) => p.date === '2026-09-10');
  assert.ok(sep10);
  assert.equal(sep10.projectedDebtPayments.byDebt.length, 1);
  assert.equal(sep10.projectedDebtPayments.byDebt[0].debtId, 'debt1');
  assert.equal(sep10.projectedDebtPayments.byDebt[0].amount, '350.00');
  assert.equal(sep10.projectedDebtPayments.byDebt[0].confidence, 'expected');
});

test('inactive debts and paid-off debts are excluded', () => {
  const inactiveDebts = [
    { id: 'd1', name: 'Old loan', monthlyPayment: '200.00', paymentDueDay: 5, isActive: false },
    { id: 'd2', name: 'Paid car', monthlyPayment: '350.00', paymentDueDay: 10, isActive: true, status: 'paid_off' },
  ];
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, debts: inactiveDebts });
  const allDebtDays = result.projections.filter((p) => p.projectedDebtPayments.byDebt.length > 0);
  assert.equal(allDebtDays.length, 0);
});

// ── Category baselines ────────────────────────────────────────────────────────

test('category baseline is computed as 3-month average', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts,
    household,
    allocationCategories,
    transactions,
  });

  // 300 + 280 + 320 = 900, average = 300/month
  const baseline = result.assumptions.categoryBaselines.find((b) => b.slug === 'groceries');
  assert.ok(baseline);
  assert.equal(baseline.monthlyAverage, '300.00');
  assert.equal(baseline.confidence, 'estimated');
});

test('category spending is distributed daily across the month', () => {
  const result = computeCashFlowForecast({
    startDate: '2026-09-01',
    days: 30,
    accounts,
    household,
    allocationCategories,
    transactions,
  });

  // September has 30 days, 300/30 = 10.00/day
  const day1 = result.projections[0];
  const groceries = day1.projectedCategorySpending.byCategory.find((c) => c.slug === 'groceries');
  assert.ok(groceries);
  assert.equal(groceries.amount, '10.00');
  assert.equal(groceries.confidence, 'estimated');
});

// ── Balance calculation ───────────────────────────────────────────────────────

test('projected balance starts from starting balance and accumulates daily', () => {
  // Simple case: no income, no bills, no spending → balance stays flat
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 5,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '1000.00' }],
    household,
  });

  // With no income, no bills, no categories, balance should be unchanged each day
  result.projections.forEach((p) => {
    assert.equal(p.projectedBalance, '1000.00');
  });
});

test('balance decreases on bill days and increases on income days', () => {
  const simpleBill = [{ id: 'b1', name: 'Rent', expected_amount: '500.00', due_day_of_month: 1, active: true }];
  const simpleIncome = [
    { receivedDate: '2026-08-15', amount: '2000.00' },
    { receivedDate: '2026-07-15', amount: '2000.00' },
    { receivedDate: '2026-06-15', amount: '2000.00' },
  ];
  const result = computeCashFlowForecast({
    startDate: '2026-09-01',
    days: 30,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '1000.00' }],
    household,
    fixedBills: simpleBill,
    incomeEntries: simpleIncome,
  });

  // Day 1 (Sep 1): rent due, $1000 - $500 = $500
  const day1 = result.projections[0];
  assert.equal(day1.date, '2026-09-01');
  assert.equal(day1.projectedBalance, '500.00');

  // Day 15 (Sep 15): income arrives (+$2000)
  const day15 = result.projections[14];
  assert.equal(day15.date, '2026-09-15');
  const balanceAfterIncome = Number(day15.projectedBalance);
  assert.ok(balanceAfterIncome > Number(result.projections[13].projectedBalance));
});

// ── Savings floor ─────────────────────────────────────────────────────────────

test('daysAboveSavingsFloor counts correctly', () => {
  // $500 balance, $1000 floor → always below
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '500.00' }],
    household: householdWithFloor,
  });

  assert.equal(result.summaryMetrics.daysAboveSavingsFloor, 0);
  assert.equal(result.summaryMetrics.obligations.daysWithShortfall, 30);
});

test('constraints.belowSavingsFloor is true when balance < floor', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 5,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '500.00' }],
    household: householdWithFloor,
  });

  result.projections.forEach((p) => {
    assert.equal(p.constraints.belowSavingsFloor, true);
    assert.equal(p.pressureIndicators.riskLevel, 'critical');
  });
});

test('riskLevel is healthy when balance is well above savings floor', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 5,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '10000.00' }],
    household: householdWithFloor,
  });

  result.projections.forEach((p) => {
    assert.equal(p.pressureIndicators.riskLevel, 'healthy');
  });
});

// ── Summary metrics ───────────────────────────────────────────────────────────

test('lowestProjectedBalance is tracked correctly', () => {
  // Bill on day 1 reduces balance, then income on day 15 restores it
  const bills = [{ id: 'b1', name: 'Rent', expected_amount: '800.00', due_day_of_month: 4, active: true }];
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '1000.00' }],
    household,
    fixedBills: bills,
  });

  // After bill on Sep 4, balance should drop
  const lowestAmt = Number(result.summaryMetrics.lowestProjectedBalance.amount);
  assert.ok(lowestAmt < 1000);
});

test('summaryMetrics.obligations.totalObligations sums all bills and debts', () => {
  const result = computeCashFlowForecast({
    startDate: '2026-09-01',
    days: 30,
    accounts,
    household,
    fixedBills,
    debts,
  });

  // Rent 1200 + Electric 120 + Car 350 = 1670
  assert.equal(result.summaryMetrics.obligations.totalObligations, '1670.00');
});

// ── Pressure points ───────────────────────────────────────────────────────────

test('pressurePoints only appears for non-healthy days', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '500.00' }],
    household: householdWithFloor,
  });

  // All days are critical; pressurePoints capped at 10
  assert.ok(result.pressurePoints.length <= 10);
  result.pressurePoints.forEach((pp) => {
    assert.ok(['tight', 'critical'].includes(pp.riskLevel));
  });
});

test('pressurePoints is empty when all days are healthy', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 5,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '50000.00' }],
    household: householdWithFloor,
  });

  assert.equal(result.pressurePoints.length, 0);
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test('empty inputs produce a valid forecast with zero amounts', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30 });
  assert.equal(result.days, 30);
  assert.equal(result.assumptions.startingBalance, '0.00');
  assert.equal(result.assumptions.avgMonthlyIncome, '0.00');
  assert.equal(result.projections.length, 30);
});

test('90-day window produces exactly 90 projections', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 90, accounts, household });
  assert.equal(result.projections.length, 90);
});

test('forecastPeriod is the first of the start month', () => {
  const result = computeCashFlowForecast({ startDate: '2026-09-15', days: 30, accounts, household });
  assert.equal(result.forecastPeriod, '2026-09-01');
});

test('money values preserve cent precision throughout', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '1234.56' }],
    household,
  });

  // Every money field should match X.XX format
  const moneyPattern = /^-?(?:0|[1-9]\d*)\.\d{2}$/;
  result.projections.forEach((p) => {
    assert.match(p.projectedBalance, moneyPattern);
    assert.match(p.netCashFlow, moneyPattern);
  });
});

test('identical inputs produce identical forecast (deterministic)', () => {
  const params = { startDate: START_DATE, days: 30, accounts, household, incomeEntries, fixedBills, debts, allocationCategories, transactions };
  const a = computeCashFlowForecast(params);
  const b = computeCashFlowForecast(params);
  assert.equal(a.assumptions.startingBalance, b.assumptions.startingBalance);
  assert.equal(a.summaryMetrics.lowestProjectedBalance.amount, b.summaryMetrics.lowestProjectedBalance.amount);
  assert.equal(a.summaryMetrics.lowestProjectedBalance.date, b.summaryMetrics.lowestProjectedBalance.date);
  a.projections.forEach((p, i) => {
    assert.equal(p.projectedBalance, b.projections[i].projectedBalance);
  });
});

// ── Account type semantics ────────────────────────────────────────────────────

test('investment accounts are excluded from starting balance', () => {
  const accs = [
    { id: 'a1', accountType: 'checking', status: 'active', currentBalance: '2000.00' },
    { id: 'a2', accountType: 'investment', status: 'active', currentBalance: '50000.00' },
  ];
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts: accs, household });
  assert.equal(result.assumptions.startingBalance, '2000.00');
  assert.equal(result.assumptions.investmentAccountsExcluded, '50000.00');
});

test('credit card balance does not increase projected liquid cash', () => {
  const accs = [
    { id: 'a1', accountType: 'checking', status: 'active', currentBalance: '1000.00' },
    { id: 'a2', accountType: 'credit_card', status: 'active', currentBalance: '5000.00' },
  ];
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts: accs, household });
  assert.equal(result.assumptions.startingBalance, '1000.00');
});

test('savings accounts contribute to liquid starting balance', () => {
  const accs = [
    { id: 'a1', accountType: 'checking', status: 'active', currentBalance: '1000.00' },
    { id: 'a2', accountType: 'savings', status: 'active', currentBalance: '2000.00' },
  ];
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts: accs, household });
  assert.equal(result.assumptions.startingBalance, '3000.00');
  assert.equal(result.assumptions.liquidCashBalance, '1000.00');
  assert.equal(result.assumptions.savingsAccountBalance, '2000.00');
});

// ── Upcoming expenses ─────────────────────────────────────────────────────────

const upcomingExpenses = [
  {
    id: 'exp1',
    name: 'Car repair',
    amount: '800.00',
    expectedDate: '2026-09-20',
    category: 'auto',
    confidence: 'confirmed',
    status: 'active',
  },
];

test('known upcoming expense appears on its expectedDate as a one-time outflow', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts,
    household,
    upcomingExpenses,
  });
  const sep20 = result.projections.find((p) => p.date === '2026-09-20');
  assert.ok(sep20);
  assert.equal(sep20.projectedUpcomingExpenses.expenses.length, 1);
  assert.equal(sep20.projectedUpcomingExpenses.expenses[0].expenseId, 'exp1');
  assert.equal(sep20.projectedUpcomingExpenses.expenses[0].amount, '800.00');
  assert.equal(sep20.projectedUpcomingExpenses.expenses[0].confidence, 'confirmed');
  assert.equal(sep20.projectedUpcomingExpenses.expenses[0].direction, 'outflow');
  assert.equal(sep20.projectedUpcomingExpenses.expenses[0].sourceType, 'upcoming_expense');
});

test('upcoming expense reduces the projected balance on its date', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '5000.00' }],
    household,
    upcomingExpenses,
  });
  const sep19 = result.projections.find((p) => p.date === '2026-09-19');
  const sep20 = result.projections.find((p) => p.date === '2026-09-20');
  const drop = Number(sep19.projectedBalance) - Number(sep20.projectedBalance);
  assert.ok(drop >= 800); // at least $800 drop (may also have category spending)
});

test('upcoming expense does not appear outside its date', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts,
    household,
    upcomingExpenses,
  });
  const otherDays = result.projections.filter((p) => p.date !== '2026-09-20');
  otherDays.forEach((p) => {
    assert.equal(p.projectedUpcomingExpenses.expenses.length, 0);
  });
});

test('archived upcoming expense is excluded from forecast', () => {
  const archivedExpenses = [{ ...upcomingExpenses[0], status: 'archived' }];
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts,
    household,
    upcomingExpenses: archivedExpenses,
  });
  const allExpenses = result.projections.flatMap((p) => p.projectedUpcomingExpenses.expenses);
  assert.equal(allExpenses.length, 0);
});

test('upcoming expense outside the forecast window is excluded', () => {
  const futureExpenses = [{ ...upcomingExpenses[0], expectedDate: '2027-01-01' }];
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts,
    household,
    upcomingExpenses: futureExpenses,
  });
  const allExpenses = result.projections.flatMap((p) => p.projectedUpcomingExpenses.expenses);
  assert.equal(allExpenses.length, 0);
});

test('upcoming expense count reported in assumptions', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, upcomingExpenses });
  assert.equal(result.assumptions.upcomingExpensesCount, 1);
});

// ── Double-counting prevention ────────────────────────────────────────────────

test('fixed bill category slug is excluded from variable spending baseline', () => {
  // A category whose slug matches a fixed bill category_slug must not also appear in variable baseline.
  const billCategories = [
    { id: 'cat-fixed', slug: 'fixed_bills', label: 'Fixed Bills', isActive: true },
    { id: 'cat-groceries', slug: 'groceries', label: 'Groceries', isActive: true },
  ];
  const billTransactions = [
    // Rent transaction tagged as fixed_bills — should NOT contribute to variable baseline
    { transactionDate: '2026-08-01', direction: 'debit', amount: '1200.00', categoryId: 'cat-fixed' },
    { transactionDate: '2026-07-01', direction: 'debit', amount: '1200.00', categoryId: 'cat-fixed' },
    { transactionDate: '2026-06-01', direction: 'debit', amount: '1200.00', categoryId: 'cat-fixed' },
    // Grocery transaction — should appear normally
    { transactionDate: '2026-08-10', direction: 'debit', amount: '300.00', categoryId: 'cat-groceries' },
    { transactionDate: '2026-07-10', direction: 'debit', amount: '300.00', categoryId: 'cat-groceries' },
    { transactionDate: '2026-06-10', direction: 'debit', amount: '300.00', categoryId: 'cat-groceries' },
  ];
  const bills = [
    { id: 'bill1', name: 'Rent', expected_amount: '1200.00', due_day_of_month: 1, active: true, category_slug: 'fixed_bills' },
  ];
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts,
    household,
    allocationCategories: billCategories,
    transactions: billTransactions,
    fixedBills: bills,
  });

  const fixedBillBaseline = result.assumptions.categoryBaselines.find((b) => b.slug === 'fixed_bills');
  const groceriesBaseline = result.assumptions.categoryBaselines.find((b) => b.slug === 'groceries');

  // fixed_bills category is excluded from baseline to prevent double-counting with the confirmed bill
  assert.equal(fixedBillBaseline, undefined);
  // groceries is included normally
  assert.ok(groceriesBaseline);
  assert.equal(groceriesBaseline.monthlyAverage, '300.00');
  // The excluded category is documented in assumptions
  assert.ok(result.assumptions.obligationCategoriesExcluded.includes('fixed_bills'));
});

test('debt_payment category slug is excluded from variable spending baseline', () => {
  const cats = [{ id: 'cat-dp', slug: 'debt_payment', label: 'Debt Payment', isActive: true }];
  const txs = [
    { transactionDate: '2026-08-10', direction: 'debit', amount: '350.00', categoryId: 'cat-dp' },
    { transactionDate: '2026-07-10', direction: 'debit', amount: '350.00', categoryId: 'cat-dp' },
    { transactionDate: '2026-06-10', direction: 'debit', amount: '350.00', categoryId: 'cat-dp' },
  ];
  const result = computeCashFlowForecast({
    startDate: START_DATE, days: 30, accounts, household,
    allocationCategories: cats, transactions: txs, debts,
  });
  const dpBaseline = result.assumptions.categoryBaselines.find((b) => b.slug === 'debt_payment');
  assert.equal(dpBaseline, undefined);
});

// ── Income timing ─────────────────────────────────────────────────────────────

test('expected income on Sep 12 is not available on Sep 5 (income timing integrity)', () => {
  // Scenario: today Sep 4, cash $500, income expected Sep 12 ($2000)
  // Sep 5 projected cash must not include the $2000.
  const futureIncome = [
    { receivedDate: '2026-08-12', amount: '2000.00' },
    { receivedDate: '2026-07-12', amount: '2000.00' },
    { receivedDate: '2026-06-12', amount: '2000.00' },
  ];
  // With trailing avg income of $2000/mo, income is projected on the 15th of each month.
  // Sep 5 is before the 15th, so income must not appear until Sep 15.
  const result = computeCashFlowForecast({
    startDate: '2026-09-04',
    days: 12,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '500.00' }],
    household,
    incomeEntries: futureIncome,
  });
  const sep5 = result.projections.find((p) => p.date === '2026-09-05');
  assert.ok(sep5);
  assert.equal(Number(sep5.projectedIncome.amount), 0); // no income before the 15th
  // The projected balance on Sep 5 should be ~$500 (minus any daily spending), not $2500
  assert.ok(Number(sep5.projectedBalance) < 1000);
});

test('expected income appears only on or after its projected receipt date', () => {
  const result = computeCashFlowForecast({
    startDate: '2026-09-04',
    days: 20,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '5000.00' }],
    household,
    incomeEntries,
  });
  // Income should only appear on Sep 15
  const incomeDays = result.projections.filter((p) => Number(p.projectedIncome.amount) > 0);
  assert.equal(incomeDays.length, 1);
  assert.equal(incomeDays[0].date, '2026-09-15');
});

// ── Debt timing ───────────────────────────────────────────────────────────────

test('debt payment appears on its due day only', () => {
  const result = computeCashFlowForecast({
    startDate: '2026-09-01',
    days: 60,
    accounts,
    household,
    debts,
  });
  const paymentDays = result.projections.filter((p) => p.projectedDebtPayments.byDebt.length > 0);
  // Sep 10 and Oct 10 should have payments
  assert.equal(paymentDays.length, 2);
  assert.equal(paymentDays[0].date, '2026-09-10');
  assert.equal(paymentDays[1].date, '2026-10-10');
});

test('forecasted debt payment does not create a transaction (source type is debt_payment)', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE, days: 30, accounts, household, debts,
  });
  const debtDays = result.projections.filter((p) => p.projectedDebtPayments.byDebt.length > 0);
  debtDays.forEach((p) => {
    p.projectedDebtPayments.byDebt.forEach((d) => {
      assert.equal(d.sourceType, 'debt_payment');
      assert.equal(d.direction, 'outflow');
    });
  });
});

// ── Pressure points & deficit detection ──────────────────────────────────────

test('firstProjectedDeficitDate is null when balance never goes negative', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE, days: 30,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '50000.00' }],
    household,
  });
  assert.equal(result.summaryMetrics.firstProjectedDeficitDate, null);
});

test('firstProjectedDeficitDate detects first date balance drops below zero', () => {
  // $100 balance, $500 bill on day 5 → deficit on day 5
  const bigBill = [{ id: 'b1', name: 'Bill', expected_amount: '500.00', due_day_of_month: 8, active: true }];
  const result = computeCashFlowForecast({
    startDate: '2026-09-04',
    days: 30,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '100.00' }],
    household,
    fixedBills: bigBill,
  });
  assert.ok(result.summaryMetrics.firstProjectedDeficitDate !== null);
  assert.equal(result.summaryMetrics.firstProjectedDeficitDate, '2026-09-08');
});

test('lowestProjectedAvailableMargin tracks tightest point above floor', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 30,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '2000.00' }],
    household: householdWithFloor,
    fixedBills: [{ id: 'b1', name: 'Big Bill', expected_amount: '500.00', due_day_of_month: 4, active: true }],
  });
  // Should be reported and be less than initial margin
  const margin = result.summaryMetrics.lowestProjectedAvailableMargin;
  assert.ok(margin.amount !== undefined);
  assert.ok(margin.date !== undefined);
  assert.ok(Number(margin.amount) < 1000); // initial margin is 2000-1000=1000
});

// ── Confidence & event semantics ──────────────────────────────────────────────

test('fixed bill events have direction outflow and sourceType fixed_bill', () => {
  const result = computeCashFlowForecast({ startDate: '2026-09-01', days: 30, accounts, household, fixedBills });
  const billDays = result.projections.filter((p) => p.projectedFixedBills.bills.length > 0);
  billDays.forEach((p) => {
    p.projectedFixedBills.bills.forEach((b) => {
      assert.equal(b.direction, 'outflow');
      assert.equal(b.sourceType, 'fixed_bill');
      assert.equal(b.confidence, 'confirmed');
    });
  });
});

test('income events have direction inflow and sourceType income', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, incomeEntries });
  const incomeDays = result.projections.filter((p) => Number(p.projectedIncome.amount) > 0);
  incomeDays.forEach((p) => {
    assert.equal(p.projectedIncome.direction, 'inflow');
    assert.equal(p.projectedIncome.sourceType, 'income');
  });
});

test('category spending events have direction outflow and sourceType category_spending', () => {
  const result = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, allocationCategories, transactions });
  const spendDays = result.projections.filter((p) => p.projectedCategorySpending.byCategory.length > 0);
  spendDays.forEach((p) => {
    p.projectedCategorySpending.byCategory.forEach((s) => {
      assert.equal(s.direction, 'outflow');
      assert.equal(s.sourceType, 'category_spending');
    });
  });
});

// ── New summary metrics ───────────────────────────────────────────────────────

test('totalExpectedIncome sums all income events across the window', () => {
  const result = computeCashFlowForecast({ startDate: '2026-09-01', days: 30, accounts, household, incomeEntries });
  // Sep has one income event of $3000 avg
  assert.equal(result.summaryMetrics.totalExpectedIncome, '3000.00');
});

test('totalEstimatedVariableSpending sums category spending across the window', () => {
  const result = computeCashFlowForecast({
    startDate: '2026-09-01', days: 30, accounts, household, allocationCategories, transactions,
  });
  // $300/mo average, 30 days in Sep → 300.00 total (small rounding per day)
  const total = Number(result.summaryMetrics.totalEstimatedVariableSpending);
  assert.ok(total >= 295 && total <= 305); // allow rounding
});

test('obligations split into confirmed and expected totals', () => {
  const result = computeCashFlowForecast({
    startDate: '2026-09-01', days: 30, accounts, household, fixedBills, debts,
  });
  const confirmed = Number(result.summaryMetrics.obligations.totalConfirmedObligations);
  const expected = Number(result.summaryMetrics.obligations.totalExpectedObligations);
  const total = Number(result.summaryMetrics.obligations.totalObligations);
  // Total = bills (1320) + car (350) = 1670
  assert.equal(result.summaryMetrics.obligations.totalObligations, '1670.00');
  // Bills are confirmed, debt is expected
  assert.ok(confirmed >= 1320);
  assert.ok(expected >= 350);
  assert.ok(confirmed + expected >= total);
});

// ── 30 vs 60 vs 90 event inclusion ───────────────────────────────────────────

test('30-day window only includes events within 30 days', () => {
  const result30 = computeCashFlowForecast({ startDate: START_DATE, days: 30, accounts, household, fixedBills });
  const result90 = computeCashFlowForecast({ startDate: START_DATE, days: 90, accounts, household, fixedBills });
  assert.ok(result30.projections.length === 30);
  assert.ok(result90.projections.length === 90);
  // Day 31 events should not appear in 30-day forecast
  const day31DateStr = result90.projections[30].date;
  const day31In30 = result30.projections.find((p) => p.date === day31DateStr);
  assert.equal(day31In30, undefined);
});

// ── Recurring detection boundary (documented) ─────────────────────────────────

test('category baseline only uses explicitly confirmed allocationCategories, not raw transaction detection', () => {
  // A transaction that looks recurring but whose category is NOT in allocationCategories
  // should NOT appear in the baseline, preventing unconfirmed recurring detection.
  const txWithUnknownCategory = [
    { transactionDate: '2026-08-01', direction: 'debit', amount: '50.00', categoryId: 'unknown-cat-id' },
    { transactionDate: '2026-07-01', direction: 'debit', amount: '50.00', categoryId: 'unknown-cat-id' },
    { transactionDate: '2026-06-01', direction: 'debit', amount: '50.00', categoryId: 'unknown-cat-id' },
  ];
  const result = computeCashFlowForecast({
    startDate: START_DATE, days: 30, accounts, household,
    allocationCategories: [], // no confirmed categories
    transactions: txWithUnknownCategory,
  });
  assert.equal(result.assumptions.categoryBaselines.length, 0);
});

// ── Protected savings semantics ───────────────────────────────────────────────

test('projected available margin equals balance minus savings floor', () => {
  const result = computeCashFlowForecast({
    startDate: START_DATE,
    days: 5,
    accounts: [{ id: 'a1', accountType: 'checking', status: 'active', currentBalance: '3000.00' }],
    household: householdWithFloor, // floor = 1000
  });
  result.projections.forEach((p) => {
    const balance = Number(p.projectedBalance);
    const margin = Number(p.projectedAvailableMargin);
    // available margin = max(0, balance - floor)
    assert.equal(margin, Math.max(0, balance - 1000));
  });
});
