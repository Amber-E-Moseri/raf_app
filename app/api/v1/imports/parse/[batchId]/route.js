import { parseImportBatch } from '../../../../../../lib/imports/parseImportBatch.js';
import { ImportHttpError } from '../../../../../../lib/imports/shared.js';
import { getDb, getHouseholdId, json, readJsonBody, respondWithHandledError } from '../../../_shared/http.js';

export async function POST(request, context = {}) {
  try {
    const input = await readJsonBody(
      request,
      () => new ImportHttpError(400, 'request body must be valid JSON'),
    );
    const result = await parseImportBatch({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      batchId: context?.params?.batchId,
      input,
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, ImportHttpError);
  }
}
