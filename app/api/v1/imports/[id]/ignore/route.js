import { ignoreImportedTransaction } from '../../../../../../lib/imports/reviewImportedTransactions.js';
import { ImportHttpError } from '../../../../../../lib/imports/shared.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../../_shared/http.js';

export async function POST(request, context = {}) {
  try {
    const input = await request.json().catch(() => ({}));
    const result = await ignoreImportedTransaction({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      importedTransactionId: context?.params?.id,
      input,
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, ImportHttpError);
  }
}
