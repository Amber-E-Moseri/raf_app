import { computeBucketBalancesSnapshot, computeFinancialHealthSnapshot, unwrapRows } from '../raf/reporting.js';

export class FinancialHealthReportHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'FinancialHealthReportHttpError';
    this.status = status;
  }
}

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Report DB adapter must implement transaction().');
  }
}

export async function getFinancialHealthReport({ db, householdId }) {
  if (!householdId) {
    throw new FinancialHealthReportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    // TODO: make financial health fully period-aware once the report contract accepts explicit year/month inputs.
    const household = await tx.getHousehold({ householdId });
    if (!household) {
      throw new FinancialHealthReportHttpError(404, 'household not found');
    }

    const activeMonth = household.activeMonth;

    const [
      activeMonthIncomeEntries,
      activeMonthTransactions,
      activeMonthDebtPayments,
      allIncomeAllocations,
      allTransactionsResult,
      allocationCategories,
      allCategories,
      monthlyReviews,
    ] =
      await Promise.all([
        tx.listIncomeEntries({ householdId, from: activeMonth, to: activeMonth }),
        tx.listTransactions({ householdId, from: activeMonth, to: activeMonth }),
        tx.listDebtPayments({ householdId, from: activeMonth, to: activeMonth }),
        tx.listIncomeAllocations({ householdId, from: '0001-01-01', to: activeMonth }),
        tx.listTransactions({ householdId, from: '0001-01-01', to: activeMonth }),
        tx.listAllocationCategories({ householdId, asOf: activeMonth }),
        tx.listAllocationCategories({ householdId, includeSuperseded: true }),
        tx.listMonthlyReviews({ householdId, from: '0001-01-01', to: '9999-12-01' }),
      ]);
    const allTransactions = unwrapRows(allTransactionsResult);
    const categoryLookupById = new Map(allCategories.map((category) => [category.id, category]));
    const bucketBalances = computeBucketBalancesSnapshot({
      buckets: allocationCategories,
      incomeAllocations: allIncomeAllocations,
      transactions: allTransactions,
      categoryLookupById,
    });
    const savingsBalance = bucketBalances.find((bucket) => bucket.slug === 'savings')?.balance ?? '0.00';

    return computeFinancialHealthSnapshot({
      household: {
        savingsFloor: household.savingsFloor,
        savingsFloorEnabled: household.savingsFloorEnabled === true,
        monthlyEssentialsBaseline: household.monthlyEssentialsBaseline,
      },
      activeMonthIncomeEntries,
      activeMonthTransactions: unwrapRows(activeMonthTransactions),
      activeMonthDebtPayments,
      savingsBalance,
      monthlyReviews,
    });
  });
}
