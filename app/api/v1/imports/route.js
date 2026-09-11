import { listReviewedImportedTransactions } from '../../../../lib/imports/reviewImportedTransactions.js';
import { ImportHttpError } from '../../../../lib/imports/shared.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../_shared/http.js';

export async function GET(request, context = {}) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? undefined;
    const result = await listReviewedImportedTransactions({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      from,
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, ImportHttpError);
  }
}
