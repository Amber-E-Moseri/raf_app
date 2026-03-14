import { z } from 'zod';

import { computeMonthlyReviewSnapshot, parseMoneyToCents, unwrapRows } from '../raf/reporting.js';
import {
  MonthlyReviewHttpError,
  normalizeOptionalNotes,
  normalizeReviewMonth,
  requireDbContract,
} from './shared.js';

const applyMonthlyReviewSchema = z.object({
  reviewMonth: z.string().trim().min(1, 'reviewMonth is required'),
  notes: z.union([z.string(), z.null(), z.undefined()]).optional(),
});

function parseWithSchema(input) {
  const result = applyMonthlyReviewSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new MonthlyReviewHttpError(400, `${path} ${issue.message}`);
  }

  return result.data;
}

function formatTransaction(transaction) {
  return {
    id: transaction.id,
    transactionDate: transaction.transactionDate,
    description: transaction.description,
    merchant: transaction.merchant ?? null,
    amount: transaction.amount,
    direction: transaction.direction,
    categoryId: transaction.categoryId ?? null,
    linkedDebtId: transaction.linkedDebtId ?? null,
  };
}

function mapRuleSlugToCategorySlug(slug) {
  if (slug === 'extra_debt_payoff') {
    return 'debt_payoff';
  }

  return slug;
}

function buildAllocationTransactions({ reviewMonth, distributions, surplusSplitRules, allocationCategories }) {
  const categoriesBySlug = new Map(
    allocationCategories.map((category) => [category.slug, category]),
  );

  return [...surplusSplitRules]
    .filter((rule) => rule.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((rule) => {
      const amount = distributions[rule.slug] ?? '0.00';
      const cents = parseMoneyToCents(amount);
      if (cents <= 0) {
        return null;
      }

      const category = categoriesBySlug.get(mapRuleSlugToCategorySlug(rule.slug)) ?? null;
      return {
        transactionDate: reviewMonth,
        description: `Monthly review allocation: ${rule.label ?? rule.slug}`,
        merchant: null,
        amount,
        direction: 'debit',
        categoryId: category?.id ?? null,
        linkedDebtId: null,
        source: 'manual',
      };
    })
    .filter(Boolean);
}

export async function applyMonthlyReview({ db, householdId, input }) {
  if (!householdId) {
    throw new MonthlyReviewHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedInput = parseWithSchema(input);
  const reviewMonth = normalizeReviewMonth(parsedInput.reviewMonth);
  const notes = normalizeOptionalNotes(parsedInput.notes);

  return db.transaction(async (tx) => {
    const existing = await tx.getMonthlyReviewByMonth({ householdId, reviewMonth });
    if (existing) {
      throw new MonthlyReviewHttpError(409, 'monthly review already exists for that month');
    }

    const [incomeEntries, transactions, debtPayments, surplusSplitRules, allocationCategories] = await Promise.all([
      tx.listIncomeEntries({ householdId, from: reviewMonth, to: reviewMonth }),
      tx.listTransactions({ householdId, from: reviewMonth, to: reviewMonth }),
      tx.listDebtPayments({ householdId, from: reviewMonth, to: reviewMonth }),
      tx.listSurplusSplitRules({ householdId }),
      tx.listAllocationCategories({ householdId, asOf: reviewMonth }),
    ]);

    const snapshot = computeMonthlyReviewSnapshot({
      reviewMonth,
      incomeEntries,
      transactions: unwrapRows(transactions),
      debtPayments,
      surplusSplitRules,
    });

    const review = await tx.insertMonthlyReview({
      householdId,
      reviewMonth: snapshot.reviewMonth,
      netSurplus: snapshot.netSurplus,
      splitApplied: snapshot.splitApplied,
      distributions: snapshot.distributions,
      alertStatus: snapshot.alertStatus,
      notes,
    });

    const appliedTransactions = [];
    if (parseMoneyToCents(snapshot.netSurplus) > 0) {
      const plannedTransactions = buildAllocationTransactions({
        reviewMonth: snapshot.reviewMonth,
        distributions: snapshot.distributions,
        surplusSplitRules,
        allocationCategories,
      });

      for (const plannedTransaction of plannedTransactions) {
        const created = await tx.insertTransaction({
          householdId,
          ...plannedTransaction,
        });
        appliedTransactions.push(formatTransaction(created));
      }
    }

    return {
      review,
      appliedTransactions,
    };
  });
}

export const __internal = {
  applyMonthlyReviewSchema,
  buildAllocationTransactions,
  mapRuleSlugToCategorySlug,
};
