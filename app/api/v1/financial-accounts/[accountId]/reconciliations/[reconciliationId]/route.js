import {
  AccountHttpError,
  deleteAccountReconciliation,
  resolveAccountReconciliation,
} from '../../../../../../../lib/accounts/accounts.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../../../_shared/http.js';

export async function PATCH(request, context = {}) {
  try {
    const reconciliation = await resolveAccountReconciliation({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      accountId: context?.params?.accountId,
      reconciliationId: context?.params?.reconciliationId,
      input: await request.json(),
      userId: context?.user?.id ?? context?.userId ?? null,
    });
    return json(reconciliation, 200);
  } catch (error) {
    return respondWithHandledError(error, AccountHttpError);
  }
}

export const PUT = PATCH;

export async function DELETE(request, context = {}) {
  try {
    await deleteAccountReconciliation({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      accountId: context?.params?.accountId,
      reconciliationId: context?.params?.reconciliationId,
      userId: context?.user?.id ?? context?.userId ?? null,
    });
    return json({ deleted: true }, 200);
  } catch (error) {
    return respondWithHandledError(error, AccountHttpError);
  }
}
