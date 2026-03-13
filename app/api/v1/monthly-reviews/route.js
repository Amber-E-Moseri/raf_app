import { MonthlyReviewHttpError, createMonthlyReview, listMonthlyReviews } from '../../../../lib/monthlyReviews/monthlyReviews.js';

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
    const result = await listMonthlyReviews({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    });

    return json(result, 200);
  } catch (error) {
    if (error instanceof MonthlyReviewHttpError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: 'Internal Server Error' }, 500);
  }
}

export async function POST(request, context = {}) {
  try {
    const input = await request.json();
    const result = await createMonthlyReview({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      input,
    });

    return json(result, 201);
  } catch (error) {
    if (error instanceof MonthlyReviewHttpError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: 'Internal Server Error' }, 500);
  }
}
