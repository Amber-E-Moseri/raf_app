import test from 'node:test';
import assert from 'node:assert/strict';

import { computeFinancialHealthScoreSnapshot } from '../lib/raf/financialHealthScore.js';

test('financial health scoring rewards positive surplus and debt reduction', () => {
  const snapshot = computeFinancialHealthScoreSnapshot({
    reviewMonth: '2026-03-01',
    incomeEntries: [
      { amount: '5000.00' },
    ],
    incomeAllocations: [
      { allocationCategoryId: 'cat_1', allocatedAmount: '2000.00' },
      { allocationCategoryId: 'cat_2', allocatedAmount: '1500.00' },
    ],
    allocationCategories: [
      { id: 'cat_1', slug: 'fixed_bills', isActive: true },
      { id: 'cat_2', slug: 'savings', isActive: true },
    ],
    transactions: [
      { direction: 'debit', amount: '2800.00', categoryId: 'cat_1' },
      { direction: 'credit', amount: '200.00', categoryId: 'cat_2' },
    ],
    debts: [
      {
        id: 'debt_1',
        name: 'Visa',
        startingBalance: '1000.00',
        apr: 0,
        minimumPayment: '100.00',
        monthlyPayment: '300.00',
        isActive: true,
      },
    ],
    debtPayments: [
      { debtId: 'debt_1', paymentDate: '2026-03-10', amount: '300.00' },
    ],
    debtAdjustments: [],
    savingsBalance: '2500.00',
    monthlyEssentials: '1250.00',
  });

  assert.equal(typeof snapshot.healthScore, 'number');
  assert.equal(snapshot.healthScore > 0, true);
  assert.equal(snapshot.healthPillars.length, 6);
  assert.equal(
    snapshot.healthPillars.find((pillar) => pillar.key === 'debt_reduction')?.score,
    100,
  );
});

test('financial health scoring penalizes overspending and debt growth', () => {
  const snapshot = computeFinancialHealthScoreSnapshot({
    reviewMonth: '2026-03-01',
    incomeEntries: [
      { amount: '2000.00' },
    ],
    incomeAllocations: [
      { allocationCategoryId: 'cat_1', allocatedAmount: '1000.00' },
    ],
    allocationCategories: [
      { id: 'cat_1', slug: 'personal_spending', isActive: true },
    ],
    transactions: [
      { direction: 'debit', amount: '2200.00', categoryId: 'cat_1' },
    ],
    debts: [
      {
        id: 'debt_1',
        name: 'Line of Credit',
        startingBalance: '1000.00',
        apr: 20,
        minimumPayment: '80.00',
        monthlyPayment: '80.00',
        isActive: true,
      },
    ],
    debtPayments: [],
    debtAdjustments: [
      { debtId: 'debt_1', amount: '50.00', adjustmentType: 'interest', effectiveDate: '2026-03-15' },
    ],
    savingsBalance: '0.00',
    monthlyEssentials: '1500.00',
  });

  const budgetPillar = snapshot.healthPillars.find((pillar) => pillar.key === 'budget_discipline');
  const debtReductionPillar = snapshot.healthPillars.find((pillar) => pillar.key === 'debt_reduction');

  assert.equal(snapshot.healthScore < 70, true);
  assert.equal((budgetPillar?.score ?? 100) < 100, true);
  assert.equal(debtReductionPillar?.value.includes('Debt increased'), true);
});
