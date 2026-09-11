import { json, getDb, getHouseholdId } from '../../_shared/http.js';
import {
  UpcomingExpenseError,
  getUpcomingExpense,
  updateUpcomingExpense,
  deleteUpcomingExpense,
} from '../../../../../lib/upcomingExpenses/upcomingExpenses.js';

export async function GET(request, context = {}) {
  try {
    const result = await getUpcomingExpense({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      expenseId: context.params?.id,
    });
    return json(result);
  } catch (err) {
    if (err instanceof UpcomingExpenseError) return json({ error: err.message }, err.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}

export async function PATCH(request, context = {}) {
  try {
    const input = await request.json();
    const result = await updateUpcomingExpense({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      expenseId: context.params?.id,
      input,
    });
    return json(result);
  } catch (err) {
    if (err instanceof UpcomingExpenseError) return json({ error: err.message }, err.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}

export const PUT = PATCH;

export async function DELETE(request, context = {}) {
  try {
    await deleteUpcomingExpense({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      expenseId: context.params?.id,
    });
    return json({ deleted: true });
  } catch (err) {
    if (err instanceof UpcomingExpenseError) return json({ error: err.message }, err.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
