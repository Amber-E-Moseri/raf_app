import {
  AccountHttpError,
  createFinancialAccount,
  listFinancialAccounts,
} from '../../../../lib/accounts/accounts.js';
import { getDb, getHouseholdId, json, respondWithHandledError } from '../_shared/http.js';

export async function GET(request, context = {}) {
  try {
    const result = await listFinancialAccounts({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
    });
    return json(result, 200);
  } catch (error) {
    return respondWithHandledError(error, AccountHttpError);
  }
}

export async function POST(request, context = {}) {
  try {
    const account = await createFinancialAccount({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      input: await request.json(),
      userId: context?.user?.id ?? context?.userId ?? null,
    });
    return json(account, 201);
  } catch (error) {
    return respondWithHandledError(error, AccountHttpError);
  }
}
