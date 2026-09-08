import { json, getDb, getHouseholdId } from '../_shared/http.js';
import {
  UpcomingExpenseError,
  listUpcomingExpenses,
  createUpcomingExpense,
} from '../../../../lib/upcomingExpenses/upcomingExpenses.js';

export async function GET(request, context = {}) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? null;
    const result = await listUpcomingExpenses({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      status,
    });
    return json({ items: result });
  } catch (err) {
    if (err instanceof UpcomingExpenseError) return json({ error: err.message }, err.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}

export async function POST(request, context = {}) {
  try {
    const input = await request.json();
    const result = await createUpcomingExpense({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      input,
    });
    return json(result, 201);
  } catch (err) {
    if (err instanceof UpcomingExpenseError) return json({ error: err.message }, err.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
