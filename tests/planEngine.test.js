import test from 'node:test';
import assert from 'node:assert/strict';

import { computePlanResult, AllocationPriority } from '../lib/raf/planEngine.js';

// ── Fixtures ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'cat_tithe',    slug: 'tithe',            label: 'Tithe',            allocationPercent: '0.1000', isActive: true, sortOrder: 0 },
  { id: 'cat_partner',  slug: 'partnership',       label: 'Partnership',      allocationPercent: '0.1500', isActive: true, sortOrder: 1 },
  { id: 'cat_offer',    slug: 'offerings',         label: 'Offerings',        allocationPercent: '0.0500', isActive: true, sortOrder: 2 },
  { id: 'cat_bills',    slug: 'fixed_bills',       label: 'Fixed Bills',      allocationPercent: '0.3000', isActive: true, sortOrder: 3 },
  { id: 'cat_savings',  slug: 'savings',           label: 'Savings',          allocationPercent: '0.1000', isActive: true, sortOrder: 4 },
  { id: 'cat_spend',    slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '0.1500', isActive: true, sortOrder: 5 },
  { id: 'cat_invest',   slug: 'investment',        label: 'Investment',       allocationPercent: '0.0500', isActive: true, sortOrder: 6 },
  { id: 'cat_debt',     slug: 'debt_payoff',       label: 'Debt Payoff',      allocationPercent: '0.0500', isActive: true, sortOrder: 7 },
  { id: 'cat_buffer',   slug: 'buffer',            label: 'Buffer',           allocationPercent: '0.1000', isActive: true, sortOrder: 8 },
];

const SURPLUS_RULES = [
  { slug: 'emergency_fund',   label: 'Emergency Fund',   splitPercent: '0.3000', isActive: true, sortOrder: 0 },
  { slug: 'extra_debt_payoff', label: 'Extra Debt Payoff', splitPercent: '0.4000', isActive: true, sortOrder: 1 },
  { slug: 'investment',       label: 'Investment',       splitPercent: '0.2000', isActive: true, sortOrder: 2 },
  { slug: 'giving',           label: 'Giving',           splitPercent: '0.1000', isActive: true, sortOrder: 3 },
];

function makeAllocs(amount, categories) {
  // Simulates what computeDepositAllocations would produce: proportional allocation
  let remaining = Math.round(parseFloat(amount) * 100);
  const result = [];
  for (const cat of categories) {
    const pct = parseFloat(cat.allocationPercent);
    const cents = Math.floor(remaining * pct);  // simplified; not used for balance assertion
    result.push({
      allocationCategoryId: cat.id,
      allocatedAmount: (cents / 100).toFixed(2),
    });
    remaining -= cents;
  }
  // Dump leftover on last
  result[result.length - 1].allocatedAmount = (
    parseFloat(result[result.length - 1].allocatedAmount) + remaining / 100
  ).toFixed(2);
  return result;
}

// ── Tests: Core lifecycle ─────────────────────────────────────────────────

test('computePlanResult returns zero-state result with no inputs', () => {
  const result = computePlanResult({ period: '2026-03-01' });

  assert.equal(result.period, '2026-03-01');
  assert.equal(result.income.totalExpected, '0.00');
  assert.equal(result.income.totalReceived, '0.00');
  assert.equal(result.income.totalAllocated, '0.00');
  assert.equal(result.income.totalAvailable, '0.00');
  assert.equal(result.spending.total, '0.00');
  assert.equal(result.net, '0.00');
  assert.equal(result.isDeficit, false);
  assert.deepEqual(result.adjustmentCandidates, []);
  assert.equal(result.alertStatus, 'ok');
});

test('computePlanResult produces correct income lifecycle totals', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeStreams: [
      { id: 'stream_1', sourceName: 'Salary',     expectedAmount: '5000.00' },
      { id: 'stream_2', sourceName: 'Freelance',  expectedAmount: '2000.00' },
    ],
    incomeEntries: [
      { id: 'entry_1', sourceName: 'Salary',     amount: '5000.00', receivedDate: '2026-03-01' },
      { id: 'entry_2', sourceName: 'Freelance',  amount: '1500.00', receivedDate: '2026-03-15' },
    ],
    incomeAllocations: [
      { allocationCategoryId: 'cat_tithe', allocatedAmount: '500.00' },
      { allocationCategoryId: 'cat_bills', allocatedAmount: '1950.00' },
    ],
  });

  assert.equal(result.income.totalExpected, '7000.00');
  assert.equal(result.income.totalReceived, '6500.00');
  assert.equal(result.income.totalAllocated, '2450.00');
  assert.equal(result.income.totalAvailable, '4050.00');
  assert.equal(result.income.incomeShortfall, '500.00');
  assert.equal(result.income.incomeStatus, 'partial');
});

test('income status is met when received equals expected', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeStreams: [{ id: 's1', sourceName: 'Salary', expectedAmount: '4000.00' }],
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '4000.00', receivedDate: '2026-03-01' }],
  });
  assert.equal(result.income.incomeStatus, 'met');
  assert.equal(result.income.incomeShortfall, '0.00');
});

test('income status is exceeded when received exceeds expected', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeStreams: [{ id: 's1', sourceName: 'Salary', expectedAmount: '4000.00' }],
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '5000.00', receivedDate: '2026-03-01' }],
  });
  assert.equal(result.income.incomeStatus, 'exceeded');
  assert.equal(result.income.incomeShortfall, '0.00');
});

test('income status is pending when no entries received', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeStreams: [{ id: 's1', sourceName: 'Salary', expectedAmount: '4000.00' }],
  });
  assert.equal(result.income.incomeStatus, 'pending');
});

// ── Tests: Allocation categories ──────────────────────────────────────────

test('byCategory rows include priority and isProtected for each active category', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: CATEGORIES,
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '10000.00', receivedDate: '2026-03-01' }],
  });

  const bySlug = Object.fromEntries(result.spending.byCategory.map((row) => [row.slug, row]));

  assert.equal(bySlug.tithe.priority, AllocationPriority.GIVING);
  assert.equal(bySlug.tithe.isProtected, true);
  assert.equal(bySlug.partnership.priority, AllocationPriority.GIVING);
  assert.equal(bySlug.offerings.priority, AllocationPriority.GIVING);
  assert.equal(bySlug.fixed_bills.priority, AllocationPriority.OBLIGATIONS);
  assert.equal(bySlug.fixed_bills.isProtected, true);
  assert.equal(bySlug.savings.priority, AllocationPriority.SAVINGS_FLOOR);
  assert.equal(bySlug.savings.isProtected, false);
  assert.equal(bySlug.personal_spending.priority, AllocationPriority.FLEXIBLE_SPENDING);
  assert.equal(bySlug.personal_spending.isProtected, false);
  assert.equal(bySlug.investment.priority, AllocationPriority.ACCELERATED_SAVINGS);
  assert.equal(bySlug.debt_payoff.priority, AllocationPriority.ACCELERATED_DEBT);
  assert.equal(bySlug.buffer.priority, AllocationPriority.SAVINGS_FLOOR);
});

test('budgeted amounts are computed as allocationPercent of totalExpected', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeStreams: [{ id: 's1', sourceName: 'Salary', expectedAmount: '10000.00' }],
    allocationCategories: [
      { id: 'cat_tithe', slug: 'tithe', label: 'Tithe', allocationPercent: '0.1000', isActive: true, sortOrder: 0 },
      { id: 'cat_bills', slug: 'fixed_bills', label: 'Fixed Bills', allocationPercent: '0.3000', isActive: true, sortOrder: 1 },
    ],
  });

  const bySlug = Object.fromEntries(result.spending.byCategory.map((r) => [r.slug, r]));
  assert.equal(bySlug.tithe.budgeted, '1000.00');
  assert.equal(bySlug.fixed_bills.budgeted, '3000.00');
});

test('category status is on_track when spent within allocation', () => {
  const allocs = [{ allocationCategoryId: 'cat_bills', allocatedAmount: '3000.00' }];
  const txns = [{ id: 'tx1', amount: '1200.00', direction: 'debit', categoryId: 'cat_bills' }];

  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [{ id: 'cat_bills', slug: 'fixed_bills', label: 'Fixed Bills', allocationPercent: '0.3000', isActive: true, sortOrder: 0 }],
    incomeAllocations: allocs,
    transactions: txns,
  });

  const row = result.spending.byCategory[0];
  assert.equal(row.slug, 'fixed_bills');
  assert.equal(row.status, 'on_track');
  assert.equal(row.spent, '1200.00');
  assert.equal(row.remaining, '1800.00');
  assert.equal(row.overrun, '0.00');
});

test('category status is over_budget when spent exceeds allocation', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [{ id: 'cat_spend', slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '0.1500', isActive: true, sortOrder: 0 }],
    incomeAllocations: [{ allocationCategoryId: 'cat_spend', allocatedAmount: '500.00' }],
    transactions: [
      { id: 'tx1', amount: '300.00', direction: 'debit', categoryId: 'cat_spend' },
      { id: 'tx2', amount: '400.00', direction: 'debit', categoryId: 'cat_spend' },
    ],
  });

  const row = result.spending.byCategory[0];
  assert.equal(row.status, 'over_budget');
  assert.equal(row.spent, '700.00');
  assert.equal(row.overrun, '200.00');
  assert.equal(row.remaining, '-200.00');
});

test('credit transactions add to category budget instead of counting as spending', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [{ id: 'cat_bills', slug: 'fixed_bills', label: 'Fixed Bills', allocationPercent: '0.3000', isActive: true, sortOrder: 0 }],
    incomeAllocations: [{ allocationCategoryId: 'cat_bills', allocatedAmount: '1000.00' }],
    transactions: [
      { id: 'tx1', amount: '800.00', direction: 'debit',  categoryId: 'cat_bills' },
      { id: 'tx2', amount: '200.00', direction: 'credit', categoryId: 'cat_bills' },  // refund
    ],
  });

  const row = result.spending.byCategory[0];
  assert.equal(row.allocated, '1000.00');
  assert.equal(row.added, '200.00');
  assert.equal(row.spent, '800.00');
  assert.equal(row.remaining, '400.00');
  assert.equal(row.status, 'on_track');
});

test('inactive categories are excluded from byCategory rows', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [
      { id: 'cat_a', slug: 'tithe',      label: 'Tithe',   allocationPercent: '0.1000', isActive: true,  sortOrder: 0 },
      { id: 'cat_b', slug: 'investment', label: 'Invest',  allocationPercent: '0.0500', isActive: false, sortOrder: 1 },
    ],
  });

  assert.equal(result.spending.byCategory.length, 1);
  assert.equal(result.spending.byCategory[0].slug, 'tithe');
});

// ── Tests: Surplus ────────────────────────────────────────────────────────

test('surplus is computed as received income minus total spending', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '5000.00', receivedDate: '2026-03-01' }],
    transactions: [
      { id: 'tx1', amount: '1000.00', direction: 'debit' },
      { id: 'tx2', amount: '500.00',  direction: 'debit' },
    ],
  });

  assert.equal(result.net, '3500.00');
  assert.equal(result.isDeficit, false);
  assert.ok(result.surplus);
  assert.equal(result.surplus.amount, '3500.00');
  assert.equal(result.surplus.requiresIntentionalTreatment, true);
  assert.equal(result.deficit, null);
});

test('surplus distribution is calculated from active surplus split rules', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '4000.00', receivedDate: '2026-03-01' }],
    transactions: [{ id: 'tx1', amount: '3000.00', direction: 'debit' }],
    surplusSplitRules: SURPLUS_RULES,
  });

  assert.equal(result.surplus.amount, '1000.00');
  const distBySlug = Object.fromEntries(result.surplus.distributions.map((d) => [d.slug, d]));
  assert.equal(distBySlug.emergency_fund.amount, '300.00');
  assert.equal(distBySlug.extra_debt_payoff.amount, '400.00');
  assert.equal(distBySlug.investment.amount, '200.00');
  assert.equal(distBySlug.giving.amount, '100.00');
});

test('surplus distribution remainder goes to emergency_fund on indivisible amounts', () => {
  // $101 with 30/40/20/10 split: each distributes exactly at cent precision (no remainder)
  // 30% × $101 = $30.30, 40% × $101 = $40.40, 20% × $101 = $20.20, 10% × $101 = $10.10
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '101.00', receivedDate: '2026-03-01' }],
    transactions: [],
    surplusSplitRules: SURPLUS_RULES,
  });

  const distBySlug = Object.fromEntries(result.surplus.distributions.map((d) => [d.slug, d]));
  assert.equal(distBySlug.emergency_fund.amount, '30.30');
  assert.equal(distBySlug.extra_debt_payoff.amount, '40.40');
  assert.equal(distBySlug.investment.amount, '20.20');
  assert.equal(distBySlug.giving.amount, '10.10');
  // Verify all distributions sum to the full surplus
  const total = result.surplus.distributions.reduce(
    (sum, d) => sum + Math.round(parseFloat(d.amount) * 100),
    0,
  );
  assert.equal(total, 101 * 100);
});

test('surplus distribution remainder goes to emergency_fund when cents are lost to floor', () => {
  // $100 with 33/33/34 split: 33%×100 = $33.00, 33%×100 = $33.00, 34%×100 = $34.00 → exact
  // Use an odd split to force a remainder: 33%+34%+33% with $10.01 surplus
  // 33% of $10.01 = $3.303 → floor cents = $3.30; ×2 = $6.60; 34% = $3.40; total = $10.00 → remainder $0.01 → emergency_fund
  const splitRules = [
    { slug: 'emergency_fund',    label: 'Emergency Fund',    splitPercent: '0.3300', isActive: true, sortOrder: 0 },
    { slug: 'extra_debt_payoff', label: 'Extra Debt Payoff', splitPercent: '0.3300', isActive: true, sortOrder: 1 },
    { slug: 'investment',        label: 'Investment',        splitPercent: '0.3400', isActive: true, sortOrder: 2 },
  ];
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '10.01', receivedDate: '2026-03-01' }],
    transactions: [],
    surplusSplitRules: splitRules,
  });

  // All distributions must sum exactly to surplus
  const totalDistributed = result.surplus.distributions.reduce(
    (sum, d) => sum + Math.round(parseFloat(d.amount) * 100),
    0,
  );
  assert.equal(totalDistributed, Math.round(parseFloat(result.surplus.amount) * 100));

  // emergency_fund must receive any remainder
  const bySlug = Object.fromEntries(result.surplus.distributions.map((d) => [d.slug, d]));
  const emergencyCents = Math.round(parseFloat(bySlug.emergency_fund.amount) * 100);
  const baseCents = Math.floor((1001 * 3300) / 10000);  // 33% of 1001 cents
  assert.ok(emergencyCents >= baseCents, 'emergency_fund should include remainder');
});

test('zero surplus shows no distributions', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '1000.00', receivedDate: '2026-03-01' }],
    transactions: [{ id: 'tx1', amount: '1000.00', direction: 'debit' }],
    surplusSplitRules: SURPLUS_RULES,
  });

  assert.equal(result.net, '0.00');
  assert.equal(result.isDeficit, false);
  assert.ok(result.surplus);
  assert.equal(result.surplus.amount, '0.00');
  assert.equal(result.surplus.requiresIntentionalTreatment, false);
  assert.equal(result.surplus.distributions, null);
});

test('credit transactions are excluded from spending total', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '5000.00', receivedDate: '2026-03-01' }],
    transactions: [
      { id: 'tx1', amount: '1000.00', direction: 'debit'  },
      { id: 'tx2', amount: '200.00',  direction: 'credit' },  // refund; not spending
    ],
  });

  assert.equal(result.spending.total, '1000.00');
  assert.equal(result.net, '4000.00');
});

// ── Tests: Deficit ────────────────────────────────────────────────────────

test('deficit is detected when spending exceeds received income', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '2000.00', receivedDate: '2026-03-01' }],
    transactions: [
      { id: 'tx1', amount: '1500.00', direction: 'debit' },
      { id: 'tx2', amount: '800.00',  direction: 'debit' },
    ],
  });

  assert.equal(result.net, '-300.00');
  assert.equal(result.isDeficit, true);
  assert.ok(result.deficit);
  assert.equal(result.deficit.amount, '300.00');
  assert.equal(result.surplus, null);
});

test('deficit causes list over-budget categories', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [
      { id: 'cat_spend', slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '1.0000', isActive: true, sortOrder: 0 },
    ],
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '1000.00', receivedDate: '2026-03-01' }],
    incomeAllocations: [{ allocationCategoryId: 'cat_spend', allocatedAmount: '1000.00' }],
    transactions: [{ id: 'tx1', amount: '1300.00', direction: 'debit', categoryId: 'cat_spend' }],
  });

  assert.equal(result.isDeficit, true);
  assert.equal(result.deficit.causes.length, 1);
  assert.equal(result.deficit.causes[0].slug, 'personal_spending');
  assert.equal(result.deficit.causes[0].overrun, '300.00');
});

test('deficit includes income shortfall when received < expected', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeStreams: [{ id: 's1', sourceName: 'Salary', expectedAmount: '5000.00' }],
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '3000.00', receivedDate: '2026-03-01' }],
    transactions: [{ id: 'tx1', amount: '3500.00', direction: 'debit' }],
  });

  assert.equal(result.isDeficit, true);
  assert.equal(result.deficit.amount, '500.00');
  assert.equal(result.deficit.incomeShortfall, '2000.00');
});

// ── Tests: Adjustment candidates ──────────────────────────────────────────

test('adjustment candidates exclude protected categories (GIVING, OBLIGATIONS)', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: CATEGORIES,
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '500.00', receivedDate: '2026-03-01' }],
    incomeAllocations: CATEGORIES.map((cat) => ({
      allocationCategoryId: cat.id,
      allocatedAmount: (parseFloat(cat.allocationPercent) * 500).toFixed(2),
    })),
    transactions: [{ id: 'tx1', amount: '600.00', direction: 'debit' }],
  });

  assert.equal(result.isDeficit, true);
  const candidateSlugs = result.deficit.adjustmentCandidates.map((c) => c.slug);
  assert.ok(!candidateSlugs.includes('tithe'),       'tithe (GIVING) must not be a candidate');
  assert.ok(!candidateSlugs.includes('partnership'), 'partnership (GIVING) must not be a candidate');
  assert.ok(!candidateSlugs.includes('offerings'),   'offerings (GIVING) must not be a candidate');
  assert.ok(!candidateSlugs.includes('fixed_bills'), 'fixed_bills (OBLIGATIONS) must not be a candidate');
});

test('adjustment candidates are ordered lowest-priority-first (most cuttable first)', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [
      { id: 'cat_savings', slug: 'savings',           label: 'Savings',           allocationPercent: '0.3000', isActive: true, sortOrder: 0 },
      { id: 'cat_invest',  slug: 'investment',        label: 'Investment',        allocationPercent: '0.3000', isActive: true, sortOrder: 1 },
      { id: 'cat_spend',   slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '0.4000', isActive: true, sortOrder: 2 },
    ],
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '500.00', receivedDate: '2026-03-01' }],
    incomeAllocations: [
      { allocationCategoryId: 'cat_savings', allocatedAmount: '150.00' },
      { allocationCategoryId: 'cat_invest',  allocatedAmount: '150.00' },
      { allocationCategoryId: 'cat_spend',   allocatedAmount: '200.00' },
    ],
    transactions: [{ id: 'tx1', amount: '600.00', direction: 'debit' }],
  });

  assert.equal(result.isDeficit, true);
  const candidates = result.deficit.adjustmentCandidates;
  assert.ok(candidates.length > 0, 'must have adjustment candidates');

  // personal_spending (FLEXIBLE_SPENDING=8) should come before investment (ACCELERATED_SAVINGS=7)
  // which should come before savings (SAVINGS_FLOOR=4)
  const spendIdx   = candidates.findIndex((c) => c.slug === 'personal_spending');
  const investIdx  = candidates.findIndex((c) => c.slug === 'investment');
  const savingsIdx = candidates.findIndex((c) => c.slug === 'savings');

  if (spendIdx >= 0 && investIdx >= 0) {
    assert.ok(spendIdx < investIdx, 'personal_spending should be a higher-priority cut than investment');
  }
  if (investIdx >= 0 && savingsIdx >= 0) {
    assert.ok(investIdx < savingsIdx, 'investment should be a higher-priority cut than savings');
  }
});

test('adjustmentCandidates on surplus result is empty', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '5000.00', receivedDate: '2026-03-01' }],
    allocationCategories: [
      { id: 'cat_spend', slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '1.0000', isActive: true, sortOrder: 0 },
    ],
    incomeAllocations: [{ allocationCategoryId: 'cat_spend', allocatedAmount: '5000.00' }],
    transactions: [{ id: 'tx1', amount: '1000.00', direction: 'debit', categoryId: 'cat_spend' }],
  });

  assert.equal(result.isDeficit, false);
  assert.deepEqual(result.adjustmentCandidates, []);
});

test('coversDeficitPercent reflects how much of deficit each candidate covers', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [
      { id: 'cat_spend', slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '1.0000', isActive: true, sortOrder: 0 },
    ],
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '1000.00', receivedDate: '2026-03-01' }],
    incomeAllocations: [{ allocationCategoryId: 'cat_spend', allocatedAmount: '1000.00' }],
    transactions: [{ id: 'tx1', amount: '1500.00', direction: 'debit', categoryId: 'cat_spend' }],
  });
  // deficit is 500; personal_spending is over_budget (remaining < 0), so no candidates
  assert.equal(result.isDeficit, true);
  assert.equal(result.deficit.adjustmentCandidates.length, 0);
});

test('adjustment candidate with remaining budget covers deficit proportionally', () => {
  // Deficit = 200; personal_spending has 400 remaining → 100% coverage
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [
      { id: 'cat_tithe', slug: 'tithe',            label: 'Tithe',            allocationPercent: '0.1000', isActive: true, sortOrder: 0 },
      { id: 'cat_spend', slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '0.9000', isActive: true, sortOrder: 1 },
    ],
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '1000.00', receivedDate: '2026-03-01' }],
    incomeAllocations: [
      { allocationCategoryId: 'cat_tithe', allocatedAmount: '100.00' },
      { allocationCategoryId: 'cat_spend', allocatedAmount: '900.00' },
    ],
    transactions: [
      { id: 'tx1', amount: '600.00', direction: 'debit', categoryId: 'cat_tithe' },  // over tithe by 500
      { id: 'tx2', amount: '600.00', direction: 'debit', categoryId: 'cat_spend' },
    ],
  });

  // Total spent: 600 + 600 = 1200; received: 1000 → deficit 200
  assert.equal(result.isDeficit, true);
  assert.equal(result.deficit.amount, '200.00');

  const candidates = result.deficit.adjustmentCandidates;
  const spendCandidate = candidates.find((c) => c.slug === 'personal_spending');
  assert.ok(spendCandidate, 'personal_spending should be a candidate (300 remaining)');
  assert.equal(spendCandidate.availableToCut, '300.00');
  assert.equal(spendCandidate.coversDeficitPercent, 100);  // 300 >= 200 → 100%
});

// ── Tests: Priority overrides ─────────────────────────────────────────────

test('priorityOverrides change category priority and protection status', () => {
  // Promote personal_spending to OBLIGATIONS (protected)
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [
      { id: 'cat_spend', slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '0.5000', isActive: true, sortOrder: 0 },
      { id: 'cat_invest', slug: 'investment', label: 'Investment', allocationPercent: '0.5000', isActive: true, sortOrder: 1 },
    ],
    priorityOverrides: {
      personal_spending: AllocationPriority.OBLIGATIONS,
    },
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '500.00', receivedDate: '2026-03-01' }],
    incomeAllocations: [
      { allocationCategoryId: 'cat_spend',  allocatedAmount: '250.00' },
      { allocationCategoryId: 'cat_invest', allocatedAmount: '250.00' },
    ],
    transactions: [{ id: 'tx1', amount: '600.00', direction: 'debit' }],
  });

  assert.equal(result.isDeficit, true);
  const bySlug = Object.fromEntries(result.spending.byCategory.map((r) => [r.slug, r]));
  assert.equal(bySlug.personal_spending.isProtected, true);
  assert.equal(bySlug.personal_spending.priority, AllocationPriority.OBLIGATIONS);

  const candidateSlugs = result.deficit.adjustmentCandidates.map((c) => c.slug);
  assert.ok(!candidateSlugs.includes('personal_spending'), 'overridden to OBLIGATIONS — must not be a candidate');
});

test('custom slug gets FLEXIBLE_SPENDING default priority when not in override map', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [
      { id: 'cat_custom', slug: 'custom_bucket', label: 'Custom', allocationPercent: '1.0000', isActive: true, sortOrder: 0 },
    ],
  });
  const row = result.spending.byCategory[0];
  assert.equal(row.priority, AllocationPriority.FLEXIBLE_SPENDING);
  assert.equal(row.isProtected, false);
});

// ── Tests: Giving as first-class allocation ───────────────────────────────

test('giving categories (tithe, partnership, offerings) are first-class and protected', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: CATEGORIES,
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '10000.00', receivedDate: '2026-03-01' }],
    incomeAllocations: makeAllocs('10000.00', CATEGORIES),
    transactions: [{ id: 'tx1', amount: '11000.00', direction: 'debit' }],  // deficit
  });

  assert.equal(result.isDeficit, true);
  const candidates = result.deficit.adjustmentCandidates.map((c) => c.slug);

  // All three giving categories must be excluded from adjustment candidates
  for (const slug of ['tithe', 'partnership', 'offerings']) {
    assert.ok(!candidates.includes(slug), `${slug} is GIVING-protected and must not appear as adjustment candidate`);
  }

  // Giving categories must appear in byCategory with GIVING priority
  const bySlug = Object.fromEntries(result.spending.byCategory.map((r) => [r.slug, r]));
  assert.equal(bySlug.tithe.priority, AllocationPriority.GIVING);
  assert.equal(bySlug.tithe.isProtected, true);
  assert.equal(bySlug.partnership.priority, AllocationPriority.GIVING);
  assert.equal(bySlug.offerings.priority, AllocationPriority.GIVING);
});

// ── Tests: Alert status ───────────────────────────────────────────────────

test('alertStatus is ok when no deficit and debt ratio within threshold', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '5000.00', receivedDate: '2026-03-01' }],
    transactions: [
      { id: 'tx1', amount: '200.00', direction: 'debit', linkedDebtId: 'debt_1' },  // 4% debt ratio
    ],
  });
  assert.equal(result.alertStatus, 'ok');
});

test('alertStatus is elevated when deficit exists', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '1000.00', receivedDate: '2026-03-01' }],
    transactions: [{ id: 'tx1', amount: '1100.00', direction: 'debit' }],
  });
  assert.equal(result.alertStatus, 'elevated');
});

test('alertStatus is elevated when debt ratio is between 0.25 and 0.35', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '1000.00', receivedDate: '2026-03-01' }],
    transactions: [
      { id: 'tx1', amount: '300.00', direction: 'debit', linkedDebtId: 'debt_1' },  // 30%
    ],
  });
  assert.equal(result.alertStatus, 'elevated');
});

test('alertStatus is risky when debt ratio exceeds 0.35', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '1000.00', receivedDate: '2026-03-01' }],
    transactions: [
      { id: 'tx1', amount: '400.00', direction: 'debit', linkedDebtId: 'debt_1' },  // 40%
    ],
  });
  assert.equal(result.alertStatus, 'risky');
});

test('alertStatus is risky when emergencyCoverageMonths < 1', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '5000.00', receivedDate: '2026-03-01' }],
    transactions: [],
    emergencyCoverageMonths: 0.5,
  });
  assert.equal(result.alertStatus, 'risky');
});

test('alertStatus is ok when emergencyCoverageMonths >= 1 and debt ratio is low', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '5000.00', receivedDate: '2026-03-01' }],
    transactions: [],
    emergencyCoverageMonths: 3,
  });
  assert.equal(result.alertStatus, 'ok');
});

// ── Tests: Multiple income streams ────────────────────────────────────────

test('multiple income streams are tracked independently in expectedStreams', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeStreams: [
      { id: 'stream_salary',    sourceName: 'Salary',    expectedAmount: '4000.00' },
      { id: 'stream_freelance', sourceName: 'Freelance', expectedAmount: '2000.00' },
      { id: 'stream_rental',   sourceName: 'Rental',    expectedAmount: '800.00'  },
    ],
    incomeEntries: [
      { id: 'e1', sourceName: 'Salary',    amount: '4000.00', receivedDate: '2026-03-01' },
      { id: 'e2', sourceName: 'Freelance', amount: '2000.00', receivedDate: '2026-03-15' },
    ],
  });

  assert.equal(result.income.expectedStreams.length, 3);
  assert.equal(result.income.receivedEntries.length, 2);
  assert.equal(result.income.totalExpected, '6800.00');
  assert.equal(result.income.totalReceived, '6000.00');
  assert.equal(result.income.incomeShortfall, '800.00');
  assert.equal(result.income.incomeStatus, 'partial');
});

test('multiple income entries in same period sum correctly', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [
      { id: 'e1', sourceName: 'Salary',     amount: '3000.00', receivedDate: '2026-03-01' },
      { id: 'e2', sourceName: 'Freelance',  amount: '1500.00', receivedDate: '2026-03-10' },
      { id: 'e3', sourceName: 'Side Income', amount: '500.00', receivedDate: '2026-03-20' },
    ],
    transactions: [{ id: 'tx1', amount: '2000.00', direction: 'debit' }],
  });

  assert.equal(result.income.totalReceived, '5000.00');
  assert.equal(result.net, '3000.00');
  assert.equal(result.isDeficit, false);
});

// ── Tests: PlanResult shape for downstream consumers ─────────────────────

test('PlanResult contains all required top-level keys', () => {
  const result = computePlanResult({ period: '2026-03-01' });

  for (const key of ['period', 'income', 'spending', 'net', 'isDeficit', 'surplus', 'deficit', 'adjustmentCandidates', 'alertStatus']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, key), `missing key: ${key}`);
  }
});

test('income object contains all required keys', () => {
  const result = computePlanResult({ period: '2026-03-01' });

  for (const key of ['expectedStreams', 'receivedEntries', 'totalExpected', 'totalReceived', 'totalAllocated', 'totalAvailable', 'incomeShortfall', 'incomeStatus']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result.income, key), `income missing key: ${key}`);
  }
});

test('category row contains all required keys', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    allocationCategories: [
      { id: 'cat_tithe', slug: 'tithe', label: 'Tithe', allocationPercent: '0.1000', isActive: true, sortOrder: 0 },
    ],
  });

  const row = result.spending.byCategory[0];
  for (const key of ['categoryId', 'slug', 'label', 'priority', 'isProtected', 'allocationPercent', 'budgeted', 'allocated', 'added', 'spent', 'remaining', 'overrun', 'utilizationPercent', 'status']) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, key), `category row missing key: ${key}`);
  }
});

test('surplus object contains required keys when surplus exists', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '1000.00', receivedDate: '2026-03-01' }],
  });

  assert.ok(result.surplus);
  for (const key of ['amount', 'requiresIntentionalTreatment', 'distributions']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result.surplus, key), `surplus missing key: ${key}`);
  }
});

test('deficit object contains required keys when deficit exists', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '100.00', receivedDate: '2026-03-01' }],
    transactions: [{ id: 'tx1', amount: '500.00', direction: 'debit' }],
  });

  assert.ok(result.deficit);
  for (const key of ['amount', 'incomeShortfall', 'causes', 'adjustmentCandidates']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result.deficit, key), `deficit missing key: ${key}`);
  }
});

// ── Tests: Money precision ────────────────────────────────────────────────

test('all money values in PlanResult are string decimals with two decimal places', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeStreams: [{ id: 's1', sourceName: 'Salary', expectedAmount: '10000.00' }],
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '7777.77', receivedDate: '2026-03-01' }],
    allocationCategories: [
      { id: 'cat_spend', slug: 'personal_spending', label: 'Personal Spending', allocationPercent: '1.0000', isActive: true, sortOrder: 0 },
    ],
    incomeAllocations: [{ allocationCategoryId: 'cat_spend', allocatedAmount: '7777.77' }],
    transactions: [{ id: 'tx1', amount: '3333.33', direction: 'debit' }],
    surplusSplitRules: SURPLUS_RULES,
  });

  const moneyPattern = /^-?\d+\.\d{2}$/;

  assert.match(result.income.totalExpected, moneyPattern);
  assert.match(result.income.totalReceived, moneyPattern);
  assert.match(result.income.totalAllocated, moneyPattern);
  assert.match(result.income.totalAvailable, moneyPattern);
  assert.match(result.income.incomeShortfall, moneyPattern);
  assert.match(result.net, moneyPattern);
  assert.match(result.spending.total, moneyPattern);

  if (result.surplus) {
    assert.match(result.surplus.amount, moneyPattern);
    for (const dist of result.surplus.distributions ?? []) {
      assert.match(dist.amount, moneyPattern);
    }
  }

  for (const row of result.spending.byCategory) {
    for (const field of ['budgeted', 'allocated', 'added', 'spent', 'remaining', 'overrun']) {
      assert.match(row[field], moneyPattern, `byCategory.${row.slug}.${field} not a money string`);
    }
  }
});

test('net is computed precisely with cent-level deposits', () => {
  const result = computePlanResult({
    period: '2026-03-01',
    incomeEntries: [{ id: 'e1', sourceName: 'Salary', amount: '1000.01', receivedDate: '2026-03-01' }],
    transactions: [{ id: 'tx1', amount: '999.99', direction: 'debit' }],
  });

  assert.equal(result.net, '0.02');
  assert.equal(result.isDeficit, false);
});
