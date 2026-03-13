export class IncomeAllocationsReportHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'IncomeAllocationsReportHttpError';
    this.status = status;
  }
}

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Report DB adapter must implement transaction().');
  }
}

export async function getIncomeAllocationsReport({ db, householdId, incomeId }) {
  if (!householdId) {
    throw new IncomeAllocationsReportHttpError(400, 'householdId is required');
  }

  if (!incomeId) {
    throw new IncomeAllocationsReportHttpError(400, 'incomeId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const incomeEntry = await tx.getIncomeEntryById({
      householdId,
      incomeId,
    });

    if (!incomeEntry) {
      throw new IncomeAllocationsReportHttpError(404, 'income entry not found');
    }

    const allocations = await tx.listIncomeAllocations({
      householdId,
      incomeEntryId: incomeId,
    });

    return {
      sourceName: incomeEntry.sourceName,
      amount: incomeEntry.amount,
      receivedDate: incomeEntry.receivedDate,
      allocations: allocations.map((allocation) => ({
        slug: allocation.slug,
        label: allocation.label,
        amount: allocation.amount,
      })),
    };
  });
}
