import { formatCents, parseMoneyToCents } from './reporting.js';

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  return next;
}

export function estimateDebtPayoff(debt, currentBalance) {
  const currentBalanceCents = parseMoneyToCents(currentBalance ?? debt.currentBalance ?? debt.startingBalance);
  if (currentBalanceCents <= 0) {
    return {
      estimatedPayoffDate: toIsoDate(new Date()),
      monthsRemaining: 0,
      totalInterestRemaining: '0.00',
    };
  }

  const monthlyPaymentCents = Math.max(
    parseMoneyToCents(debt.monthlyPayment ?? '0.00'),
    parseMoneyToCents(debt.minimumPayment ?? '0.00'),
  );
  const monthlyRate = Number(debt.apr ?? 0) / 100 / 12;
  const firstMonthInterestCents = Math.round(currentBalanceCents * monthlyRate);

  if (monthlyPaymentCents <= 0 || monthlyPaymentCents <= firstMonthInterestCents) {
    return {
      estimatedPayoffDate: null,
      monthsRemaining: null,
      totalInterestRemaining: null,
    };
  }

  let remainingBalanceCents = currentBalanceCents;
  let totalInterestCents = 0;
  let monthsRemaining = 0;
  const maxMonths = 1200;

  while (remainingBalanceCents > 0 && monthsRemaining < maxMonths) {
    const interestCents = Math.round(remainingBalanceCents * monthlyRate);
    totalInterestCents += interestCents;
    remainingBalanceCents += interestCents;

    if (monthlyPaymentCents <= interestCents) {
      return {
        estimatedPayoffDate: null,
        monthsRemaining: null,
        totalInterestRemaining: null,
      };
    }

    remainingBalanceCents = Math.max(0, remainingBalanceCents - monthlyPaymentCents);
    monthsRemaining += 1;
  }

  if (remainingBalanceCents > 0) {
    return {
      estimatedPayoffDate: null,
      monthsRemaining: null,
      totalInterestRemaining: null,
    };
  }

  const payoffDate = addMonths(new Date(), monthsRemaining);

  return {
    estimatedPayoffDate: toIsoDate(payoffDate),
    monthsRemaining,
    totalInterestRemaining: formatCents(totalInterestCents),
  };
}

export function compareDebtPriority(left, right) {
  return (Number(right.apr ?? 0) - Number(left.apr ?? 0))
    || (parseMoneyToCents(right.currentBalance ?? right.startingBalance) - parseMoneyToCents(left.currentBalance ?? left.startingBalance))
    || (() => {
      const leftMonths = left.monthsRemaining;
      const rightMonths = right.monthsRemaining;
      if (leftMonths == null && rightMonths == null) {
        return 0;
      }
      if (leftMonths == null) {
        return 1;
      }
      if (rightMonths == null) {
        return -1;
      }
      return leftMonths - rightMonths;
    })()
    || String(left.name ?? '').localeCompare(String(right.name ?? ''));
}

export function deriveDebtSnapshot(debt, payments = [], adjustments = []) {
  const startingBalanceCents = parseMoneyToCents(debt.startingBalance);
  const totalPaidCents = payments.reduce((sum, payment) => sum + parseMoneyToCents(payment.amount), 0);
  const totalAdjustedCents = adjustments.reduce((sum, adjustment) => sum + parseMoneyToCents(adjustment.amount), 0);
  const currentBalanceCents = startingBalanceCents - totalPaidCents + totalAdjustedCents;
  const payoffEstimate = estimateDebtPayoff(debt, formatCents(currentBalanceCents));

  return {
    ...debt,
    currentBalance: formatCents(currentBalanceCents),
    totalPaidAllTime: formatCents(totalPaidCents),
    totalAdjustments: formatCents(totalAdjustedCents),
    status: currentBalanceCents > 0 ? 'current' : 'paid_off',
    estimatedPayoffDate: payoffEstimate.estimatedPayoffDate,
    monthsRemaining: payoffEstimate.monthsRemaining,
    totalInterestRemaining: payoffEstimate.totalInterestRemaining,
  };
}

export function buildDebtListResponse(debts, debtPaymentsByDebtId, debtAdjustmentsByDebtId = new Map()) {
  // Debt ordering is now derived from payoff priority; sortOrder remains response-compatible
  // until bucket-to-debt allocation rules exist as a dedicated routing model.
  const snapshots = debts.map((debt) => deriveDebtSnapshot(
    debt,
    debtPaymentsByDebtId.get(debt.id) ?? [],
    debtAdjustmentsByDebtId.get(debt.id) ?? [],
  )).sort(compareDebtPriority);

  const summary = snapshots.reduce(
    (totals, debt) => ({
      totalStartingCents: totals.totalStartingCents + parseMoneyToCents(debt.startingBalance),
      totalRemainingCents: totals.totalRemainingCents + parseMoneyToCents(debt.currentBalance),
      totalPaidAllTimeCents: totals.totalPaidAllTimeCents + parseMoneyToCents(debt.totalPaidAllTime),
    }),
    {
      totalStartingCents: 0,
      totalRemainingCents: 0,
      totalPaidAllTimeCents: 0,
    },
  );

  return {
    items: snapshots.map((debt) => ({
      id: debt.id,
      name: debt.name,
      startingBalance: debt.startingBalance,
      currentBalance: debt.currentBalance,
      apr: debt.apr,
      minimumPayment: debt.minimumPayment,
      monthlyPayment: debt.monthlyPayment,
      status: debt.status,
      sortOrder: debt.sortOrder,
      isActive: debt.isActive,
      totalAdjustments: debt.totalAdjustments,
      estimatedPayoffDate: debt.estimatedPayoffDate,
      monthsRemaining: debt.monthsRemaining,
      totalInterestRemaining: debt.totalInterestRemaining,
    })),
    summary: {
      totalStarting: formatCents(summary.totalStartingCents),
      totalRemaining: formatCents(summary.totalRemainingCents),
      totalPaidAllTime: formatCents(summary.totalPaidAllTimeCents),
    },
  };
}
