import { deriveDebtSnapshot } from '../raf/debts.js';
import { enumerateMonths, formatCents, nextMonth, parseFractionToBps, parseMoneyToCents } from '../raf/reporting.js';

const FRACTION_SCALE = 10000;

function monthKey(value) {
  return String(value).slice(0, 7) + '-01';
}

function trailingMonths(activeMonth, count = 3) {
  const months = [];
  let cursor = activeMonth;
  for (let index = 0; index < count; index += 1) {
    months.unshift(cursor);
    const date = new Date(`${cursor}T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() - 1);
    cursor = date.toISOString().slice(0, 10);
  }
  return months;
}

function averageCentsByMonth(rows, months, dateAccessor, amountAccessor) {
  if (months.length === 0) {
    return 0;
  }

  const totals = new Map(months.map((month) => [month, 0]));
  for (const row of rows) {
    const key = monthKey(dateAccessor(row));
    if (totals.has(key)) {
      totals.set(key, totals.get(key) + parseMoneyToCents(amountAccessor(row)));
    }
  }

  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return Math.round(total / months.length);
}

function activeAllocationPercents(categories) {
  return [...categories]
    .filter((category) => category.isActive !== false)
    .sort((left, right) =>
      (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
      || String(left.slug ?? '').localeCompare(String(right.slug ?? ''))
      || String(left.id ?? '').localeCompare(String(right.id ?? '')))
    .map((category) => ({
      slug: category.slug,
      allocationBps: parseFractionToBps(category.allocationPercent ?? 0),
    }));
}

function projectSavingsGrowth({ projectedIncomeCents, categories }) {
  const savingsCategory = activeAllocationPercents(categories).find((category) => category.slug === 'savings');
  const savingsBps = savingsCategory?.allocationBps ?? 0;
  return Math.floor((projectedIncomeCents * savingsBps) / FRACTION_SCALE);
}

function currentSavingsBalance(incomeAllocations) {
  return incomeAllocations
    .filter((allocation) => allocation.slug === 'savings')
    .reduce((sum, allocation) => sum + parseMoneyToCents(allocation.allocatedAmount ?? allocation.amount), 0);
}

function currentEmergencyFundBalance(monthlyReviews) {
  return monthlyReviews.reduce((sum, review) => {
    const amount = review.distributions?.emergency_fund ?? '0.00';
    return sum + parseMoneyToCents(amount);
  }, 0);
}

function projectedEmergencyContribution(netSurplusCents, surplusSplitRules) {
  if (netSurplusCents <= 0) {
    return 0;
  }

  const activeRules = [...surplusSplitRules]
    .filter((rule) => rule.isActive !== false)
    .sort((left, right) =>
      (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
      || String(left.slug ?? '').localeCompare(String(right.slug ?? ''))
      || String(left.id ?? '').localeCompare(String(right.id ?? '')));

  let assigned = 0;
  let emergencyFundCents = 0;
  for (const rule of activeRules) {
    const cents = Math.floor((netSurplusCents * parseFractionToBps(rule.splitPercent ?? 0)) / FRACTION_SCALE);
    assigned += cents;
    if (rule.slug === 'emergency_fund') {
      emergencyFundCents += cents;
    }
  }

  return emergencyFundCents + (netSurplusCents - assigned);
}

function debtPaymentHistoryByDebt(debtPayments) {
  const byDebt = new Map();
  for (const payment of debtPayments) {
    const existing = byDebt.get(payment.debtId) ?? [];
    existing.push(payment);
    byDebt.set(payment.debtId, existing);
  }
  return byDebt;
}

function debtCurrentBalances(debts, paymentsByDebt) {
  return new Map(
    debts.map((debt) => {
      const snapshot = deriveDebtSnapshot(debt, paymentsByDebt.get(debt.id) ?? []);
      return [debt.id, parseMoneyToCents(snapshot.currentBalance)];
    }),
  );
}

function debtPayoffProjection(months, debts, balances) {
  return debts.map((debt) => {
    const timeline = [];
    let payoffMonth = null;
    let currentBalance = balances.get(debt.id) ?? parseMoneyToCents(debt.startingBalance);
    const monthlyPaymentCents = Math.max(parseMoneyToCents(debt.monthlyPayment ?? '0.00'), 0);
    const minimumPaymentCents = Math.max(parseMoneyToCents(debt.minimumPayment ?? '0.00'), 0);
    const appliedPaymentCents = Math.max(monthlyPaymentCents, minimumPaymentCents);

    for (const month of months) {
      currentBalance = Math.max(0, currentBalance - appliedPaymentCents);
      timeline.push({
        month,
        projectedBalance: formatCents(currentBalance),
      });

      if (payoffMonth == null && currentBalance === 0) {
        payoffMonth = month;
      }
    }

    return {
      debtId: debt.id,
      debtName: debt.name,
      payoffMonth,
      timeline,
    };
  });
}

function savingsGrowthProjection(months, startingSavingsCents, monthlySavingsContributionCents) {
  let runningBalance = startingSavingsCents;
  return months.map((month) => {
    runningBalance += monthlySavingsContributionCents;
    return {
      month,
      projectedSavingsBalance: formatCents(runningBalance),
    };
  });
}

function emergencyFundCoverageProjection(months, startingEmergencyFundCents, monthlyEmergencyContributionCents, monthlyEssentialsCents) {
  let runningBalance = startingEmergencyFundCents;
  return months.map((month) => {
    runningBalance += monthlyEmergencyContributionCents;
    return {
      month,
      emergencyFundBalance: formatCents(runningBalance),
      coverageMonths: monthlyEssentialsCents === 0 ? null : Number((runningBalance / monthlyEssentialsCents).toFixed(2)),
    };
  });
}

export function buildTrajectoryProjections({
  activeMonth,
  months,
  household,
  debts,
  debtPayments,
  incomeEntries,
  transactions,
  incomeAllocations,
  allocationCategories,
  monthlyReviews,
  surplusSplitRules,
}) {
  const projectionMonths = enumerateMonths(activeMonth, monthOffset(activeMonth, months - 1));
  const historicalMonths = trailingMonths(activeMonth, 3);
  const projectedIncomeCents = averageCentsByMonth(incomeEntries, historicalMonths, (row) => row.receivedDate, (row) => row.amount);
  const projectedSpendingCents = averageCentsByMonth(
    transactions.filter((row) => row.direction === 'debit'),
    historicalMonths,
    (row) => row.transactionDate,
    (row) => row.amount,
  );
  const projectedSurplusCents = projectedIncomeCents - projectedSpendingCents;
  const monthlySavingsContributionCents = projectSavingsGrowth({
    projectedIncomeCents,
    categories: allocationCategories,
  });
  const monthlyEmergencyContributionCents = projectedEmergencyContribution(projectedSurplusCents, surplusSplitRules);
  const paymentsByDebt = debtPaymentHistoryByDebt(debtPayments);
  const currentBalances = debtCurrentBalances(debts, paymentsByDebt);
  const startingSavingsCents = currentSavingsBalance(incomeAllocations);
  const startingEmergencyFundCents = currentEmergencyFundBalance(monthlyReviews);
  const monthlyEssentialsCents = parseMoneyToCents(household.monthlyEssentialsBaseline ?? household.monthly_essentials_baseline ?? '0.00');

  return {
    debtPayoffProjection: debtPayoffProjection(projectionMonths, debts, currentBalances),
    savingsGrowthProjection: savingsGrowthProjection(
      projectionMonths,
      startingSavingsCents,
      monthlySavingsContributionCents,
    ),
    emergencyFundCoverageProjection: emergencyFundCoverageProjection(
      projectionMonths,
      startingEmergencyFundCents,
      monthlyEmergencyContributionCents,
      monthlyEssentialsCents,
    ),
    assumptions: {
      projectedMonthlyIncome: formatCents(projectedIncomeCents),
      projectedMonthlySpending: formatCents(projectedSpendingCents),
      projectedMonthlySurplus: formatCents(projectedSurplusCents),
      projectedMonthlySavingsContribution: formatCents(monthlySavingsContributionCents),
    },
  };
}

function monthOffset(month, offset) {
  let cursor = month;
  for (let index = 0; index < offset; index += 1) {
    cursor = nextMonth(cursor);
  }
  return cursor;
}
