import { deriveDebtSnapshot } from './debts.js';
import { enumerateMonths, formatCents, nextMonth, parseMoneyToCents } from './reporting.js';

function sumMoney(rows, accessor) {
  return rows.reduce((sum, row) => sum + parseMoneyToCents(accessor(row)), 0);
}

function averageCentsByMonth(rows, dateAccessor, amountAccessor, months) {
  if (months.length === 0) {
    return 0;
  }

  const totals = new Map(months.map((month) => [month, 0]));
  for (const row of rows) {
    const month = String(dateAccessor(row)).slice(0, 7) + '-01';
    if (totals.has(month)) {
      totals.set(month, totals.get(month) + parseMoneyToCents(amountAccessor(row)));
    }
  }

  const total = [...totals.values()].reduce((sum, cents) => sum + cents, 0);
  return Math.round(total / months.length);
}

function buildTrailingMonths(activeMonth) {
  const months = [];
  let cursor = activeMonth;
  for (let index = 0; index < 3; index += 1) {
    months.unshift(cursor);
    const date = new Date(`${cursor}T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() - 1);
    cursor = date.toISOString().slice(0, 10);
  }
  return months;
}

function computeEmergencyFundBalance(monthlyReviews) {
  return monthlyReviews.reduce((sum, review) => {
    const amount = review.distributions?.emergency_fund ?? '0.00';
    return sum + parseMoneyToCents(amount);
  }, 0);
}

function applySurplusSplit(netSurplusCents, rules) {
  if (netSurplusCents <= 0) {
    return 0;
  }

  let emergencyFundCents = 0;
  let assigned = 0;
  for (const rule of rules) {
    const splitPercent = typeof rule.splitPercent === 'string' ? Number(rule.splitPercent) : rule.splitPercent;
    const cents = Math.floor(netSurplusCents * splitPercent);
    assigned += cents;
    if (rule.slug === 'emergency_fund') {
      emergencyFundCents += cents;
    }
  }

  const remainder = netSurplusCents - assigned;
  return emergencyFundCents + remainder;
}

export function computeTrajectory({
  activeMonth,
  months,
  incomeEntries,
  transactions,
  monthlyReviews,
  surplusSplitRules,
  debts,
  debtPayments,
}) {
  const trailingMonths = buildTrailingMonths(activeMonth);
  const projectedIncomeCents = averageCentsByMonth(incomeEntries, (row) => row.receivedDate, (row) => row.amount, trailingMonths);
  const trailingDebitTransactions = transactions.filter((row) => row.direction === 'debit');
  const projectedSpendingCents = averageCentsByMonth(trailingDebitTransactions, (row) => row.transactionDate, (row) => row.amount, trailingMonths);
  const projectedSurplusCents = projectedIncomeCents - projectedSpendingCents;
  const activeRules = [...surplusSplitRules]
    .filter((rule) => rule.isActive !== false)
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));

  const debtPaymentsByDebtId = new Map();
  for (const payment of debtPayments) {
    const existing = debtPaymentsByDebtId.get(payment.debtId) ?? [];
    existing.push(payment);
    debtPaymentsByDebtId.set(payment.debtId, existing);
  }

  const balances = new Map(
    debts.map((debt) => {
      const snapshot = deriveDebtSnapshot(debt, debtPaymentsByDebtId.get(debt.id) ?? []);
      return [debt.id, parseMoneyToCents(snapshot.currentBalance)];
    }),
  );

  let emergencyFundBalanceCents = computeEmergencyFundBalance(monthlyReviews);

  return {
    projections: enumerateMonths(activeMonth, nextMonthOffset(activeMonth, months - 1)).map((month) => {
      emergencyFundBalanceCents += applySurplusSplit(projectedSurplusCents, activeRules);

      const debtBalances = debts.map((debt) => {
        const current = balances.get(debt.id) ?? parseMoneyToCents(debt.startingBalance);
        const paymentCents = parseMoneyToCents(debt.monthlyPayment ?? '0.00');
        const nextBalance = Math.max(0, current - Math.max(paymentCents, 0));
        balances.set(debt.id, nextBalance);

        return {
          debtId: debt.id,
          projectedBalance: formatCents(nextBalance),
        };
      });

      return {
        month,
        projectedIncome: formatCents(projectedIncomeCents),
        projectedSurplus: formatCents(projectedSurplusCents),
        debtBalances,
        emergencyFundBalance: formatCents(emergencyFundBalanceCents),
      };
    }),
  };
}

function nextMonthOffset(month, offset) {
  let cursor = month;
  for (let index = 0; index < offset; index += 1) {
    cursor = nextMonth(cursor);
  }
  return cursor;
}
