import { getEmailPreferences, patchEmailPreferences, EmailPreferencesHttpError } from '../../../../../lib/email/emailPreferences.js';
import { buildErrorBody, getDb, getHouseholdId, json } from '../../_shared/http.js';

function handle(error) {
  if (error instanceof EmailPreferencesHttpError) {
    return json(buildErrorBody({ status: error.status, message: error.message }), error.status);
  }
  return json(buildErrorBody({ status: 500, message: 'Internal Server Error' }), 500);
}

export async function GET(request, context = {}) {
  try {
    const result = await getEmailPreferences({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
    });
    return json(result);
  } catch (error) {
    return handle(error);
  }
}

export async function PATCH(request, context = {}) {
  try {
    const input = await request.json();
    const result = await patchEmailPreferences({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      input,
    });
    return json(result);
  } catch (error) {
    return handle(error);
  }
}
