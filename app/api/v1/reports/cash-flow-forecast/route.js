import { CashFlowForecastHttpError, getCashFlowForecastReport } from '../../../../../lib/reports/getCashFlowForecastReport.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../_shared/http.js';

export async function GET(request, context = {}) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getCashFlowForecastReport({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      days: searchParams.get('days'),
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, CashFlowForecastHttpError);
  }
}
