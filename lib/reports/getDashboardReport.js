import {
  buildDashboardPeriods,
  computeBucketBalancesSnapshot,
  computeMonthlyBucketProgressSnapshot,
  formatCents,
  monthStart,
  parseMoneyToCents,
  unwrapRows,
} from '../raf/reporting.js';
import { monthBounds, parseYearMonth } from '../dates.js';

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

async function resolvePeriod({ tx, householdId, from, to, year, month }) {
  const parsedPeriod = parseYearMonth(year, month);
  if (parsedPeriod) {
    const bounds = monthBounds(parsedPeriod.year, parsedPeriod.month);
    return {
      from: bounds.start,
      to: bounds.start,
      snapshotAsOf: bounds.end,
    };
  }

  if (from && to) {
    const normalizedTo = normalizeMonthQuery(to, 'to');
    return {
      from: normalizeMonthQuery(from, 'from'),
      to: normalizedTo,
      snapshotAsOf: String(to).trim(),
    };
  }

  const household = await tx.getHousehold({ householdId });
  if (!household) {
    throw new ReportHttpError(404, 'household not found');
  }

  return {
    from: monthStart(household.activeMonth),
    to: monthStart(household.activeMonth),
    snapshotAsOf: household.activeMonth,
  };
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
      const remainingAmountCents = Math.max(targetAmountCents - reservedAmountCents, 0);
      const unclampedProgressPercent = targetAmountCents === 0 ? 0 : Number(((reservedAmountCents / targetAmountCents) * 100).toFixed(2));

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
        progress_percent: Math.min(unclampedProgressPercent, 100),
      };
    });
}

export async function getDashboardReport({ db, householdId, from, to, year, month }) {
  if (!householdId) {
    throw new ReportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const { from: normalizedFrom, to: normalizedTo, snapshotAsOf } = await resolvePeriod({
      tx,
      householdId,
      from,
      to,
      year,
      month,
    });

    const [incomeEntries, incomeAllocations, transactions, debtPayments, fixedBills, goals, allocationCategories, allCategories] = await Promise.all([
      tx.listIncomeEntries({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listIncomeAllocations({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listTransactions({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listDebtPayments({ householdId, from: normalizedFrom, to: normalizedTo }),
      typeof tx.listFixedBills === 'function' ? tx.listFixedBills({ householdId }) : [],
      typeof tx.listGoals === 'function' ? tx.listGoals({ householdId }) : [],
      tx.listAllocationCategories({ householdId, asOf: snapshotAsOf }),
      tx.listAllocationCategories({ householdId, includeSuperseded: true }),
    ]);
    const [allIncomeAllocations, allTransactionsResult] = await Promise.all([
      tx.listIncomeAllocations({ householdId, from: '0001-01-01', to: normalizedTo }),
      tx.listTransactions({ householdId, from: '0001-01-01', to: normalizedTo }),
    ]);
    const allTransactions = unwrapRows(allTransactionsResult);
    const categoryLookupById = new Map(allCategories.map((category) => [category.id, category]));
    const bucketBalances = computeBucketBalancesSnapshot({
      buckets: allocationCategories,
      incomeAllocations: allIncomeAllocations,
      transactions: allTransactions,
      categoryLookupById,
    });
    const monthlyBucketProgress = computeMonthlyBucketProgressSnapshot({
      buckets: allocationCategories,
      incomeAllocations,
      transactions: unwrapRows(transactions),
      categoryLookupById,
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
      monthly_bucket_progress: monthlyBucketProgress,
      goal_progress: goalProgress,
    };
  });
}
