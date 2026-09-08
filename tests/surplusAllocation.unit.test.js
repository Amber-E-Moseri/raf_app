import test from 'node:test';
import assert from 'node:assert/strict';

import { computeMonthlyReviewSnapshot } from '../lib/raf/reporting.js';

test('surplus allocation routes rounding remainder to emergency_fund', () => {
  const snapshot = computeMonthlyReviewSnapshot({
    reviewMonth: '2026-03-01',
    incomeEntries: [{ amount: '1000.00' }],
    transactions: [{ direction: 'debit', amount: '333.33' }],
    debtPayments: [],
    surplusSplitRules: [
      { slug: 'emergency_fund', splitPercent: '0.3333', isActive: true, sortOrder: 1 },
      { slug: 'debt_payoff', splitPercent: '0.3333', isActive: true, sortOrder: 2 },
      { slug: 'investment', splitPercent: '0.3334', isActive: true, sortOrder: 3 },
    ],
  });

  assert.equal(snapshot.netSurplus, '666.67');
  assert.deepEqual(snapshot.distributions, {
    emergency_fund: '222.21',
    debt_payoff: '222.20',
    investment: '222.26',
  });
});

test('surplus allocation rejects active split sets missing emergency_fund', () => {
  assert.throws(
    () => computeMonthlyReviewSnapshot({
      reviewMonth: '2026-03-01',
      incomeEntries: [{ amount: '500.00' }],
      transactions: [],
      debtPayments: [],
      surplusSplitRules: [
        { slug: 'debt_payoff', splitPercent: '1.0000', isActive: true, sortOrder: 1 },
      ],
    }),
    /must include the emergency_fund slug/,
  );
});

test('surplus allocation rejects invalid percent totals for active rules', () => {
  assert.throws(
    () => computeMonthlyReviewSnapshot({
      reviewMonth: '2026-03-01',
      incomeEntries: [{ amount: '500.00' }],
      transactions: [],
      debtPayments: [],
      surplusSplitRules: [
        { slug: 'emergency_fund', splitPercent: '0.6000', isActive: true, sortOrder: 1 },
        { slug: 'debt_payoff', splitPercent: '0.2000', isActive: true, sortOrder: 2 },
      ],
    }),
    /must sum to 1.0000/,
  );
});
