import { uploadImportBatch } from '../../../../../lib/imports/uploadImportBatch.js';
import { ImportHttpError } from '../../../../../lib/imports/shared.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../_shared/http.js';

export async function POST(request, context = {}) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      throw new ImportHttpError(400, 'file is required');
    }

    const result = await uploadImportBatch({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      input: {
        filename: file.name,
        contentType: file.type,
        text: await file.text(),
      },
    });

    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, ImportHttpError);
  }
}
