import { updateImportedRow } from '../../../../../../lib/imports/updateImportedRow.js';
import { ImportHttpError } from '../../../../../../lib/imports/shared.js';
import { getDb, getHouseholdId, json, readJsonBody, respondWithHandledError } from '../../../_shared/http.js';

export async function PATCH(request, context = {}) {
  try {
    const input = await readJsonBody(
      request,
      () => new ImportHttpError(400, 'request body must be valid JSON'),
    );
    const result = await updateImportedRow({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      rowId: context?.params?.rowId,
      input,
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, ImportHttpError);
  }
}
