import { MonthlyReviewReportHttpError, getMonthlyReviewReport } from '../../../../../lib/reports/getMonthlyReviewReport.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../_shared/http.js';

export async function GET(request, context = {}) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getMonthlyReviewReport({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      month: searchParams.get('month'),
      year: searchParams.get('year'),
      periodMonth: searchParams.get('monthNumber') ?? searchParams.get('month_num') ?? searchParams.get('monthIndex'),
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, MonthlyReviewReportHttpError);
  }
}
