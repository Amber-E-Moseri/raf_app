import { computeMonthlyReviewSnapshot, monthStart } from '../raf/reporting.js';
import {
  MonthlyReviewHttpError,
  normalizeOptionalNotes,
  normalizeReviewMonth,
  requireDbContract,
} from './shared.js';

export { MonthlyReviewHttpError } from './shared.js';

export async function listMonthlyReviews({ db, householdId, from, to }) {
  if (!householdId) {
    throw new MonthlyReviewHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  let normalizedFrom;
  let normalizedTo;
  try {
    normalizedFrom = monthStart(from);
    normalizedTo = monthStart(to);
  } catch {
    throw new MonthlyReviewHttpError(400, 'from and to must be valid ISO dates');
  }

  return db.transaction(async (tx) => ({
    items: await tx.listMonthlyReviews({
      householdId,
      from: normalizedFrom,
      to: normalizedTo,
    }),
  }));
}

export async function createMonthlyReview({ db, householdId, input }) {
  if (!householdId) {
    throw new MonthlyReviewHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const reviewMonth = normalizeReviewMonth(input?.reviewMonth);
  const notes = normalizeOptionalNotes(input?.notes);

  return db.transaction(async (tx) => {
    const existing = await tx.getMonthlyReviewByMonth({ householdId, reviewMonth });
    if (existing) {
      throw new MonthlyReviewHttpError(409, 'monthly review already exists for that month');
    }

    const [incomeEntries, transactions, debtPayments, surplusSplitRules] = await Promise.all([
      tx.listIncomeEntries({ householdId, from: reviewMonth, to: reviewMonth }),
      tx.listTransactions({ householdId, from: reviewMonth, to: reviewMonth }),
      tx.listDebtPayments({ householdId, from: reviewMonth, to: reviewMonth }),
      tx.listSurplusSplitRules({ householdId }),
    ]);

    const snapshot = computeMonthlyReviewSnapshot({
      reviewMonth,
      incomeEntries,
      transactions,
      debtPayments,
      surplusSplitRules,
    });

    return tx.insertMonthlyReview({
      householdId,
      reviewMonth: snapshot.reviewMonth,
      netSurplus: snapshot.netSurplus,
      splitApplied: snapshot.splitApplied,
      distributions: snapshot.distributions,
      alertStatus: snapshot.alertStatus,
      notes,
    });
  });
}

export async function updateMonthlyReview({ db, householdId, reviewId, input }) {
  if (!householdId) {
    throw new MonthlyReviewHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const notes = normalizeOptionalNotes(input?.notes);

  return db.transaction(async (tx) => {
    const existing = await tx.getMonthlyReviewById({ householdId, reviewId });
    if (!existing) {
      throw new MonthlyReviewHttpError(404, 'monthly review not found');
    }

    return tx.updateMonthlyReview({
      householdId,
      reviewId,
      patch: { notes },
    });
  });
}
