import { monthBounds } from '../dates.js';
import { formatCents, parseMoneyToCents } from './reporting.js';

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(date) {
  return new Date(`${date}T00:00:00.000Z`);
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthStartOf(date) {
  return `${date.slice(0, 7)}-01`;
}

function activeMonthBounds(activeMonth) {
  if (typeof activeMonth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(activeMonth)) {
    const [year, month] = activeMonth.split('-').map(Number);
    return monthBounds(year, month);
  }

  const now = new Date();
  return monthBounds(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

function shiftMonth(monthStart, offset) {
  return toIsoDate(addMonths(parseIsoDate(monthStart), offset));
}

function isDateBefore(left, right) {
  return String(left) < String(right);
}

function isDateWithin(date, start, end) {
  return String(date) >= String(start) && String(date) <= String(end);
}

function cycleDateForMonth(monthStart, dayOfMonth) {
  const anchor = parseIsoDate(monthStart);
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
  return toIsoDate(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), Math.min(dayOfMonth, lastDay))));
}

function adjustmentAmountOnDate(adjustments, adjustmentType, effectiveDate) {
  return adjustments.some((adjustment) =>
    adjustment.adjustmentType === adjustmentType
    && adjustment.effectiveDate === effectiveDate
    && adjustment.generated !== true);
}

function feeAdjustmentType(adjustmentType) {
  return adjustmentType === 'late_fee' || adjustmentType === 'fee';
}

function computeNextCycleDate(dayOfMonth, activeMonth, now = new Date()) {
  if (!dayOfMonth) {
    return null;
  }

  const { start } = activeMonthBounds(activeMonth);
  const referenceMonth = monthStartOf(toIsoDate(now));
  const baseMonth = start > referenceMonth ? start : referenceMonth;
  const thisCycleDate = cycleDateForMonth(baseMonth, dayOfMonth);
  return thisCycleDate >= toIsoDate(now) ? thisCycleDate : cycleDateForMonth(shiftMonth(baseMonth, 1), dayOfMonth);
}

function currentAsOfDate(activeMonth, now = new Date()) {
  const bounds = activeMonthBounds(activeMonth);
  const today = toIsoDate(now);
  const currentMonthStart = monthStartOf(today);
  return monthStartOf(bounds.start) === currentMonthStart
    ? (today < bounds.end ? today : bounds.end)
    : bounds.end;
}

function normalizePayments(payments = []) {
  return [...payments].sort((left, right) => String(left.paymentDate).localeCompare(String(right.paymentDate)));
}

function normalizeAdjustments(adjustments = []) {
  return [...adjustments].sort((left, right) =>
    String(left.effectiveDate).localeCompare(String(right.effectiveDate))
    || String(left.id ?? '').localeCompare(String(right.id ?? '')));
}

function buildGeneratedAdjustments(debt, payments = [], manualAdjustments = [], activeMonth, asOfDate) {
  const statementDay = debt.statementDay ?? null;
  const paymentDueDay = debt.paymentDueDay ?? null;
  const shouldPostInterest = debt.autoPostInterest === true && statementDay != null;
  const shouldPostLateFee = debt.autoPostLateFee === true && statementDay != null && paymentDueDay != null;

  if (!shouldPostInterest && !shouldPostLateFee) {
    return [];
  }

  const activeBounds = activeMonthBounds(activeMonth);
  const startMonth = debt.createdAt ? monthStartOf(debt.createdAt.slice(0, 10)) : activeBounds.start;
  const endMonth = monthStartOf(asOfDate ?? activeBounds.end);
  const monthlyRate = Number(debt.apr ?? 0) / 100 / 12;
  const minimumPaymentCents = parseMoneyToCents(debt.minimumPayment ?? '0.00');
  const lateFeeCents = parseMoneyToCents(debt.lateFeeAmount ?? '0.00');
  const sortedPayments = normalizePayments(payments);
  const sortedManualAdjustments = normalizeAdjustments(manualAdjustments);

  let cursor = startMonth;
  let runningBalanceCents = parseMoneyToCents(debt.startingBalance);
  const generated = [];

  while (cursor <= endMonth) {
    const { start, end } = activeMonthBounds(cursor);
    const monthPayments = sortedPayments.filter((payment) => isDateWithin(payment.paymentDate, start, end));
    const monthManualAdjustments = sortedManualAdjustments.filter((adjustment) => isDateWithin(adjustment.effectiveDate, start, end));

    if (shouldPostInterest) {
      const statementDate = cycleDateForMonth(cursor, statementDay);
      if (statementDate <= (asOfDate ?? activeBounds.end) && !adjustmentAmountOnDate(monthManualAdjustments, 'interest', statementDate)) {
        const interestCents = Math.round(runningBalanceCents * monthlyRate);
        if (interestCents > 0) {
          generated.push({
            id: `auto_interest_${debt.id}_${statementDate}`,
            debtId: debt.id,
            householdId: debt.householdId,
            amount: formatCents(interestCents),
            adjustmentType: 'interest',
            effectiveDate: statementDate,
            note: 'Auto-posted interest',
            createdAt: `${statementDate}T00:00:00.000Z`,
            generated: true,
          });
          runningBalanceCents += interestCents;
        }
      }
    }

    const paymentsThisCycleCents = monthPayments.reduce((sum, payment) => sum + parseMoneyToCents(payment.amount), 0);

    if (shouldPostLateFee) {
      const dueDate = cycleDateForMonth(cursor, paymentDueDay);
      if (dueDate <= (asOfDate ?? activeBounds.end) && paymentsThisCycleCents < minimumPaymentCents && lateFeeCents > 0) {
        if (!adjustmentAmountOnDate(monthManualAdjustments, 'late_fee', dueDate) && !adjustmentAmountOnDate(monthManualAdjustments, 'fee', dueDate)) {
          generated.push({
            id: `auto_late_fee_${debt.id}_${dueDate}`,
            debtId: debt.id,
            householdId: debt.householdId,
            amount: formatCents(lateFeeCents),
            adjustmentType: 'late_fee',
            effectiveDate: dueDate,
            note: 'Auto-posted late fee',
            createdAt: `${dueDate}T00:00:00.000Z`,
            generated: true,
          });
        }
      }
    }

    const totalMonthAdjustmentCents = [...monthManualAdjustments, ...generated.filter((adjustment) => isDateWithin(adjustment.effectiveDate, start, end))].reduce(
      (sum, adjustment) => sum + parseMoneyToCents(adjustment.amount),
      0,
    );
    runningBalanceCents = Math.max(0, runningBalanceCents + totalMonthAdjustmentCents - paymentsThisCycleCents);
    cursor = shiftMonth(cursor, 1);
  }

  return normalizeAdjustments(generated);
}

function paymentStatusFromActivity({
  closingBalanceCents,
  dueDate,
  minimumPaymentCents,
  actualPaymentCents,
  interestChargedCents,
  asOfDate,
}) {
  if (closingBalanceCents <= 0) {
    return 'paid_off';
  }

  const paymentDue = Boolean(dueDate) && String(asOfDate) >= String(dueDate);

  if (paymentDue && minimumPaymentCents > 0 && actualPaymentCents === 0) {
    return 'missed_payment';
  }

  if (paymentDue && actualPaymentCents > 0 && actualPaymentCents < minimumPaymentCents) {
    return 'under_minimum';
  }

  if (actualPaymentCents > 0 && actualPaymentCents <= interestChargedCents) {
    return 'at_risk';
  }

  if (actualPaymentCents > interestChargedCents) {
    return 'paying_down';
  }

  return 'current';
}

export function deriveDebtMonthlyActivity(debt, payments = [], adjustments = [], activeMonth) {
  const asOfDate = currentAsOfDate(activeMonth);
  const generatedAdjustments = buildGeneratedAdjustments(debt, payments, adjustments, activeMonth, asOfDate);
  const mergedAdjustments = normalizeAdjustments([...adjustments, ...generatedAdjustments]);
  const { start, end } = activeMonthBounds(activeMonth);
  const minimumPaymentCents = parseMoneyToCents(debt.minimumPayment ?? '0.00');
  const dueDate = debt.paymentDueDay ? cycleDateForMonth(monthStartOf(asOfDate), debt.paymentDueDay) : null;

  const paymentsBeforeMonthCents = payments.reduce((sum, payment) => (
    isDateBefore(payment.paymentDate, start) ? sum + parseMoneyToCents(payment.amount) : sum
  ), 0);
  const adjustmentsBeforeMonthCents = mergedAdjustments.reduce((sum, adjustment) => (
    isDateBefore(adjustment.effectiveDate, start) ? sum + parseMoneyToCents(adjustment.amount) : sum
  ), 0);
  const openingBalanceCents = Math.max(
    0,
    parseMoneyToCents(debt.startingBalance) - paymentsBeforeMonthCents + adjustmentsBeforeMonthCents,
  );

  const paymentsThisMonthCents = payments.reduce((sum, payment) => (
    isDateWithin(payment.paymentDate, start, asOfDate) ? sum + parseMoneyToCents(payment.amount) : sum
  ), 0);
  const interestChargedThisMonthCents = mergedAdjustments.reduce((sum, adjustment) => (
    adjustment.adjustmentType === 'interest' && isDateWithin(adjustment.effectiveDate, start, asOfDate)
      ? sum + parseMoneyToCents(adjustment.amount)
      : sum
  ), 0);
  const feesThisMonthCents = mergedAdjustments.reduce((sum, adjustment) => (
    feeAdjustmentType(adjustment.adjustmentType) && isDateWithin(adjustment.effectiveDate, start, asOfDate)
      ? sum + parseMoneyToCents(adjustment.amount)
      : sum
  ), 0);

  const closingBalanceCents = Math.max(
    0,
    openingBalanceCents + interestChargedThisMonthCents + feesThisMonthCents - paymentsThisMonthCents,
  );

  return {
    openingBalance: formatCents(openingBalanceCents),
    interestChargedThisMonth: formatCents(interestChargedThisMonthCents),
    feesThisMonth: formatCents(feesThisMonthCents),
    paymentsThisMonth: formatCents(paymentsThisMonthCents),
    principalReductionThisMonth: formatCents(Math.max(0, paymentsThisMonthCents - interestChargedThisMonthCents - feesThisMonthCents)),
    closingBalance: formatCents(closingBalanceCents),
    paymentStatus: paymentStatusFromActivity({
    closingBalanceCents,
      dueDate,
      minimumPaymentCents,
      actualPaymentCents: paymentsThisMonthCents,
      interestChargedCents: interestChargedThisMonthCents,
      asOfDate,
    }),
    nextStatementDate: computeNextCycleDate(debt.statementDay ?? null, activeMonth),
    nextPaymentDueDate: computeNextCycleDate(debt.paymentDueDay ?? null, activeMonth),
    generatedAdjustments,
    asOfDate,
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

  return {
    estimatedPayoffDate: toIsoDate(addMonths(new Date(), monthsRemaining)),
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
  const monthlyActivity = deriveDebtMonthlyActivity(debt, payments, adjustments, activeMonth);
  const mergedAdjustments = normalizeAdjustments([...adjustments, ...monthlyActivity.generatedAdjustments])
    .filter((adjustment) => String(adjustment.effectiveDate) <= String(monthlyActivity.asOfDate));
  const startingBalanceCents = parseMoneyToCents(debt.startingBalance);
  const totalPaidCents = payments
    .filter((payment) => String(payment.paymentDate) <= String(monthlyActivity.asOfDate))
    .reduce((sum, payment) => sum + parseMoneyToCents(payment.amount), 0);
  const totalAdjustedCents = mergedAdjustments.reduce((sum, adjustment) => sum + parseMoneyToCents(adjustment.amount), 0);
  const currentBalanceCents = Math.max(0, startingBalanceCents - totalPaidCents + totalAdjustedCents);
  const payoffEstimate = estimateDebtPayoff(debt, formatCents(currentBalanceCents));

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
    closingBalance: monthlyActivity.closingBalance,
    paymentStatus: monthlyActivity.paymentStatus,
    nextStatementDate: monthlyActivity.nextStatementDate,
    nextPaymentDueDate: monthlyActivity.nextPaymentDueDate,
    estimatedPayoffDate: payoffEstimate.estimatedPayoffDate,
    monthsRemaining: payoffEstimate.monthsRemaining,
    totalInterestRemaining: payoffEstimate.totalInterestRemaining,
  };
}

export function buildDebtListResponse(debts, debtPaymentsByDebtId, debtAdjustmentsByDebtId = new Map(), activeMonth) {
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
      statementDay: debt.statementDay ?? null,
      paymentDueDay: debt.paymentDueDay ?? null,
      lateFeeAmount: debt.lateFeeAmount ?? '0.00',
      autoPostInterest: debt.autoPostInterest === true,
      autoPostLateFee: debt.autoPostLateFee === true,
      status: debt.status,
      sortOrder: debt.sortOrder,
      isActive: debt.isActive,
      totalAdjustments: debt.totalAdjustments,
      openingBalance: debt.openingBalance,
      paymentsThisMonth: debt.paymentsThisMonth,
      interestChargedThisMonth: debt.interestChargedThisMonth,
      feesThisMonth: debt.feesThisMonth,
      principalReductionThisMonth: debt.principalReductionThisMonth,
      closingBalance: debt.closingBalance,
      paymentStatus: debt.paymentStatus,
      nextStatementDate: debt.nextStatementDate,
      nextPaymentDueDate: debt.nextPaymentDueDate,
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
