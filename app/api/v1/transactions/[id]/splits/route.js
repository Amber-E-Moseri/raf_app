import {
  TransactionSplitError,
  clearTransactionSplits,
  listTransactionSplits,
  setTransactionSplits,
} from '../../../../../../lib/transactions/transactionSplits.js';

function json(body, status) {
  return Response.json(body, { status });
}

function getHouseholdId(_request, context) {
  return context?.householdId ?? null;
}

function getDb(context) {
  return context?.db ?? globalThis.__RAF_DB__;
}

export async function GET(request, context = {}) {
  try {
    const splits = await listTransactionSplits({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      transactionId: context?.params?.id,
    });
    return json({ splits }, 200);
  } catch (error) {
    if (error instanceof TransactionSplitError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: 'Internal server error' }, 500);
  }
}

export async function PUT(request, context = {}) {
  try {
    const input = await request.json();
    const splits = await setTransactionSplits({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      transactionId: context?.params?.id,
      splits: input.splits,
    });
    return json({ splits }, 200);
  } catch (error) {
    if (error instanceof TransactionSplitError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: 'Internal server error' }, 500);
  }
}

export async function POST(request, context = {}) {
  return PUT(request, context);
}

export async function DELETE(request, context = {}) {
  try {
    await clearTransactionSplits({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      transactionId: context?.params?.id,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof TransactionSplitError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: 'Internal server error' }, 500);
  }
}
