import {
  AccountHttpError,
  getFinancialAccount,
  updateFinancialAccount,
} from '../../../../../lib/accounts/accounts.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../../_shared/http.js';

export async function GET(request, context = {}) {
  try {
    const account = await getFinancialAccount({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      accountId: context?.params?.accountId,
    });
    return json(account, 200);
  } catch (error) {
    return respondWithHandledError(error, AccountHttpError);
  }
}

export async function PATCH(request, context = {}) {
  try {
    const account = await updateFinancialAccount({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      accountId: context?.params?.accountId,
      input: await request.json(),
      userId: context?.user?.id ?? context?.userId ?? null,
    });
    return json(account, 200);
  } catch (error) {
    return respondWithHandledError(error, AccountHttpError);
  }
}
