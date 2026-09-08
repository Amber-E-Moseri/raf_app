import { rejectImportBatch } from '../../../../../../lib/imports/rejectImportBatch.js';
import { ImportHttpError } from '../../../../../../lib/imports/shared.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../../_shared/http.js';

export async function POST(request, context = {}) {
  try {
    const result = await rejectImportBatch({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      batchId: context?.params?.batchId,
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, ImportHttpError);
  }
}
