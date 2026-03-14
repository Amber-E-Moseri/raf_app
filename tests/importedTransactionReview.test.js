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
  goals = [],
  categories = [
    { id: 'bucket_living', slug: 'living', label: 'Living', isActive: true, sortOrder: 1 },
    { id: 'bucket_savings', slug: 'savings', label: 'Savings', isActive: true, sortOrder: 2 },
    { id: 'bucket_debt_payoff', slug: 'debt_payoff', label: 'Debt Payoff', isActive: true, sortOrder: 3 },
  ],
  importReviewRules = [],
} = {}) {
  const state = {
    importedTransactions: importedTransactions.map((row) => ({ ...row })),
    transactions: [],
    debtPayments: [],
    importReviewRules: importReviewRules.map((row) => ({ ...row })),
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
    async getGoalById({ householdId, goalId }) {
      return goals.find((row) => row.householdId === householdId && row.id === goalId) ?? null;
    },
    async listAllocationCategories({ householdId }) {
      return categories.filter((row) => row.householdId == null || row.householdId === householdId).map((row) => ({ ...row }));
    },
    async findImportReviewRuleByNormalizedDescription({ householdId, normalizedDescription }) {
      return state.importReviewRules.find(
        (row) => row.householdId === householdId && row.normalizedDescription === normalizedDescription,
      ) ?? null;
    },
    async upsertImportReviewRule(payload) {
      const index = state.importReviewRules.findIndex(
        (row) => row.householdId === payload.householdId && row.normalizedDescription === payload.normalizedDescription,
      );
      if (index >= 0) {
        state.importReviewRules[index] = {
          ...state.importReviewRules[index],
          ...payload,
          updatedAt: '2026-03-14T00:00:00.000Z',
        };
        return { ...state.importReviewRules[index] };
      }

      const row = {
        id: `rule_${state.importReviewRules.length + 1}`,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
        ...payload,
      };
      state.importReviewRules.push(row);
      return { ...row };
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
    linkedGoalId: null,
    normalizedDescription: 'coffee shop',
    reviewedAt: null,
    reviewNote: null,
    createdAt: '2026-03-13T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
    ...overrides,
  };
}

test('listing imports returns imported transactions with review status and suggestions', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow()],
    importReviewRules: [{
      id: 'rule_1',
      householdId: 'household_1',
      normalizedDescription: 'coffee shop',
      classificationType: 'transaction',
      categoryId: 'bucket_living',
      linkedDebtId: null,
      linkedFixedBillId: null,
      linkedGoalId: null,
      autoApply: false,
      createdAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    }],
  });

  const result = await listReviewedImportedTransactions({
    db,
    householdId: 'household_1',
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'unreviewed');
  assert.equal(result.items[0].suggestion?.classification_type, 'transaction');
  assert.equal(result.items[0].suggestion?.category_id, 'bucket_living');
});

test('classifying an imported row into a normal transaction creates traceable RAF data and remembers review choice', async () => {
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
      remember_choice: true,
    },
  });

  assert.equal(result.status, 'classified');
  assert.equal(result.classification_type, 'transaction');
  assert.equal(result.linked_transaction_id, 'txn_1');
  assert.equal(db.state.transactions.length, 1);
  assert.equal(db.state.transactions[0].categoryId, 'bucket_living');
  assert.equal(db.state.importReviewRules.length, 1);
  assert.equal(db.state.importReviewRules[0].normalizedDescription, 'coffee shop');
});

test('transaction approval requires an allocation bucket', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow()],
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
    /category_id is required/,
  );
});

test('classifying an imported row into a debt payment creates a linked debt payment record', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow({ amount: '-100.00', description: 'Visa payment', rawDescription: 'Visa payment', normalizedDescription: 'visa payment' })],
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
  assert.equal(db.state.transactions[0].categoryId, 'bucket_debt_payoff');
  assert.equal(db.state.importReviewRules.length, 0);
});

test('goal funding classification links the import to a goal and bucket transaction', async () => {
  const db = createDbDouble({
    importedTransactions: [importedRow({ amount: '250.00', description: 'Savings transfer', rawDescription: 'Savings transfer', normalizedDescription: 'savings transfer' })],
    goals: [{ id: 'goal_1', householdId: 'household_1', bucketId: 'bucket_savings', name: 'Emergency Fund', active: true }],
  });

  const result = await classifyImportedTransaction({
    db,
    householdId: 'household_1',
    importedTransactionId: 'import_1',
    input: {
      classification_type: 'goal_funding',
      goal_id: 'goal_1',
    },
  });

  assert.equal(result.linked_goal_id, 'goal_1');
  assert.equal(result.linked_transaction_id, 'txn_1');
  assert.equal(db.state.transactions[0].categoryId, 'bucket_savings');
});

test('duplicate and transfer review actions do not create RAF records', async () => {
  const duplicateDb = createDbDouble({
    importedTransactions: [importedRow()],
  });
  const transferDb = createDbDouble({
    importedTransactions: [importedRow({ id: 'import_2' })],
  });

  const duplicate = await classifyImportedTransaction({
    db: duplicateDb,
    householdId: 'household_1',
    importedTransactionId: 'import_1',
    input: {
      classification_type: 'duplicate',
      remember_choice: true,
    },
  });
  const transfer = await classifyImportedTransaction({
    db: transferDb,
    householdId: 'household_1',
    importedTransactionId: 'import_2',
    input: {
      classification_type: 'transfer',
    },
  });

  assert.equal(duplicate.classification_type, 'duplicate');
  assert.equal(transfer.classification_type, 'transfer');
  assert.equal(duplicateDb.state.transactions.length, 0);
  assert.equal(transferDb.state.transactions.length, 0);
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
