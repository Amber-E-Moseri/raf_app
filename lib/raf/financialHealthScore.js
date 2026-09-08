import { deriveDebtSnapshot } from './debts.js';
import { formatCents, parseMoneyToCents } from './reporting.js';

/**
 * @typedef {Object} FinancialHealthScoreInput
 * @property {string} reviewMonth
 * @property {Array<{amount: string}>} [incomeEntries]
 * @property {Array<{allocationCategoryId?: string, categoryId?: string, allocatedAmount?: string, amount?: string}>} [incomeAllocations]
 * @property {Array<{direction: 'debit'|'credit', amount: string, categoryId?: string, linkedGoalId?: string|null}>} [transactions]
 * @property {Array<{id: string, slug?: string, isActive?: boolean}>} [allocationCategories]
 * @property {Array<Object>} [debts]
 * @property {Array<{debtId: string, amount: string}>} [debtPayments]
 * @property {Array<{debtId: string, amount: string, adjustmentType: string, effectiveDate: string}>} [debtAdjustments]
 * @property {string} [savingsBalance]
 * @property {string} [monthlyEssentials]
 */

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function percentLabel(ratio) {
  return `${(ratio * 100).toFixed(1)}%`;
}

function buildCategoryUsageSnapshot({ allocationCategories = [], incomeAllocations = [], transactions = [] }) {
  const activeCategories = allocationCategories.filter((category) => category.isActive !== false);
  const categoriesById = new Map(activeCategories.map((category) => [category.id, category]));
  const allocatedByBucketId = new Map(activeCategories.map((category) => [category.id, 0]));
  const addedByBucketId = new Map(activeCategories.map((category) => [category.id, 0]));
  const spentByBucketId = new Map(activeCategories.map((category) => [category.id, 0]));
  const goalsByBucketId = new Map(activeCategories.map((category) => [category.id, 0]));

  for (const allocation of incomeAllocations) {
    const bucketId = allocation.allocationCategoryId ?? allocation.categoryId ?? null;
    if (!bucketId || !categoriesById.has(bucketId)) {
      continue;
    }

    allocatedByBucketId.set(bucketId, allocatedByBucketId.get(bucketId) + parseMoneyToCents(allocation.allocatedAmount ?? allocation.amount ?? '0.00'));
  }

  for (const transaction of transactions) {
    const bucketId = transaction.categoryId ?? null;
    if (!bucketId || !categoriesById.has(bucketId)) {
      continue;
    }

    const amountCents = Math.abs(parseMoneyToCents(transaction.amount ?? '0.00'));
    if (transaction.direction === 'credit') {
      addedByBucketId.set(bucketId, addedByBucketId.get(bucketId) + amountCents);
      continue;
    }

    if (transaction.linkedGoalId) {
      goalsByBucketId.set(bucketId, goalsByBucketId.get(bucketId) + amountCents);
      continue;
    }

    spentByBucketId.set(bucketId, spentByBucketId.get(bucketId) + amountCents);
  }

  const rows = activeCategories.map((category) => {
    const allocatedCents = allocatedByBucketId.get(category.id) ?? 0;
    const addedCents = addedByBucketId.get(category.id) ?? 0;
    const spentCents = spentByBucketId.get(category.id) ?? 0;
    const goalCents = goalsByBucketId.get(category.id) ?? 0;
    const overageCents = Math.max((spentCents + goalCents) - (allocatedCents + addedCents), 0);

    return {
      bucketId: category.id,
      allocatedCents,
      addedCents,
      spentCents,
      goalCents,
      overageCents,
      overused: overageCents > 0,
    };
  });

  return {
    totalCategories: rows.length,
    overusedCount: rows.filter((row) => row.overused).length,
    totalAllocatedCents: rows.reduce((sum, row) => sum + row.allocatedCents + row.addedCents, 0),
    totalOverageCents: rows.reduce((sum, row) => sum + row.overageCents, 0),
  };
}

function buildDebtSnapshot({ debts = [], debtPayments = [], debtAdjustments = [], reviewMonth }) {
  const paymentsByDebtId = new Map();
  const adjustmentsByDebtId = new Map();

  for (const payment of debtPayments) {
    const current = paymentsByDebtId.get(payment.debtId) ?? [];
    current.push(payment);
    paymentsByDebtId.set(payment.debtId, current);
  }

  for (const adjustment of debtAdjustments) {
    const current = adjustmentsByDebtId.get(adjustment.debtId) ?? [];
    current.push(adjustment);
    adjustmentsByDebtId.set(adjustment.debtId, current);
  }

  const snapshots = debts
    .filter((debt) => debt.isActive !== false)
    .map((debt) => deriveDebtSnapshot(
      debt,
      paymentsByDebtId.get(debt.id) ?? [],
      adjustmentsByDebtId.get(debt.id) ?? [],
      reviewMonth,
    ));

  const openingDebtCents = snapshots.reduce((sum, debt) => sum + parseMoneyToCents(debt.openingBalance ?? '0.00'), 0);
  const closingDebtCents = snapshots.reduce((sum, debt) => sum + parseMoneyToCents(debt.closingBalance ?? debt.currentBalance ?? '0.00'), 0);
  const minimumDebtPaymentCents = snapshots.reduce((sum, debt) => {
    const relevantBalance = Math.max(parseMoneyToCents(debt.openingBalance ?? '0.00'), parseMoneyToCents(debt.closingBalance ?? debt.currentBalance ?? '0.00'));
    if (relevantBalance <= 0) {
      return sum;
    }

    return sum + parseMoneyToCents(debt.minimumPayment ?? '0.00');
  }, 0);

  return {
    openingDebtCents,
    closingDebtCents,
    minimumDebtPaymentCents,
  };
}

export function computeFinancialHealthScoreSnapshot({
  reviewMonth,
  incomeEntries = [],
  incomeAllocations = [],
  transactions = [],
  allocationCategories = [],
  debts = [],
  debtPayments = [],
  debtAdjustments = [],
  savingsBalance = '0.00',
  monthlyEssentials = '0.00',
}) {
  const incomeCents = incomeEntries.reduce((sum, entry) => sum + parseMoneyToCents(entry.amount ?? '0.00'), 0);
  const spendingCents = transactions.reduce((sum, transaction) => {
    if (transaction.direction !== 'debit') {
      return sum;
    }

    return sum + Math.abs(parseMoneyToCents(transaction.amount ?? '0.00'));
  }, 0);
  const surplusCents = incomeCents - spendingCents;
  const categoryUsage = buildCategoryUsageSnapshot({
    allocationCategories,
    incomeAllocations,
    transactions,
  });
  const debtSnapshot = buildDebtSnapshot({
    debts,
    debtPayments,
    debtAdjustments,
    reviewMonth,
  });

  const overspendingRatio = categoryUsage.totalAllocatedCents <= 0
    ? 0
    : categoryUsage.totalOverageCents / categoryUsage.totalAllocatedCents;
  const surplusRatio = incomeCents <= 0 ? 0 : surplusCents / incomeCents;
  const minimumDebtRatio = incomeCents <= 0 ? 0 : debtSnapshot.minimumDebtPaymentCents / incomeCents;
  const debtDeltaCents = debtSnapshot.openingDebtCents - debtSnapshot.closingDebtCents;
  const savingsCoverageMonths = parseMoneyToCents(monthlyEssentials) > 0
    ? parseMoneyToCents(savingsBalance) / parseMoneyToCents(monthlyEssentials)
    : null;

  const budgetDisciplineScore = clampScore((1 - Math.min(overspendingRatio, 1)) * 100);
  const surplusGenerationScore = clampScore((Math.max(surplusRatio, 0) / 0.2) * 100);
  const debtRatioScore = clampScore((1 - Math.min(minimumDebtRatio / 0.4, 1)) * 100);
  const debtReductionScore = debtSnapshot.openingDebtCents <= 0
    ? 100
    : debtDeltaCents > 0
      ? 100
      : debtDeltaCents === 0
        ? 50
        : 0;
  const savingsCoverageScore = savingsCoverageMonths == null
    ? 0
    : clampScore((Math.min(savingsCoverageMonths, 6) / 6) * 100);
  const spendingStabilityScore = categoryUsage.totalCategories === 0
    ? 100
    : clampScore((1 - (categoryUsage.overusedCount / categoryUsage.totalCategories)) * 100);

  const healthPillars = [
    {
      key: 'budget_discipline',
      label: 'Budget Discipline',
      score: budgetDisciplineScore,
      value: `Overspending ratio ${percentLabel(overspendingRatio)}`,
    },
    {
      key: 'surplus_generation',
      label: 'Surplus Generation',
      score: surplusGenerationScore,
      value: `Surplus to income ${percentLabel(Math.max(surplusRatio, 0))}`,
    },
    {
      key: 'debt_ratio',
      label: 'Debt Ratio',
      score: debtRatioScore,
      value: `Minimum debt load ${percentLabel(minimumDebtRatio)}`,
    },
    {
      key: 'debt_reduction',
      label: 'Debt Reduction',
      score: debtReductionScore,
      value: debtSnapshot.openingDebtCents <= 0
        ? 'No active debt this month'
        : debtDeltaCents >= 0
          ? `Debt reduced by ${formatCents(debtDeltaCents)}`
          : `Debt increased by ${formatCents(Math.abs(debtDeltaCents))}`,
    },
    {
      key: 'savings_coverage',
      label: 'Savings Coverage',
      score: savingsCoverageScore,
      value: savingsCoverageMonths == null
        ? 'Coverage baseline not set'
        : `${savingsCoverageMonths.toFixed(1)} months covered`,
    },
    {
      key: 'spending_stability',
      label: 'Spending Stability',
      score: spendingStabilityScore,
      value: `${categoryUsage.overusedCount} of ${categoryUsage.totalCategories} categories overused`,
    },
  ];

  const totalScore = clampScore(
    healthPillars.reduce((sum, pillar) => sum + pillar.score, 0) / healthPillars.length,
  );

  return {
    healthScore: totalScore,
    healthPillars,
  };
}
