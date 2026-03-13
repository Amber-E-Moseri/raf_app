import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as uploadBatchRoute } from '../app/api/v1/imports/upload/route.js';
import { POST as parseBatchRoute } from '../app/api/v1/imports/parse/route.js';
import { GET as reviewBatchRoute } from '../app/api/v1/imports/[batchId]/review/route.js';
import { POST as approveBatchRoute } from '../app/api/v1/imports/[batchId]/approve/route.js';
import { POST as rejectBatchRoute } from '../app/api/v1/imports/[batchId]/reject/route.js';
import { approveImportBatch } from '../lib/imports/approveImportBatch.js';
import { parseImportBatch } from '../lib/imports/parseImportBatch.js';
import { rejectImportBatch } from '../lib/imports/rejectImportBatch.js';
import { reviewImportBatch } from '../lib/imports/reviewImportBatch.js';
import { updateImportedRow } from '../lib/imports/updateImportedRow.js';
import { uploadImportBatch } from '../lib/imports/uploadImportBatch.js';

function createDbDouble({ batch, rows, merchantRules = [], duplicateTransaction = null, debt = null } = {}) {
  const state = {
    batch: { ...(batch ?? { id: 'batch_1', status: 'uploaded', filename: 'test.csv', rowCount: null }) },
    rows: (rows ?? []).map((row) => ({ ...row })),
    updatedBatchCalls: [],
    insertedTransactions: [],
    insertedDebtPayments: [],
    insertedBatches: [],
    insertedRows: [],
  };

  const tx = {
    async insertImportBatch(payload) {
      const batchRow = {
        id: `batch_${state.insertedBatches.length + 1}`,
        ...payload,
      };
      state.insertedBatches.push(batchRow);
      state.batch = batchRow;
      return batchRow;
    },
    async insertImportedRows({ rows: rowPayloads }) {
      const inserted = rowPayloads.map((row, index) => ({
        id: `row_${state.rows.length + index + 1}`,
        ...row,
      }));
      state.insertedRows.push(...inserted);
      state.rows.push(...inserted);
      return inserted;
    },
    async getImportBatch() {
      return state.batch;
    },
    async updateImportBatch({ status, rowCount }) {
      state.updatedBatchCalls.push({ status, rowCount: rowCount ?? null });
      state.batch = {
        ...state.batch,
        status: status ?? state.batch.status,
        rowCount: rowCount ?? state.batch.rowCount,
      };
      return state.batch;
    },
    async listImportedRows() {
      return state.rows;
    },
    async listMerchantRules() {
      return merchantRules;
    },
    async findDuplicateTransaction() {
      return duplicateTransaction;
    },
    async updateImportedRow({ rowId, patch }) {
      const index = state.rows.findIndex((row) => row.id === rowId);
      state.rows[index] = {
        ...state.rows[index],
        ...patch,
      };
      return state.rows[index];
    },
    async getImportedRow({ rowId }) {
      return state.rows.find((row) => row.id === rowId) ?? null;
    },
    async findDebtById() {
      return debt;
    },
    async insertTransaction(payload) {
      state.insertedTransactions.push(payload);
      return { id: `txn_${state.insertedTransactions.length}` };
    },
    async insertDebtPayment(payload) {
      state.insertedDebtPayments.push(payload);
      return { id: `dp_${state.insertedDebtPayments.length}` };
    },
  };

  return {
    state,
    async transaction(callback) {
      return callback(tx);
    },
  };
}

test('uploadImportBatch creates an upload batch and stores raw row metadata from CSV', async () => {
  const db = createDbDouble();

  const result = await uploadImportBatch({
    db,
    householdId: 'household_1',
    input: {
      filename: 'test.csv',
      text: 'Date,Description,Merchant,Amount\n2026-03-10,Coffee Shop,Coffee Shop,12.99\n',
    },
  });

  assert.deepEqual(result, {
    batchId: 'batch_1',
    filename: 'test.csv',
    rowCount: 1,
  });
  assert.deepEqual(db.state.insertedRows[0].rawData, {
    Date: '2026-03-10',
    Description: 'Coffee Shop',
    Merchant: 'Coffee Shop',
    Amount: '12.99',
  });
});

test('parseImportBatch parses uploaded rawData with explicit mapping, applies merchant suggestions, and flags duplicates', async () => {
  const db = createDbDouble({
    rows: [
      {
        id: 'row_1',
        rawData: {
          Date: '2026-03-10',
          Description: 'Coffee Shop',
          Merchant: 'Coffee Shop',
          Amount: '12.99',
        },
      },
    ],
    merchantRules: [
      {
        id: 'rule_1',
        matchType: 'contains',
        matchValue: 'coffee',
        categoryId: 'cat_food',
        priority: 5,
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ],
    duplicateTransaction: { id: 'txn_existing' },
  });

  const result = await parseImportBatch({
    db,
    householdId: 'household_1',
    batchId: 'batch_1',
    input: {
      batchId: 'batch_1',
      columnMap: { date: 'Date', description: 'Description', amount: 'Amount', merchant: 'Merchant' },
    },
  });

  assert.deepEqual(result, {
    batchId: 'batch_1',
    rows: [
      {
        id: 'row_1',
        rawDate: '2026-03-10',
        rawDescription: 'Coffee Shop',
        rawMerchant: 'Coffee Shop',
        rawAmount: '12.99',
        rawDirection: null,
        parsedDate: '2026-03-10',
        parsedDescription: 'Coffee Shop',
        parsedMerchant: 'Coffee Shop',
        parsedAmount: '12.99',
        parsedDirection: 'debit',
        suggestedCategoryId: 'cat_food',
        suggestedDebtId: null,
        suggestedByRuleId: 'rule_1',
        suggestionReason: 'merchant_rule:contains:coffee',
        duplicateOfId: 'txn_existing',
        duplicateReason: 'matched_existing_transaction:txn_existing',
        status: 'duplicate',
      },
    ],
  });
});

test('reviewImportBatch returns batch info, parsed rows, suggestions, duplicate flags, and statuses', async () => {
  const db = createDbDouble({
    batch: { id: 'batch_1', status: 'review', filename: 'test.csv', rowCount: 1 },
    rows: [
      {
        id: 'row_1',
        rawDate: '2026-03-10',
        rawDescription: 'Coffee Shop',
        rawMerchant: 'Coffee Shop',
        rawAmount: '12.99',
        rawDirection: null,
        parsedDate: '2026-03-10',
        parsedDescription: 'Coffee Shop',
        parsedMerchant: 'Coffee Shop',
        parsedAmount: '12.99',
        parsedDirection: 'debit',
        suggestedCategoryId: 'cat_food',
        suggestedDebtId: null,
        suggestedByRuleId: 'rule_1',
        suggestionReason: 'merchant_rule:contains:coffee',
        duplicateOfId: 'txn_existing',
        duplicateReason: 'matched_existing_transaction:txn_existing',
        status: 'duplicate',
      },
    ],
  });

  const result = await reviewImportBatch({
    db,
    householdId: 'household_1',
    batchId: 'batch_1',
  });

  assert.deepEqual(result, {
    batchId: 'batch_1',
    filename: 'test.csv',
    status: 'review',
    rowCount: 1,
    rows: [
      {
        id: 'row_1',
        rawDate: '2026-03-10',
        rawDescription: 'Coffee Shop',
        rawMerchant: 'Coffee Shop',
        rawAmount: '12.99',
        rawDirection: null,
        parsedDate: '2026-03-10',
        parsedDescription: 'Coffee Shop',
        parsedMerchant: 'Coffee Shop',
        parsedAmount: '12.99',
        parsedDirection: 'debit',
        suggestedCategoryId: 'cat_food',
        suggestedDebtId: null,
        suggestedByRuleId: 'rule_1',
        suggestionReason: 'merchant_rule:contains:coffee',
        duplicateOfId: 'txn_existing',
        duplicateReason: 'matched_existing_transaction:txn_existing',
        status: 'duplicate',
      },
    ],
  });
});

test('approveImportBatch inserts approved non-duplicate transactions only', async () => {
  const db = createDbDouble({
    batch: { id: 'batch_1', status: 'review', filename: 'test.csv', rowCount: 3 },
    rows: [
      {
        id: 'row_approved',
        parsedDate: '2026-03-10',
        parsedDescription: 'Coffee Shop',
        parsedMerchant: 'Coffee Shop',
        parsedAmount: '12.99',
        parsedDirection: 'debit',
        suggestedCategoryId: 'cat_food',
        suggestedDebtId: null,
        status: 'approved',
      },
      {
        id: 'row_duplicate',
        parsedDate: '2026-03-11',
        parsedDescription: 'Duplicate',
        parsedMerchant: 'Bank',
        parsedAmount: '100.00',
        parsedDirection: 'debit',
        suggestedCategoryId: 'cat_food',
        suggestedDebtId: null,
        duplicateOfId: 'txn_existing',
        duplicateReason: 'matched_existing_transaction:txn_existing',
        status: 'duplicate',
      },
      {
        id: 'row_skipped',
        parsedDate: '2026-03-12',
        parsedDescription: 'Pending row',
        parsedMerchant: 'Other',
        parsedAmount: '9.00',
        parsedDirection: 'debit',
        suggestedCategoryId: 'cat_misc',
        suggestedDebtId: null,
        status: 'pending',
      },
    ],
  });

  const result = await approveImportBatch({
    db,
    householdId: 'household_1',
    batchId: 'batch_1',
  });

  assert.deepEqual(result, {
    inserted: 1,
    skipped: 1,
    duplicates: 1,
  });
  assert.equal(db.state.insertedTransactions.length, 1);
});

test('approved debt-linked rows create debt payments in the same transaction', async () => {
  const db = createDbDouble({
    batch: { id: 'batch_1', status: 'review', filename: 'test.csv', rowCount: 1 },
    debt: { id: 'debt_1', name: 'Visa' },
    rows: [
      {
        id: 'row_debt',
        parsedDate: '2026-03-11',
        parsedDescription: 'Visa payment',
        parsedMerchant: 'Bank',
        parsedAmount: '100.00',
        parsedDirection: 'debit',
        suggestedCategoryId: null,
        suggestedDebtId: 'debt_1',
        status: 'approved',
      },
    ],
  });

  await approveImportBatch({
    db,
    householdId: 'household_1',
    batchId: 'batch_1',
  });

  assert.deepEqual(db.state.insertedDebtPayments, [
    {
      householdId: 'household_1',
      debtId: 'debt_1',
      transactionId: 'txn_1',
      paymentDate: '2026-03-11',
      amount: '100.00',
    },
  ]);
});

test('rejectImportBatch marks rows rejected without creating transactions', async () => {
  const db = createDbDouble({
    batch: { id: 'batch_1', status: 'review', filename: 'test.csv', rowCount: 2 },
    rows: [
      { id: 'row_1', status: 'pending' },
      { id: 'row_2', status: 'approved' },
    ],
  });

  const result = await rejectImportBatch({
    db,
    householdId: 'household_1',
    batchId: 'batch_1',
  });

  assert.deepEqual(result, {
    batchId: 'batch_1',
    rejected: 2,
  });
  assert.equal(db.state.insertedTransactions.length, 0);
  assert.deepEqual(db.state.rows.map((row) => row.status), ['rejected', 'rejected']);
});

test('updateImportedRow updates review decisions', async () => {
  const db = createDbDouble({
    batch: { id: 'batch_1', status: 'review', filename: 'test.csv', rowCount: 1 },
    rows: [
      {
        id: 'row_1',
        parsedDate: '2026-03-10',
        parsedDescription: 'Coffee Shop',
        parsedMerchant: 'Coffee Shop',
        parsedAmount: '12.99',
        parsedDirection: 'debit',
        suggestedCategoryId: null,
        suggestedDebtId: null,
        status: 'pending',
      },
    ],
  });

  const result = await updateImportedRow({
    db,
    householdId: 'household_1',
    rowId: 'row_1',
    input: {
      categoryId: 'cat_food',
      status: 'approved',
    },
  });

  assert.equal(result.status, 'approved');
  assert.equal(result.suggestedCategoryId, 'cat_food');
});

test('import routes expose upload, parse, review, approve, and reject workflow', async () => {
  const db = createDbDouble();

  const formData = new FormData();
  formData.set(
    'file',
    new File(
      ['Date,Description,Merchant,Amount\n2026-03-10,Coffee Shop,Coffee Shop,12.99\n'],
      'test.csv',
      { type: 'text/csv' },
    ),
  );

  const uploadResponse = await uploadBatchRoute(
    new Request('http://localhost/api/v1/imports/upload', {
      method: 'POST',
      headers: {
        'x-household-id': 'household_1',
      },
      body: formData,
    }),
    { db },
  );
  assert.equal(uploadResponse.status, 200);

  const parseResponse = await parseBatchRoute(
    new Request('http://localhost/api/v1/imports/parse', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-household-id': 'household_1',
      },
      body: JSON.stringify({
        batchId: 'batch_1',
        columnMap: { date: 'Date', description: 'Description', amount: 'Amount', merchant: 'Merchant' },
      }),
    }),
    { db },
  );
  assert.equal(parseResponse.status, 200);

  await updateImportedRow({
    db,
    householdId: 'household_1',
    rowId: 'row_1',
    input: { categoryId: 'cat_food', status: 'approved' },
  });

  const reviewResponse = await reviewBatchRoute(
    new Request('http://localhost/api/v1/imports/batch_1/review', {
      headers: { 'x-household-id': 'household_1' },
    }),
    { db, params: { batchId: 'batch_1' } },
  );
  assert.equal(reviewResponse.status, 200);

  const approveResponse = await approveBatchRoute(
    new Request('http://localhost/api/v1/imports/batch_1/approve', {
      method: 'POST',
      headers: { 'x-household-id': 'household_1' },
    }),
    { db, params: { batchId: 'batch_1' } },
  );
  assert.equal(approveResponse.status, 200);
  assert.deepEqual(await approveResponse.json(), {
    inserted: 1,
    skipped: 0,
    duplicates: 0,
  });

  const rejectDb = createDbDouble({
    batch: { id: 'batch_2', status: 'review', filename: 'other.csv', rowCount: 1 },
    rows: [{ id: 'row_1', status: 'pending' }],
  });

  const rejectResponse = await rejectBatchRoute(
    new Request('http://localhost/api/v1/imports/batch_2/reject', {
      method: 'POST',
      headers: { 'x-household-id': 'household_1' },
    }),
    { db: rejectDb, params: { batchId: 'batch_2' } },
  );
  assert.equal(rejectResponse.status, 200);
  assert.deepEqual(await rejectResponse.json(), {
    batchId: 'batch_2',
    rejected: 1,
  });
});
