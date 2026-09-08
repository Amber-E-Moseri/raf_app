import { getDashboardReport, ReportHttpError } from './getDashboardReport.js';
import { getFinancialHealthReport, FinancialHealthReportHttpError } from './getFinancialHealthReport.js';
import { getMonthlyReviewReport, MonthlyReviewReportHttpError } from './getMonthlyReviewReport.js';
import { dashboardAggregateReportSchema } from '../contracts/reportContracts.js';

export class DashboardAggregateReportHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DashboardAggregateReportHttpError';
    this.status = status;
  }
}

function normalizeReportError(error) {
  if (error instanceof ReportHttpError
    || error instanceof FinancialHealthReportHttpError
    || error instanceof MonthlyReviewReportHttpError) {
    throw new DashboardAggregateReportHttpError(error.status, error.message);
  }

  throw error;
}

export async function getDashboardAggregateReport({ db, householdId, from, to, year, month }) {
  try {
    const dashboard = await getDashboardReport({
      db,
      householdId,
      from,
      to,
      year,
      month,
    });

    const targetMonth = dashboard.periods.at(-1)?.month ?? from ?? month ?? null;
    const [financialHealth, surplusRecommendations] = await Promise.all([
      getFinancialHealthReport({
        db,
        householdId,
        month: targetMonth,
      }),
      getMonthlyReviewReport({
        db,
        householdId,
        month: targetMonth,
      }),
    ]);

    const payload = {
      dashboard,
      financialHealth,
      surplusRecommendations,
    };

    return dashboardAggregateReportSchema.parse(payload);
  } catch (error) {
    normalizeReportError(error);
  }
}
