import { MonthlyReviewReportHttpError, getMonthlyReviewReport } from '../../../../../lib/reports/getMonthlyReviewReport.js';

function json(body, status) {
  return Response.json(body, { status });
}

function getHouseholdId(request, context) {
  return context?.householdId ?? request.headers.get('x-household-id') ?? request.headers.get('x-household_id');
}

function getDb(context) {
  return context?.db ?? globalThis.__RAF_DB__;
}

export async function GET(request, context = {}) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getMonthlyReviewReport({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      month: searchParams.get('month'),
    });

    return json(result, 200);
  } catch (error) {
    if (error instanceof MonthlyReviewReportHttpError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: 'Internal Server Error' }, 500);
  }
}
