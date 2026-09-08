import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTrajectoryProjections } from '../lib/trajectory/index.js';

function fixture() {
  return {
    activeMonth: '2026-03-01',
    months: 3,
    household: {
      monthlyEssentialsBaseline: '1000.00',
    },
    debts: [
      {
        id: 'debt_1',
        name: 'Visa',
        startingBalance: '900.00',
        minimumPayment: '100.00',
        monthlyPayment: '300.00',
        apr: 0,
        isActive: true,
      },
    ],
    debtPayments: [
      { debtId: 'debt_1', paymentDate: '2026-01-10', amount: '300.00' },
    ],
    incomeEntries: [
      { receivedDate: '2026-01-10', amount: '3000.00' },
      { receivedDate: '2026-02-10', amount: '3000.00' },
      { receivedDate: '2026-03-10', amount: '3000.00' },
    ],
    transactions: [
      { transactionDate: '2026-01-12', direction: 'debit', amount: '2100.00' },
      { transactionDate: '2026-02-12', direction: 'debit', amount: '2100.00' },
      { transactionDate: '2026-03-12', direction: 'debit', amount: '2100.00' },
    ],
    incomeAllocations: [
      { slug: 'savings', allocatedAmount: '1000.00' },
    ],
    allocationCategories: [
      { id: 'cat_1', slug: 'savings', allocationPercent: '0.2000', isActive: true, sortOrder: 1 },
      { id: 'cat_2', slug: 'fixed_bills', allocationPercent: '0.8000', isActive: true, sortOrder: 2 },
    ],
    monthlyReviews: [
      { distributions: { emergency_fund: '100.00' } },
    ],
    surplusSplitRules: [
      { slug: 'emergency_fund', splitPercent: '0.5000', isActive: true, sortOrder: 1 },
      { slug: 'debt_payoff', splitPercent: '0.5000', isActive: true, sortOrder: 2 },
    ],
  };
}

test('trajectory engine returns all projection families with month-aligned timelines', () => {
  const result = buildTrajectoryProjections(fixture());

  assert.equal(result.debtPayoffProjection.length, 1);
  assert.equal(result.debtPayoffProjection[0].timeline.length, 3);
  assert.equal(result.savingsGrowthProjection.length, 3);
  assert.equal(result.emergencyFundCoverageProjection.length, 3);
  assert.equal(result.assumptions.projectedMonthlyIncome, '3000.00');
  assert.equal(result.assumptions.projectedMonthlySpending, '2100.00');
});

test('trajectory engine routes surplus remainder to emergency fund contribution math', () => {
  const result = buildTrajectoryProjections({
    ...fixture(),
    surplusSplitRules: [
      { slug: 'emergency_fund', splitPercent: '0.3333', isActive: true, sortOrder: 1 },
      { slug: 'debt_payoff', splitPercent: '0.6667', isActive: true, sortOrder: 2 },
    ],
  });

  const emergencySeries = result.emergencyFundCoverageProjection;
  assert.equal(emergencySeries.length, 3);
  assert.equal(Number(emergencySeries[0].emergencyFundBalance) > 100, true);
});
