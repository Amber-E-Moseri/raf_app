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

export async function getDashboardReport({ db, householdId, from, to }) {
  if (!householdId) {
    throw new ReportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const normalizedFrom = normalizeMonthQuery(from, 'from');
  const normalizedTo = normalizeMonthQuery(to, 'to');

  return db.transaction(async (tx) => {
    const [incomeEntries, incomeAllocations, transactions, debtPayments] = await Promise.all([
      tx.listIncomeEntries({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listIncomeAllocations({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listTransactions({ householdId, from: normalizedFrom, to: normalizedTo }),
      tx.listDebtPayments({ householdId, from: normalizedFrom, to: normalizedTo }),
    ]);

    return {
      periods: buildDashboardPeriods({
        from: normalizedFrom,
        to: normalizedTo,
        incomeEntries,
        incomeAllocations,
        transactions: unwrapRows(transactions),
        debtPayments,
      }),
    };
  });
}
