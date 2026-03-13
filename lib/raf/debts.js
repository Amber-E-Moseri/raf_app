import { formatCents, parseMoneyToCents } from './reporting.js';

export function deriveDebtSnapshot(debt, payments = [], adjustments = []) {
  const startingBalanceCents = parseMoneyToCents(debt.startingBalance);
  const totalPaidCents = payments.reduce((sum, payment) => sum + parseMoneyToCents(payment.amount), 0);
  const totalAdjustedCents = adjustments.reduce((sum, adjustment) => sum + parseMoneyToCents(adjustment.amount), 0);
  const currentBalanceCents = startingBalanceCents - totalPaidCents + totalAdjustedCents;

  return {
    ...debt,
    currentBalance: formatCents(currentBalanceCents),
    totalPaidAllTime: formatCents(totalPaidCents),
    totalAdjustments: formatCents(totalAdjustedCents),
    status: currentBalanceCents > 0 ? 'current' : 'paid_off',
  };
}

export function buildDebtListResponse(debts, debtPaymentsByDebtId, debtAdjustmentsByDebtId = new Map()) {
  const snapshots = debts.map((debt) => deriveDebtSnapshot(
    debt,
    debtPaymentsByDebtId.get(debt.id) ?? [],
    debtAdjustmentsByDebtId.get(debt.id) ?? [],
  ));

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
    })),
    summary: {
      totalStarting: formatCents(summary.totalStartingCents),
      totalRemaining: formatCents(summary.totalRemainingCents),
      totalPaidAllTime: formatCents(summary.totalPaidAllTimeCents),
    },
  };
}
