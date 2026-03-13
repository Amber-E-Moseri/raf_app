import { buildDashboardPeriods, computeBucketBalancesSnapshot, formatCents, monthStart, parseMoneyToCents, unwrapRows } from '../raf/reporting.js';

export class ReportHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ReportHttpError';
    this.status = status;
  }
}

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Report DB adapter must implement transaction().');
  }
}

function normalizeMonthQuery(value, fieldName) {
  try {
    return monthStart(value);
  } catch {
    throw new ReportHttpError(400, `${fieldName} must be a valid ISO date`);
  }
}

function formatUpcomingFixedBill(fixedBill) {
  return {
    id: fixedBill.id,
    name: fixedBill.name,
    category_slug: fixedBill.categorySlug,
    expected_amount: fixedBill.expectedAmount,
    due_day_of_month: fixedBill.dueDayOfMonth,
  };
}

function addMoneyStrings(left, right) {
  const [leftWhole, leftFraction = ''] = String(left).split('.');
  const [rightWhole, rightFraction = ''] = String(right).split('.');
  const totalCents = (Number(leftWhole) * 100 + Number((leftFraction + '00').slice(0, 2)))
    + (Number(rightWhole) * 100 + Number((rightFraction + '00').slice(0, 2)));

  return `${Math.floor(totalCents / 100)}.${String(totalCents % 100).padStart(2, '0')}`;
}

function buildGoalProgress({ goals, bucketBalances }) {
  const bucketBalancesById = new Map(bucketBalances.map((bucket) => [bucket.bucket_id, bucket]));

  return goals
    .filter((goal) => goal.active !== false)
    .filter((goal) => bucketBalancesById.has(goal.bucketId))
    .map((goal) => {
      const bucket = bucketBalancesById.get(goal.bucketId);
      const reservedAmount = bucket.balance;
      const targetAmount = goal.targetAmount;
      const reservedAmountCents = parseMoneyToCents(reservedAmount);
      const targetAmountCents = parseMoneyToCents(targetAmount);
      const remainingAmountCents = targetAmountCents - reservedAmountCents;

      return {
        goal_id: goal.id,
        goal_name: goal.name,
        bucket_id: goal.bucketId,
        bucket: bucket.bucket_name,
        bucket_name: bucket.bucket_name,
        target_amount: targetAmount,
        reserved_amount: reservedAmount,
        current_amount: reservedAmount,
        remaining_amount: formatCents(remainingAmountCents),
        progress_percent: targetAmountCents === 0 ? 0 : Number(((reservedAmountCents / targetAmountCents) * 100).toFixed(2)),
      };
    });
}

export async function getDashboardReport({ db, householdId, from, to }) {
  if (!householdId) {
    throw new ReportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const normalizedFrom = normalizeMonthQuery(from, 'from');
  const normalizedTo = normalizeMonthQuery(to, 'to');

  return db.transaction(async (tx) => {
    const [incomeEntries, incomeAllocations, transactions, debtPayments, fixedBills, goals, allocationCategories] = await Promise.all([
      tx.listIncomeEntries({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listIncomeAllocations({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listTransactions({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listDebtPayments({ householdId, from: normalizedFrom, to: normalizedTo }),
      typeof tx.listFixedBills === 'function' ? tx.listFixedBills({ householdId }) : [],
      typeof tx.listGoals === 'function' ? tx.listGoals({ householdId }) : [],
      tx.listAllocationCategories({ householdId }),
    ]);
    const [allIncomeAllocations, allTransactionsResult] = await Promise.all([
      tx.listIncomeAllocations({ householdId }),
      tx.listTransactions({ householdId }),
    ]);
    const allTransactions = unwrapRows(allTransactionsResult);
    const bucketBalances = computeBucketBalancesSnapshot({
      buckets: allocationCategories,
      incomeAllocations: allIncomeAllocations,
      transactions: allTransactions,
    });
    const goalProgress = buildGoalProgress({
      goals,
      bucketBalances,
    });

    const upcomingFixedBillsThisMonth = fixedBills
      .filter((fixedBill) => fixedBill.active !== false)
      .sort((left, right) =>
        (left.dueDayOfMonth ?? 0) - (right.dueDayOfMonth ?? 0)
        || String(left.categorySlug ?? '').localeCompare(String(right.categorySlug ?? ''))
        || String(left.name ?? '').localeCompare(String(right.name ?? ''))
        || String(left.id ?? '').localeCompare(String(right.id ?? '')))
      .map(formatUpcomingFixedBill);

    const totalExpectedFixedBillsThisMonth = upcomingFixedBillsThisMonth.reduce(
      (sum, fixedBill) => addMoneyStrings(sum, fixedBill.expected_amount),
      '0.00',
    );

    return {
      periods: buildDashboardPeriods({
        from: normalizedFrom,
        to: normalizedTo,
        incomeEntries,
        incomeAllocations,
        transactions: unwrapRows(transactions),
        debtPayments,
      }),
      upcoming_fixed_bills_this_month: upcomingFixedBillsThisMonth,
      total_expected_fixed_bills_this_month: totalExpectedFixedBillsThisMonth,
      bucket_balances: bucketBalances,
      goal_progress: goalProgress,
    };
  });
}
