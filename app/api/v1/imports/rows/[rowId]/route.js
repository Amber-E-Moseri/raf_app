import { updateImportedRow } from '../../../../../../lib/imports/updateImportedRow.js';
import { ImportHttpError } from '../../../../../../lib/imports/shared.js';

function json(body, status) {
  return Response.json(body, { status });
}

function getHouseholdId(request, context) {
  return context?.householdId ?? request.headers.get('x-household-id') ?? request.headers.get('x-household_id');
}

function getDb(context) {
  return context?.db ?? globalThis.__RAF_DB__;
}

export async function PATCH(request, context = {}) {
  try {
    const input = await request.json();
    const result = await updateImportedRow({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      rowId: context?.params?.rowId,
      input,
    });

    return json(result, 200);
  } catch (error) {
    if (error instanceof ImportHttpError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: 'Internal Server Error' }, 500);
  }
}
