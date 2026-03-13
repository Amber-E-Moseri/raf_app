import { TransactionHttpError, deleteTransaction, updateTransaction } from '../../../../../lib/transactions/createTransaction.js';

function json(body, status) {
  return Response.json(body, { status });
}

function getHouseholdId(request, context) {
  return (
    context?.householdId ??
    request.headers.get('x-household-id') ??
    request.headers.get('x-household_id')
  );
}

function getDb(context) {
  return context?.db ?? globalThis.__RAF_DB__;
}

export async function PATCH(request, context = {}) {
  try {
    const input = await request.json();
    const transaction = await updateTransaction({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      transactionId: context?.params?.id,
      input,
    });

    return json(transaction, 200);
  } catch (error) {
    if (error instanceof TransactionHttpError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: 'Internal Server Error' }, 500);
  }
}

export async function DELETE(request, context = {}) {
  try {
    await deleteTransaction({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      transactionId: context?.params?.id,
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof TransactionHttpError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: 'Internal Server Error' }, 500);
  }
}
