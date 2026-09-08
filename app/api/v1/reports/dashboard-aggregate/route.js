import {
  DashboardAggregateReportHttpError,
  getDashboardAggregateReport,
} from '../../../../../lib/reports/getDashboardAggregateReport.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../_shared/http.js';

export async function GET(request, context = {}) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getDashboardAggregateReport({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      year: searchParams.get('year'),
      month: searchParams.get('month'),
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, DashboardAggregateReportHttpError);
  }
}
