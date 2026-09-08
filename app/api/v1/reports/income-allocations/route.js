import { IncomeAllocationsReportHttpError, getIncomeAllocationsReport } from '../../../../../lib/reports/getIncomeAllocationsReport.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../_shared/http.js';

export async function GET(request, context = {}) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getIncomeAllocationsReport({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      incomeId: searchParams.get('incomeId') ?? searchParams.get('depositId'),
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, IncomeAllocationsReportHttpError);
  }
}
