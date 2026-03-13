import { listGoalProgress } from '../goals/goals.js';
import { buildDashboardPeriods, monthStart, unwrapRows } from '../raf/reporting.js';

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

export async function getDashboardReport({ db, householdId, from, to }) {
  if (!householdId) {
    throw new ReportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const normalizedFrom = normalizeMonthQuery(from, 'from');
  const normalizedTo = normalizeMonthQuery(to, 'to');

  return db.transaction(async (tx) => {
    const [incomeEntries, incomeAllocations, transactions, debtPayments, fixedBills, goalProgress] = await Promise.all([
      tx.listIncomeEntries({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listIncomeAllocations({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listTransactions({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listDebtPayments({ householdId, from: normalizedFrom, to: normalizedTo }),
      typeof tx.listFixedBills === 'function' ? tx.listFixedBills({ householdId }) : [],
      typeof tx.listGoals === 'function'
        ? listGoalProgress({
          db: {
            transaction: async (callback) => callback(tx),
          },
          householdId,
        })
        : [],
    ]);

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
      goal_progress: goalProgress,
    };
  });
}
