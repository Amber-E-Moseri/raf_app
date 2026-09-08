import { classifyImportedTransaction } from '../../../../../../lib/imports/reviewImportedTransactions.js';
import { ImportHttpError } from '../../../../../../lib/imports/shared.js';
import { getDb, getHouseholdId, json, readJsonBody, respondWithHandledError } from '../../../_shared/http.js';

export async function POST(request, context = {}) {
  try {
    const input = await readJsonBody(
      request,
      () => new ImportHttpError(400, 'request body must be valid JSON'),
    );
    const result = await classifyImportedTransaction({
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
