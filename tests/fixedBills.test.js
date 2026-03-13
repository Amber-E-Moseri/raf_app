import test from 'node:test';
import assert from 'node:assert/strict';

import { GET, POST } from '../app/api/v1/household/fixed-bills/route.js';
import { DELETE, PUT } from '../app/api/v1/household/fixed-bills/[id]/route.js';
import {
  createFixedBill,
  deleteFixedBill,
  listFixedBills,
  updateFixedBill,
} from '../lib/household/fixedBills.js';

function createDbDouble({
  allocationCategories = [
    { id: 'cat_bills', slug: 'fixed_bills', isActive: true },
    { id: 'cat_spending', slug: 'personal_spending', isActive: true },
  ],
  fixedBills = [],
} = {}) {
  const state = {
    allocationCategories: allocationCategories.map((row) => ({ ...row })),
    fixedBills: fixedBills.map((row) => ({ ...row })),
  };

  const tx = {
    async listAllocationCategories() {
      return state.allocationCategories.map((row) => ({ ...row }));
    },
    async listFixedBills() {
      return state.fixedBills.map((row) => ({ ...row }));
    },
    async insertFixedBill(payload) {
      const created = {
        id: `bill_${state.fixedBills.length + 1}`,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
        ...payload,
      };
      state.fixedBills.push(created);
      return { ...created };
    },
    async getFixedBillById({ fixedBillId }) {
      return state.fixedBills.find((row) => row.id === fixedBillId) ?? null;
    },
    async updateFixedBill({ fixedBillId, patch }) {
      const index = state.fixedBills.findIndex((row) => row.id === fixedBillId);
      state.fixedBills[index] = {
        ...state.fixedBills[index],
        ...patch,
        updatedAt: '2026-03-14T00:00:00.000Z',
      };
      return { ...state.fixedBills[index] };
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

test('creating a fixed bill stores the household-scoped configuration row', async () => {
  const db = createDbDouble();

  const result = await createFixedBill({
    db,
    householdId: 'household_1',
    input: {
      name: 'Rent',
      category_slug: 'fixed_bills',
      expected_amount: '1800.00',
      due_day_of_month: 1,
      active: true,
    },
  });

  assert.deepEqual(result, {
    id: 'bill_1',
    household_id: 'household_1',
    name: 'Rent',
    category_slug: 'fixed_bills',
    expected_amount: '1800.00',
    due_day_of_month: 1,
    active: true,
    created_at: '2026-03-13T00:00:00.000Z',
    updated_at: '2026-03-13T00:00:00.000Z',
  });
});

test('editing a fixed bill updates editable fields', async () => {
  const db = createDbDouble({
    fixedBills: [
      {
        id: 'bill_1',
        householdId: 'household_1',
        name: 'Internet',
        categorySlug: 'fixed_bills',
        expectedAmount: '90.00',
        dueDayOfMonth: 15,
        active: true,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ],
  });

  const result = await updateFixedBill({
    db,
    householdId: 'household_1',
    fixedBillId: 'bill_1',
    input: {
      expected_amount: '95.00',
      due_day_of_month: 18,
    },
  });

  assert.equal(result.expected_amount, '95.00');
  assert.equal(result.due_day_of_month, 18);
});

test('deleting a fixed bill deactivates it instead of removing it', async () => {
  const db = createDbDouble({
    fixedBills: [
      {
        id: 'bill_1',
        householdId: 'household_1',
        name: 'Phone',
        categorySlug: 'fixed_bills',
        expectedAmount: '70.00',
        dueDayOfMonth: 5,
        active: true,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ],
  });

  await deleteFixedBill({
    db,
    householdId: 'household_1',
    fixedBillId: 'bill_1',
  });

  assert.equal(db.state.fixedBills[0].active, false);
});

test('fixed bill validation rejects invalid due days and category slugs', async () => {
  const db = createDbDouble({
    allocationCategories: [{ id: 'cat_spending', slug: 'personal_spending', isActive: false }],
  });

  await assert.rejects(
    () => createFixedBill({
      db,
      householdId: 'household_1',
      input: {
        name: 'Bad Bill',
        category_slug: 'personal_spending',
        expected_amount: '15.00',
        due_day_of_month: 32,
        active: true,
      },
    }),
    /due_day_of_month/,
  );

  await assert.rejects(
    () => createFixedBill({
      db,
      householdId: 'household_1',
      input: {
        name: 'Bad Category',
        category_slug: 'personal_spending',
        expected_amount: '15.00',
        due_day_of_month: 12,
        active: true,
      },
    }),
    /category_slug must reference an active allocation category/,
  );
});

test('fixed bill routes expose GET, POST, PUT, and DELETE', async () => {
  const db = createDbDouble();

  const postResponse = await POST(
    new Request('http://localhost/api/v1/household/fixed-bills', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        name: 'Utilities',
        category_slug: 'fixed_bills',
        expected_amount: '120.00',
        due_day_of_month: 20,
        active: true,
      }),
    }),
    { db },
  );
  assert.equal(postResponse.status, 201);

  const getResponse = await GET(
    new Request('http://localhost/api/v1/household/fixed-bills', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).items.length, 1);

  const putResponse = await PUT(
    new Request('http://localhost/api/v1/household/fixed-bills/bill_1', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        expected_amount: '130.00',
      }),
    }),
    { db, params: { id: 'bill_1' } },
  );
  assert.equal(putResponse.status, 200);

  const deleteResponse = await DELETE(
    new Request('http://localhost/api/v1/household/fixed-bills/bill_1', {
      method: 'DELETE',
      headers: { 'x-household-id': 'household_1' },
    }),
    { db, params: { id: 'bill_1' } },
  );
  assert.equal(deleteResponse.status, 204);

  const listed = await listFixedBills({ db, householdId: 'household_1' });
  assert.equal(listed.items[0].active, false);
});
