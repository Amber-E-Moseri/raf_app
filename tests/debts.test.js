import test from 'node:test';
import assert from 'node:assert/strict';

import { GET, POST } from '../app/api/v1/debts/route.js';
import { DELETE, PATCH } from '../app/api/v1/debts/[id]/route.js';
import {
  createDebt,
  deleteDebt,
  listDebts,
  updateDebt,
} from '../lib/debts/debts.js';

function createDbDouble({ debts = [], debtPayments = [] } = {}) {
  const state = {
    debts: debts.map((debt) => ({ ...debt })),
    debtPayments: debtPayments.map((payment) => ({ ...payment })),
    insertedDebt: null,
    updatedDebt: null,
    deletedDebtId: null,
  };

  const tx = {
    async insertDebt(payload) {
      state.insertedDebt = payload;
      const debt = { id: `debt_${state.debts.length + 1}`, ...payload };
      state.debts.push(debt);
      return debt;
    },
    async listDebts() {
      return [...state.debts].sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }

        return left.name.localeCompare(right.name);
      });
    },
    async listDebtPayments({ debtId }) {
      if (debtId) {
        return state.debtPayments.filter((payment) => payment.debtId === debtId);
      }

      return [...state.debtPayments];
    },
    async getDebtById({ debtId }) {
      return state.debts.find((debt) => debt.id === debtId) ?? null;
    },
    async updateDebt({ debtId, patch }) {
      const index = state.debts.findIndex((debt) => debt.id === debtId);
      state.debts[index] = {
        ...state.debts[index],
        ...patch,
      };
      state.updatedDebt = state.debts[index];
      return state.debts[index];
    },
    async countDebtPaymentsForDebt({ debtId }) {
      return state.debtPayments.filter((payment) => payment.debtId === debtId).length;
    },
    async deleteDebt({ debtId }) {
      state.deletedDebtId = debtId;
      state.debts = state.debts.filter((debt) => debt.id !== debtId);
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

test('createDebt creates a debt and returns money values as decimal strings', async () => {
  const db = createDbDouble();

  const result = await createDebt({
    db,
    householdId: 'household_1',
    input: {
      name: 'Visa',
      startingBalance: '5000',
      apr: '19.99',
      minimumPayment: '100',
      monthlyPayment: '250',
      sortOrder: 3,
    },
  });

  assert.equal(result.id, 'debt_1');
  assert.equal(result.startingBalance, '5000.00');
  assert.equal(result.currentBalance, '5000.00');
  assert.equal(result.minimumPayment, '100.00');
  assert.equal(result.monthlyPayment, '250.00');
  assert.equal(result.apr, 19.99);
  assert.equal(result.status, 'current');
});

test('updateDebt patches editable fields and keeps currentBalance derived from payments', async () => {
  const db = createDbDouble({
    debts: [
      {
        id: 'debt_1',
        householdId: 'household_1',
        name: 'Visa',
        startingBalance: '5000.00',
        apr: 19.99,
        minimumPayment: '100.00',
        monthlyPayment: '200.00',
        sortOrder: 1,
        isActive: true,
      },
    ],
    debtPayments: [
      {
        debtId: 'debt_1',
        paymentDate: '2026-03-12',
        amount: '250.00',
      },
    ],
  });

  const result = await updateDebt({
    db,
    householdId: 'household_1',
    debtId: 'debt_1',
    input: {
      monthlyPayment: '300.00',
      isActive: false,
    },
  });

  assert.equal(result.monthlyPayment, '300.00');
  assert.equal(result.isActive, false);
  assert.equal(result.currentBalance, '4750.00');
});

test('listDebts derives currentBalance and returns summary totals from live payment rows', async () => {
  const db = createDbDouble({
    debts: [
      {
        id: 'debt_1',
        householdId: 'household_1',
        name: 'Visa',
        startingBalance: '5000.00',
        apr: 19.99,
        minimumPayment: '100.00',
        monthlyPayment: '200.00',
        sortOrder: 1,
        isActive: true,
      },
      {
        id: 'debt_2',
        householdId: 'household_1',
        name: 'Line of Credit',
        startingBalance: '2000.00',
        apr: 8.25,
        minimumPayment: '50.00',
        monthlyPayment: '150.00',
        sortOrder: 2,
        isActive: true,
      },
    ],
    debtPayments: [
      { debtId: 'debt_1', paymentDate: '2026-03-12', amount: '200.00' },
      { debtId: 'debt_1', paymentDate: '2026-03-26', amount: '300.00' },
      { debtId: 'debt_2', paymentDate: '2026-03-15', amount: '2000.00' },
    ],
  });

  const result = await listDebts({
    db,
    householdId: 'household_1',
  });

  assert.deepEqual(result.summary, {
    totalStarting: '7000.00',
    totalRemaining: '4500.00',
    totalPaidAllTime: '2500.00',
  });
  assert.equal(result.items[0].currentBalance, '4500.00');
  assert.equal(result.items[1].currentBalance, '0.00');
  assert.equal(result.items[1].status, 'paid_off');
});

test('deleteDebt blocks deletion when linked payments exist and suggests soft disable', async () => {
  const db = createDbDouble({
    debts: [
      {
        id: 'debt_1',
        householdId: 'household_1',
        name: 'Visa',
        startingBalance: '5000.00',
        apr: 19.99,
        minimumPayment: '100.00',
        monthlyPayment: '200.00',
        sortOrder: 1,
        isActive: true,
      },
    ],
    debtPayments: [
      { debtId: 'debt_1', paymentDate: '2026-03-12', amount: '200.00' },
    ],
  });

  await assert.rejects(
    () =>
      deleteDebt({
        db,
        householdId: 'household_1',
        debtId: 'debt_1',
      }),
    /set isActive=false instead/,
  );
});

test('createDebt rejects invalid negative money values', async () => {
  const db = createDbDouble();

  await assert.rejects(
    () =>
      createDebt({
        db,
        householdId: 'household_1',
        input: {
          name: 'Visa',
          startingBalance: '-5000.00',
          apr: '19.99',
          minimumPayment: '100.00',
          monthlyPayment: '200.00',
        },
      }),
    /startingBalance must be a non-negative decimal with up to 2 places/,
  );
});

test('updateDebt rejects manual edits to currentBalance as a business rule violation', async () => {
  const db = createDbDouble({
    debts: [
      {
        id: 'debt_1',
        householdId: 'household_1',
        name: 'Visa',
        startingBalance: '5000.00',
        apr: 19.99,
        minimumPayment: '100.00',
        monthlyPayment: '200.00',
        sortOrder: 1,
        isActive: true,
      },
    ],
  });

  await assert.rejects(
    () =>
      updateDebt({
        db,
        householdId: 'household_1',
        debtId: 'debt_1',
        input: {
          currentBalance: '4000.00',
        },
      }),
    /currentBalance is a derived or immutable balance field and cannot be edited/,
  );
});

test('debt routes cover POST, GET, PATCH, and DELETE', async () => {
  const db = createDbDouble({
    debts: [
      {
        id: 'debt_existing',
        householdId: 'household_1',
        name: 'Visa',
        startingBalance: '5000.00',
        apr: 19.99,
        minimumPayment: '100.00',
        monthlyPayment: '200.00',
        sortOrder: 1,
        isActive: true,
      },
    ],
  });

  const postResponse = await POST(
    new Request('http://localhost/api/v1/debts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        name: 'LOC',
        startingBalance: '1200.00',
        apr: '8.25',
        minimumPayment: '25.00',
        monthlyPayment: '50.00',
      }),
    }),
    { db },
  );

  assert.equal(postResponse.status, 201);

  const getResponse = await GET(
    new Request('http://localhost/api/v1/debts', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );

  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).summary.totalStarting, '6200.00');

  const patchResponse = await PATCH(
    new Request('http://localhost/api/v1/debts/debt_existing', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        monthlyPayment: '225.00',
      }),
    }),
    { db, params: { id: 'debt_existing' } },
  );

  assert.equal(patchResponse.status, 200);
  assert.equal((await patchResponse.json()).monthlyPayment, '225.00');

  const deleteResponse = await DELETE(
    new Request('http://localhost/api/v1/debts/debt_existing', {
      method: 'DELETE',
      headers: {
        'x-household-id': 'household_1',
      },
    }),
    { db, params: { id: 'debt_existing' } },
  );

  assert.equal(deleteResponse.status, 204);
});
