import { FinancialHealthReportHttpError, getFinancialHealthReport } from '../../../../../lib/reports/getFinancialHealthReport.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../_shared/http.js';

export async function GET(request, context = {}) {
  try {
    const url = new URL(request.url);
    const result = await getFinancialHealthReport({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      month: url.searchParams.get('month'),
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, FinancialHealthReportHttpError);
  }
}
