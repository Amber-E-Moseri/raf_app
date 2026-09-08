function fmt(amount) {
  return Number(amount ?? 0).toFixed(2);
}

/**
 * Strip card/account number fragments from merchant names before including
 * them in AI context. Removes sequences of 4+ consecutive digits.
 * Never include raw transaction descriptions, account numbers, or statement
 * text in Remi context.
 */
export function sanitizeMerchantName(name) {
  return String(name ?? 'Unknown').replace(/\b\d{4,}\b/g, '****').trim() || 'Unknown';
}

function monthsBack(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

export function buildRemiIncomeContext(incomeEntries = [], months = 1) {
  const totalIncome = incomeEntries.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
  return {
    totalForPeriod: fmt(totalIncome),
    avgMonthly: fmt(months > 0 ? totalIncome / months : 0),
    entryCount: incomeEntries.length,
  };
}

export function buildRemiSpendingContext(transactions = [], months = 1) {
  const debitTransactions = transactions.filter((transaction) => Number(transaction.amount ?? 0) < 0);
  const totalSpending = debitTransactions.reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount ?? 0)), 0);
  const topMerchants = Object.entries(
    debitTransactions.reduce((acc, transaction) => {
      const key = sanitizeMerchantName(transaction.merchant ?? transaction.description);
      acc[key] = (acc[key] ?? 0) + Math.abs(Number(transaction.amount ?? 0));
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([merchant, total]) => ({ merchant, total: fmt(total) }));

  return {
    totalForPeriod: fmt(totalSpending),
    avgMonthly: fmt(months > 0 ? totalSpending / months : 0),
    transactionCount: debitTransactions.length,
    topMerchants,
  };
}

export function buildRemiDebtContext(debts = []) {
  return debts.map((debt) => ({
    name: debt.name,
    balance: fmt(debt.currentBalance ?? debt.startingBalance),
    minimumPayment: fmt(debt.minimumPayment),
    interestRate: debt.interestRate ?? null,
  }));
}

export function buildRemiGoalContext(goals = []) {
  return goals.map((goal) => ({
    name: goal.name,
    target: fmt(goal.targetAmount),
    current: fmt(goal.currentAmount ?? 0),
    percentComplete: goal.targetAmount > 0
      ? Math.round((Number(goal.currentAmount ?? 0) / Number(goal.targetAmount)) * 100)
      : 0,
  }));
}

export async function buildFinancialContext({ db, householdId, months = 3 }) {
  const from = monthsBack(months);
  const to = new Date().toISOString().slice(0, 10);

  const [household, transactions, incomeEntries, debts, goals, monthlyReviews] = await db.transaction(async (tx) => [
    await tx.getHousehold({ householdId }),
    await tx.listTransactions({ householdId, from, to, limit: 500 }),
    await tx.listIncomeEntries({ householdId, from, to }),
    await tx.listDebts({ householdId }),
    await tx.listGoals({ householdId }),
    await tx.listMonthlyReviews({ householdId }),
  ]);

  const txItems = Array.isArray(transactions) ? transactions : (transactions?.items ?? []);
  const recentReviews = (monthlyReviews ?? []).slice(0, months);

  const incomeContext = buildRemiIncomeContext(incomeEntries, months);
  const spendingContext = buildRemiSpendingContext(txItems, months);
  const debtSummary = buildRemiDebtContext(debts ?? []);
  const goalSummary = buildRemiGoalContext(goals ?? []);
  const avgMonthlyIncome = Number(incomeContext.avgMonthly);
  const avgMonthlySpending = Number(spendingContext.avgMonthly);

  return {
    householdName: household?.name ?? 'Your Household',
    periodMonths: months,
    periodFrom: from,
    periodTo: to,
    income: incomeContext,
    spending: spendingContext,
    savingsRate: avgMonthlyIncome > 0
      ? Math.round(((avgMonthlyIncome - avgMonthlySpending) / avgMonthlyIncome) * 100)
      : null,
    debts: debtSummary,
    goals: goalSummary,
    recentMonthlyReviews: recentReviews.map((r) => ({
      month: r.activeMonth ?? r.month,
      status: r.status,
    })),
  };
}
