import test from 'node:test';
import assert from 'node:assert/strict';

import { GET as getImportRoute } from '../app/api/v1/imports/[id]/route.js';
import { POST as classifyImportRoute } from '../app/api/v1/imports/[id]/classify/route.js';
import { POST as ignoreImportRoute } from '../app/api/v1/imports/[id]/ignore/route.js';
import { GET as listImportsRoute } from '../app/api/v1/imports/route.js';
import {
  classifyImportedTransaction,
  getImportedTransaction,
  ignoreImportedTransaction,
  listReviewedImportedTransactions,
} from '../lib/imports/reviewImportedTransactions.js';

function createDbDouble({
  importedTransactions = [],
  debts = [],
  fixedBills = [],
  categories = [
    { id: 'bucket_living', slug: 'living', label: 'Living', isActive: true, sortOrder: 1 },
  ],
} = {}) {
  const state = {
    importedTransactions: importedTransactions.map((row) => ({ ...row })),
    transactions: [],
    debtPayments: [],
  };

  const tx = {
    async listImportedTransactions({ householdId }) {
      return state.importedTransactions.filter((row) => row.householdId === householdId).map((row) => ({ ...row }));
    },
    async getImportedTransactionById({ householdId, importedTransactionId }) {
      return state.importedTransactions.find((row) => row.householdId === householdId && row.id === importedTransactionId) ?? null;
    },
    async updateImportedTransaction({ householdId, importedTransactionId, patch }) {
      const index = state.importedTransactions.findIndex((row) => row.householdId === householdId && row.id === importedTransactionId);
      state.importedTransactions[index] = {
        ...state.importedTransactions[index],
        ...patch,
        updatedAt: '2026-03-14T00:00:00.000Z',
      };
      return { ...state.importedTransactions[index] };
    },
    async insertTransaction(payload) {
      const row = { id: `txn_${state.transactions.length + 1}`, ...payload };
      state.transactions.push(row);
      return { ...row };
    },
    async insertDebtPayment(payload) {
      const row = { id: `dp_${state.debtPayments.length + 1}`, ...payload };
      state.debtPayments.push(row);
      return { ...row };
    },
    async getDebtById({ householdId, debtId }) {
      return debts.find((row) => row.householdId === householdId && row.id === debtId) ?? null;
    },
    async getFixedBillById({ householdId, fixedBillId }) {
      return fixedBills.find((row) => row.householdId === householdId && row.id === fixedBillId) ?? null;
    },
    async listAllocationCategories({ householdId }) {
      return categories.filter((row) => row.householdId == null || row.householdId === householdId).map((row) => ({ ...row }));
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

function importedRow(overrides = {}) {
  return {
    id: 'import_1',
    householdId: 'household_1',
    date: '2026-03-10',
    description: 'Coffee Shop',
    amount: '-12.99',
    currency: 'USD',
    source: 'bank_import',
    rawDescription: 'Coffee Shop',
    referenceNumber: null,
    balanceAfterTransaction: null,
    status: 'unreviewed',
    classificationType: null,
    linkedTransactionId: null,
    linkedDebtId: null,
    linkedFixedBillId: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: '2026-03-13T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
    ...overrides,
  };
}

test('listing imports returns imported transactions with review status', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow()],
  });

  const result = await listReviewedImportedTransactions({
    db,
    householdId: 'household_1',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'unreviewed');
});

test('classifying an imported row into a normal transaction creates traceable RAF data', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow()],
  });

  const result = await classifyImportedTransaction({
    db,
    householdId: 'household_1',
    importedTransactionId: 'import_1',
    input: {
      classification_type: 'transaction',
      category_id: 'bucket_living',
      review_note: 'Reviewed as spending',
    },
  });

  assert.equal(result.status, 'classified');
  assert.equal(result.classification_type, 'transaction');
  assert.equal(result.linked_transaction_id, 'txn_1');
  assert.equal(db.state.transactions.length, 1);
  assert.equal(db.state.transactions[0].categoryId, 'bucket_living');
});

test('classifying an imported row into a debt payment creates a linked debt payment record', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow({ amount: '-100.00', description: 'Visa payment' })],
    debts: [{ id: 'debt_1', householdId: 'household_1', name: 'Visa' }],
  });

  const result = await classifyImportedTransaction({
    db,
    householdId: 'household_1',
    importedTransactionId: 'import_1',
    input: {
      classification_type: 'debt_payment',
      debt_id: 'debt_1',
    },
  });

  assert.equal(result.linked_debt_id, 'debt_1');
  assert.equal(result.linked_transaction_id, 'txn_1');
  assert.equal(db.state.debtPayments.length, 1);
  assert.equal(db.state.debtPayments[0].debtId, 'debt_1');
});

test('ignoring an imported row marks it ignored without creating RAF records', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow()],
  });

  const result = await ignoreImportedTransaction({
    db,
    householdId: 'household_1',
    importedTransactionId: 'import_1',
    input: {
      review_note: 'Not relevant',
    },
  });

  assert.equal(result.status, 'ignored');
  assert.equal(result.classification_type, 'ignore');
  assert.equal(db.state.transactions.length, 0);
});

test('duplicate classification is prevented', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow({ status: 'classified', classificationType: 'transaction', linkedTransactionId: 'txn_existing' })],
  });

  await assert.rejects(
    () => classifyImportedTransaction({
      db,
      householdId: 'household_1',
      importedTransactionId: 'import_1',
      input: {
        classification_type: 'transaction',
      },
    }),
    /already been reviewed/,
  );
});

test('imported transaction review respects household scoping', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow({ householdId: 'household_2' })],
  });

  await assert.rejects(
    () => getImportedTransaction({
      db,
      householdId: 'household_1',
      importedTransactionId: 'import_1',
    }),
    /not found/,
  );
});

test('fixed bill payment classification traces to both transaction and fixed bill', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow({ amount: '-80.00', description: 'Phone bill' })],
    fixedBills: [{ id: 'bill_1', householdId: 'household_1', name: 'Phone', categorySlug: 'living' }],
  });

  const result = await classifyImportedTransaction({
    db,
    householdId: 'household_1',
    importedTransactionId: 'import_1',
    input: {
      classification_type: 'fixed_bill_payment',
      fixed_bill_id: 'bill_1',
    },
  });

  assert.equal(result.linked_fixed_bill_id, 'bill_1');
  assert.equal(result.linked_transaction_id, 'txn_1');
  assert.equal(db.state.transactions[0].categoryId, 'bucket_living');
});

test('import review routes expose list, single fetch, classify, and ignore', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow()],
    debts: [{ id: 'debt_1', householdId: 'household_1', name: 'Visa' }],
  });

  const listResponse = await listImportsRoute(
    new Request('http://localhost/api/v1/imports', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db },
  );
  assert.equal(listResponse.status, 200);

  const getResponse = await getImportRoute(
    new Request('http://localhost/api/v1/imports/import_1', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db, params: { id: 'import_1' } },
  );
  assert.equal(getResponse.status, 200);

  const classifyResponse = await classifyImportRoute(
    new Request('http://localhost/api/v1/imports/import_1/classify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        classification_type: 'debt_payment',
        debt_id: 'debt_1',
      }),
    }),
    { db, params: { id: 'import_1' } },
  );
  assert.equal(classifyResponse.status, 200);

  const ignoreDb = createDbDouble({
    importedTransactions: [importedRow()],
  });

  const ignoreResponse = await ignoreImportRoute(
    new Request('http://localhost/api/v1/imports/import_1/ignore', {
      method: 'POST',
      headers: { 'x-household-id': 'household_1' },
      body: JSON.stringify({ review_note: 'ignore' }),
    }),
    { db: ignoreDb, params: { id: 'import_1' } },
  );
  assert.equal(ignoreResponse.status, 200);
});
