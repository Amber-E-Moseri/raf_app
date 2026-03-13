import {
  FixedBillHttpError,
  createFixedBill,
  listFixedBills,
} from '../../../../../lib/household/fixedBills.js';

function json(body, status) {
  return Response.json(body, { status });
}

function getHouseholdId(request, context) {
  return context?.householdId ?? request.headers.get('x-household-id') ?? request.headers.get('x-household_id');
}

function getDb(context) {
  return context?.db ?? globalThis.__RAF_DB__;
}

export async function GET(request, context = {}) {
  try {
    const result = await listFixedBills({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
    });

    return json(result, 200);
  } catch (error) {
    if (error instanceof FixedBillHttpError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: 'Internal Server Error' }, 500);
  }
}

export async function POST(request, context = {}) {
  try {
    const input = await request.json();
    const result = await createFixedBill({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      input,
    });

    return json(result, 201);
  } catch (error) {
    if (error instanceof FixedBillHttpError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: 'Internal Server Error' }, 500);
  }
}
