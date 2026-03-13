import { computeMonthlyReviewSnapshot, monthStart, unwrapRows } from '../raf/reporting.js';

export class MonthlyReviewReportHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MonthlyReviewReportHttpError';
    this.status = status;
  }
}

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Report DB adapter must implement transaction().');
  }
}

function normalizeReviewMonth(value) {
  let normalized;
  try {
    normalized = monthStart(value);
  } catch {
    throw new MonthlyReviewReportHttpError(400, 'month must be a valid ISO date');
  }

  if (String(value).trim() !== normalized) {
    throw new MonthlyReviewReportHttpError(400, 'month must be the first day of the month');
  }

  return normalized;
}

function formatDistributions(distributions, surplusSplitRules) {
  return [...surplusSplitRules]
    .filter((rule) => rule.isActive !== false)
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    .map((rule) => ({
      slug: rule.slug,
      label: rule.label ?? rule.slug,
      amount: distributions[rule.slug] ?? '0.00',
    }));
}

export async function getMonthlyReviewReport({ db, householdId, month }) {
  if (!householdId) {
    throw new MonthlyReviewReportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const reviewMonth = normalizeReviewMonth(month);

  return db.transaction(async (tx) => {
    const [incomeEntries, transactions, debtPayments, surplusSplitRules] = await Promise.all([
      tx.listIncomeEntries({ householdId, from: reviewMonth, to: reviewMonth }),
      tx.listTransactions({ householdId, from: reviewMonth, to: reviewMonth }),
      tx.listDebtPayments({ householdId, from: reviewMonth, to: reviewMonth }),
      tx.listSurplusSplitRules({ householdId }),
    ]);

    const snapshot = computeMonthlyReviewSnapshot({
      reviewMonth,
      incomeEntries,
      transactions: unwrapRows(transactions),
      debtPayments,
      surplusSplitRules,
    });

    return {
      reviewMonth: snapshot.reviewMonth,
      netSurplus: snapshot.netSurplus,
      distributions: formatDistributions(snapshot.distributions, surplusSplitRules),
      alertStatus: snapshot.alertStatus,
    };
  });
}
