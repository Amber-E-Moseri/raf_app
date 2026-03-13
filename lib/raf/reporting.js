const MONEY_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const FRACTION_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;

export function formatCents(cents) {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function parseMoneyToCents(value) {
  const asString = typeof value === 'number' ? value.toFixed(2) : String(value ?? '').trim();
  if (!MONEY_PATTERN.test(asString)) {
    throw new Error(`Invalid money amount: ${value}`);
  }

  const negative = asString.startsWith('-');
  const unsigned = negative ? asString.slice(1) : asString;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}

function parseFraction(value) {
  const asString = typeof value === 'number' ? value.toFixed(4) : String(value ?? '').trim();
  if (!FRACTION_PATTERN.test(asString)) {
    throw new Error(`Invalid fraction: ${value}`);
  }

  return Number(asString);
}

export function monthStart(value) {
  const asString = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  const parsed = new Date(`${asString}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== asString) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  parsed.setUTCDate(1);
  return parsed.toISOString().slice(0, 10);
}

export function nextMonth(month) {
  const current = new Date(`${monthStart(month)}T00:00:00.000Z`);
  current.setUTCMonth(current.getUTCMonth() + 1);
  return current.toISOString().slice(0, 10);
}

export function enumerateMonths(from, to) {
  const start = monthStart(from);
  const end = monthStart(to);
  if (start > end) {
    throw new Error('from must be before or equal to to');
  }

  const months = [];
  let cursor = start;
  while (cursor <= end) {
    months.push(cursor);
    cursor = nextMonth(cursor);
  }

  return months;
}

export function computeAlertStatus({ netSurplusCents, debtRatio = 0, emergencyCoverageMonths = null }) {
  if ((emergencyCoverageMonths != null && emergencyCoverageMonths < 1) || debtRatio > 0.35) {
    return 'risky';
  }

  if (debtRatio > 0.25 || netSurplusCents < 0) {
    return 'elevated';
  }

  return 'ok';
}

export function buildDashboardPeriods({
  from,
  to,
  incomeEntries,
  incomeAllocations,
  transactions,
  debtPayments,
  emergencyCoverageMonthsByMonth = {},
}) {
  const months = enumerateMonths(from, to);
  const totals = new Map(
    months.map((month) => [
      month,
      {
        incomeCents: 0,
        spendingCents: 0,
        savingsCents: 0,
        debtPaymentCents: 0,
      },
    ]),
  );

  for (const entry of incomeEntries) {
    const month = monthStart(entry.receivedDate);
    if (totals.has(month)) {
      totals.get(month).incomeCents += parseMoneyToCents(entry.amount);
    }
  }

  for (const allocation of incomeAllocations) {
    if (allocation.slug !== 'savings') {
      continue;
    }

    const month = monthStart(allocation.receivedDate);
    if (totals.has(month)) {
      totals.get(month).savingsCents += parseMoneyToCents(allocation.allocatedAmount);
    }
  }

  for (const transaction of transactions) {
    if (transaction.direction !== 'debit') {
      continue;
    }

    const month = monthStart(transaction.transactionDate);
    if (totals.has(month)) {
      totals.get(month).spendingCents += Math.abs(parseMoneyToCents(transaction.amount));
    }
  }

  for (const payment of debtPayments) {
    const month = monthStart(payment.paymentDate);
    if (totals.has(month)) {
      totals.get(month).debtPaymentCents += parseMoneyToCents(payment.amount);
    }
  }

  return months.map((month) => {
    const total = totals.get(month);
    const netSurplusCents = total.incomeCents - total.spendingCents;
    const debtRatio = total.incomeCents === 0 ? 0 : total.debtPaymentCents / total.incomeCents;

    return {
      month,
      incomeTotal: formatCents(total.incomeCents),
      spendingTotal: formatCents(total.spendingCents),
      surplusOrDeficit: formatCents(netSurplusCents),
      savingsActual: formatCents(total.savingsCents),
      alertStatus: computeAlertStatus({
        netSurplusCents,
        debtRatio,
        emergencyCoverageMonths: emergencyCoverageMonthsByMonth[month] ?? null,
      }),
    };
  });
}

export function computeMonthlyReviewSnapshot({
  reviewMonth,
  incomeEntries,
  transactions,
  debtPayments,
  surplusSplitRules,
  emergencyCoverageMonths = null,
}) {
  const month = monthStart(reviewMonth);
  const incomeCents = incomeEntries.reduce((sum, entry) => sum + parseMoneyToCents(entry.amount), 0);
  const outflowCents = transactions.reduce((sum, transaction) => {
    if (transaction.direction !== 'debit') {
      return sum;
    }

    return sum + Math.abs(parseMoneyToCents(transaction.amount));
  }, 0);
  const debtPaymentCents = debtPayments.reduce((sum, payment) => sum + parseMoneyToCents(payment.amount), 0);
  const netSurplusCents = incomeCents - outflowCents;
  const debtRatio = incomeCents === 0 ? 0 : debtPaymentCents / incomeCents;

  const activeRules = [...surplusSplitRules]
    .filter((rule) => rule.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const splitApplied = Object.fromEntries(
    activeRules.map((rule) => [rule.slug, typeof rule.splitPercent === 'string' ? rule.splitPercent : Number(rule.splitPercent).toFixed(4)]),
  );

  const distributions = Object.fromEntries(activeRules.map((rule) => [rule.slug, '0.00']));
  if (netSurplusCents > 0 && activeRules.length > 0) {
    const emergencyRule = activeRules.find((rule) => rule.slug === 'emergency_fund');
    if (!emergencyRule) {
      throw new Error('Active surplus split rules must include the emergency_fund slug.');
    }

    let assignedCents = 0;
    for (const rule of activeRules) {
      const cents = Math.floor(netSurplusCents * parseFraction(rule.splitPercent));
      distributions[rule.slug] = formatCents(cents);
      assignedCents += cents;
    }

    const remainder = netSurplusCents - assignedCents;
    distributions.emergency_fund = formatCents(parseMoneyToCents(distributions.emergency_fund) + remainder);
  }

  return {
    reviewMonth: month,
    netSurplus: formatCents(netSurplusCents),
    splitApplied,
    distributions,
    alertStatus: computeAlertStatus({
      netSurplusCents,
      debtRatio,
      emergencyCoverageMonths,
    }),
  };
}

export function computeFinancialHealthSnapshot({
  household,
  activeMonthIncomeEntries,
  activeMonthTransactions,
  activeMonthDebtPayments,
  savingsAllocations,
  monthlyReviews,
}) {
  const activeMonthIncomeCents = activeMonthIncomeEntries.reduce(
    (sum, entry) => sum + parseMoneyToCents(entry.amount),
    0,
  );
  const monthlyDebtPaymentsCents = activeMonthDebtPayments.reduce(
    (sum, payment) => sum + parseMoneyToCents(payment.amount),
    0,
  );
  const activeMonthOutflowCents = activeMonthTransactions.reduce((sum, transaction) => {
    if (transaction.direction !== 'debit') {
      return sum;
    }

    return sum + Math.abs(parseMoneyToCents(transaction.amount));
  }, 0);
  const savingsBalanceCents = savingsAllocations.reduce(
    (sum, allocation) => sum + parseMoneyToCents(allocation.allocatedAmount),
    0,
  );
  const emergencyFundBalanceCents = monthlyReviews.reduce((sum, review) => {
    const distributions = review.distributions ?? {};
    const amount = distributions.emergency_fund ?? '0.00';
    return sum + parseMoneyToCents(amount);
  }, 0);

  const savingsFloorCents = parseMoneyToCents(household.savingsFloor ?? '0.00');
  const monthlyEssentialsCents = parseMoneyToCents(household.monthlyEssentialsBaseline ?? '0.00');
  const availableSavingsCents = savingsBalanceCents - savingsFloorCents;
  const debtRatio = activeMonthIncomeCents === 0 ? 0 : monthlyDebtPaymentsCents / activeMonthIncomeCents;
  const emergencyCoverageMonths =
    monthlyEssentialsCents === 0 ? null : emergencyFundBalanceCents / monthlyEssentialsCents;
  const netSurplusCents = activeMonthIncomeCents - activeMonthOutflowCents;

  return {
    activeMonthIncome: formatCents(activeMonthIncomeCents),
    monthlyDebtPayments: formatCents(monthlyDebtPaymentsCents),
    debtRatio: activeMonthIncomeCents === 0 ? '0.0000' : debtRatio.toFixed(4),
    savingsBalance: formatCents(savingsBalanceCents),
    savingsFloor: formatCents(savingsFloorCents),
    availableSavings: formatCents(availableSavingsCents),
    emergencyFundBalance: formatCents(emergencyFundBalanceCents),
    monthlyEssentials: formatCents(monthlyEssentialsCents),
    emergencyCoverageMonths:
      emergencyCoverageMonths == null ? null : Number(emergencyCoverageMonths.toFixed(2)),
    alertStatus: computeAlertStatus({
      netSurplusCents,
      debtRatio,
      emergencyCoverageMonths,
    }),
  };
}
