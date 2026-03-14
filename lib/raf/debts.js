import { monthBounds } from '../dates.js';
import { formatCents, parseMoneyToCents } from './reporting.js';

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  return next;
}

function activeMonthBounds(activeMonth) {
  if (typeof activeMonth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(activeMonth)) {
    const [year, month] = activeMonth.split('-').map(Number);
    return monthBounds(year, month);
  }

  const now = new Date();
  return monthBounds(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

function isDateBefore(left, right) {
  return String(left) < String(right);
}

function isDateWithin(date, start, end) {
  return String(date) >= String(start) && String(date) <= String(end);
}

function paymentStatusFromActivity({
  currentBalanceCents,
  expectedPaymentCents,
  minimumPaymentCents,
  actualPaymentCents,
  interestChargedCents,
  feesChargedCents,
}) {
  if (currentBalanceCents <= 0) {
    return 'paid_off';
  }

  if (expectedPaymentCents > 0 && actualPaymentCents === 0) {
    return 'missed_payment';
  }

  if (actualPaymentCents > 0 && actualPaymentCents < minimumPaymentCents) {
    return 'under_minimum';
  }

  if (actualPaymentCents > 0 && actualPaymentCents <= interestChargedCents + feesChargedCents) {
    return 'at_risk';
  }

  if (actualPaymentCents > 0 && actualPaymentCents > interestChargedCents + feesChargedCents) {
    return 'paying_down';
  }

  return 'current';
}

export function deriveDebtMonthlyActivity(debt, payments = [], adjustments = [], activeMonth) {
  const { start, end } = activeMonthBounds(activeMonth);
  const minimumPaymentCents = parseMoneyToCents(debt.minimumPayment ?? '0.00');
  const plannedMonthlyPaymentCents = parseMoneyToCents(debt.monthlyPayment ?? '0.00');
  const expectedPaymentCents = Math.max(plannedMonthlyPaymentCents, minimumPaymentCents);

  const paymentsBeforeMonthCents = payments.reduce((sum, payment) => (
    isDateBefore(payment.paymentDate, start)
      ? sum + parseMoneyToCents(payment.amount)
      : sum
  ), 0);
  const adjustmentsBeforeMonthCents = adjustments.reduce((sum, adjustment) => (
    isDateBefore(adjustment.effectiveDate, start)
      ? sum + parseMoneyToCents(adjustment.amount)
      : sum
  ), 0);

  const openingBalanceCents = Math.max(
    0,
    parseMoneyToCents(debt.startingBalance) - paymentsBeforeMonthCents + adjustmentsBeforeMonthCents,
  );

  const paymentsThisMonthCents = payments.reduce((sum, payment) => (
    isDateWithin(payment.paymentDate, start, end)
      ? sum + parseMoneyToCents(payment.amount)
      : sum
  ), 0);

  const interestChargedThisMonthCents = adjustments.reduce((sum, adjustment) => (
    adjustment.adjustmentType === 'interest' && isDateWithin(adjustment.effectiveDate, start, end)
      ? sum + parseMoneyToCents(adjustment.amount)
      : sum
  ), 0);

  const feesThisMonthCents = adjustments.reduce((sum, adjustment) => (
    adjustment.adjustmentType === 'fee' && isDateWithin(adjustment.effectiveDate, start, end)
      ? sum + parseMoneyToCents(adjustment.amount)
      : sum
  ), 0);

  const principalReductionThisMonthCents = Math.max(
    0,
    paymentsThisMonthCents - interestChargedThisMonthCents - feesThisMonthCents,
  );

  const currentBalanceCents = Math.max(
    0,
    parseMoneyToCents(debt.startingBalance)
      - payments.reduce((sum, payment) => sum + parseMoneyToCents(payment.amount), 0)
      + adjustments.reduce((sum, adjustment) => sum + parseMoneyToCents(adjustment.amount), 0),
  );

  return {
    openingBalance: formatCents(openingBalanceCents),
    interestChargedThisMonth: formatCents(interestChargedThisMonthCents),
    feesThisMonth: formatCents(feesThisMonthCents),
    paymentsThisMonth: formatCents(paymentsThisMonthCents),
    principalReductionThisMonth: formatCents(principalReductionThisMonthCents),
    paymentStatus: paymentStatusFromActivity({
      currentBalanceCents,
      expectedPaymentCents,
      minimumPaymentCents,
      actualPaymentCents: paymentsThisMonthCents,
      interestChargedCents: interestChargedThisMonthCents,
      feesChargedCents: feesThisMonthCents,
    }),
  };
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

export function deriveDebtSnapshot(debt, payments = [], adjustments = [], activeMonth) {
  const startingBalanceCents = parseMoneyToCents(debt.startingBalance);
  const totalPaidCents = payments.reduce((sum, payment) => sum + parseMoneyToCents(payment.amount), 0);
  const totalAdjustedCents = adjustments.reduce((sum, adjustment) => sum + parseMoneyToCents(adjustment.amount), 0);
  const currentBalanceCents = Math.max(0, startingBalanceCents - totalPaidCents + totalAdjustedCents);
  const payoffEstimate = estimateDebtPayoff(debt, formatCents(currentBalanceCents));
  const monthlyActivity = deriveDebtMonthlyActivity(debt, payments, adjustments, activeMonth);

  return {
    ...debt,
    currentBalance: formatCents(currentBalanceCents),
    totalPaidAllTime: formatCents(totalPaidCents),
    totalAdjustments: formatCents(totalAdjustedCents),
    status: currentBalanceCents > 0 ? 'current' : 'paid_off',
    openingBalance: monthlyActivity.openingBalance,
    interestChargedThisMonth: monthlyActivity.interestChargedThisMonth,
    feesThisMonth: monthlyActivity.feesThisMonth,
    paymentsThisMonth: monthlyActivity.paymentsThisMonth,
    principalReductionThisMonth: monthlyActivity.principalReductionThisMonth,
    paymentStatus: monthlyActivity.paymentStatus,
    estimatedPayoffDate: payoffEstimate.estimatedPayoffDate,
    monthsRemaining: payoffEstimate.monthsRemaining,
    totalInterestRemaining: payoffEstimate.totalInterestRemaining,
  };
}

export function buildDebtListResponse(debts, debtPaymentsByDebtId, debtAdjustmentsByDebtId = new Map(), activeMonth) {
  // Debt ordering is now derived from payoff priority; sortOrder remains response-compatible
  // until bucket-to-debt allocation rules exist as a dedicated routing model.
  const snapshots = debts.map((debt) => deriveDebtSnapshot(
    debt,
    debtPaymentsByDebtId.get(debt.id) ?? [],
    debtAdjustmentsByDebtId.get(debt.id) ?? [],
    activeMonth,
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
      openingBalance: debt.openingBalance,
      paymentsThisMonth: debt.paymentsThisMonth,
      interestChargedThisMonth: debt.interestChargedThisMonth,
      feesThisMonth: debt.feesThisMonth,
      principalReductionThisMonth: debt.principalReductionThisMonth,
      paymentStatus: debt.paymentStatus,
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
