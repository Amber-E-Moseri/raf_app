import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POST as createAccountRoute,
  GET as listAccountsRoute,
} from '../app/api/v1/financial-accounts/route.js';
import { PATCH as patchAccountRoute } from '../app/api/v1/financial-accounts/[accountId]/route.js';
import {
  POST as createReconciliationRoute,
  GET as listReconciliationsRoute,
} from '../app/api/v1/financial-accounts/[accountId]/reconciliations/route.js';
import { PATCH as resolveReconciliationRoute } from '../app/api/v1/financial-accounts/[accountId]/reconciliations/[reconciliationId]/route.js';
import { createInMemoryDb } from '../lib/server/inMemoryDb.js';
import { createTransaction } from '../lib/transactions/createTransaction.js';
import { approveImportBatch } from '../lib/imports/approveImportBatch.js';
import { classifyImportedTransaction } from '../lib/imports/reviewImportedTransactions.js';
import { uploadImportBatch } from '../lib/imports/uploadImportBatch.js';

function jsonRequest(pathname, body) {
  return new Request(`http://localhost/api/v1${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-household-id': 'household_1',
    },
    body: JSON.stringify(body),
  });
}

test('financial account routes create, list, and update workspace-owned accounts', async () => {
  const db = createInMemoryDb();

  const createResponse = await createAccountRoute(jsonRequest('/financial-accounts', {
    name: 'Everyday Checking',
    account_type: 'checking',
    institution: 'BMO',
    currency: 'cad',
    current_balance: '1250.45',
    available_balance: '1200.00',
    balance_as_of: '2026-03-10T12:00:00.000Z',
  }), { db, householdId: 'household_1' });

  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.workspace_id, 'household_1');
  assert.equal(created.account_type, 'checking');
  assert.equal(created.currency, 'CAD');
  assert.equal(created.current_balance, '1250.45');

  const listResponse = await listAccountsRoute(
    new Request('http://localhost/api/v1/financial-accounts', { headers: { 'x-household-id': 'household_1' } }),
    { db, householdId: 'household_1' },
  );
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).items.length, 1);

  const patchResponse = await patchAccountRoute(jsonRequest('/financial-accounts/account_1', {
    name: 'Main Checking',
    status: 'active',
  }), { db, householdId: 'household_1', params: { accountId: created.id } });
  assert.equal(patchResponse.status, 200);
  assert.equal((await patchResponse.json()).name, 'Main Checking');
});

test('transactions can be associated to active accounts and reject cross-workspace account ids', async () => {
  const db = createInMemoryDb();
  const account = await db.transaction((tx) => tx.insertFinancialAccount({
    householdId: 'household_1',
    workspaceId: 'household_1',
    name: 'Everyday Checking',
    accountType: 'checking',
    institution: null,
    currency: 'CAD',
    currentBalance: '100.00',
    availableBalance: null,
    balanceAsOf: '2026-03-10T00:00:00.000Z',
    isManual: true,
    status: 'active',
  }));
  const otherAccount = await db.transaction((tx) => tx.insertFinancialAccount({
    householdId: 'household_2',
    workspaceId: 'household_2',
    name: 'Other Checking',
    accountType: 'checking',
    institution: null,
    currency: 'CAD',
    currentBalance: '100.00',
    availableBalance: null,
    balanceAsOf: '2026-03-10T00:00:00.000Z',
    isManual: true,
    status: 'active',
  }));

  const transaction = await createTransaction({
    db,
    householdId: 'household_1',
    input: {
      accountId: account.id,
      transactionDate: '2026-03-10',
      description: 'Coffee Shop',
      merchant: 'Coffee Shop',
      amount: '12.99',
      direction: 'debit',
      categoryId: null,
      linkedDebtId: null,
    },
  });

  assert.equal(transaction.accountId, account.id);

  await assert.rejects(
    () => createTransaction({
      db,
      householdId: 'household_1',
      input: {
        accountId: otherAccount.id,
        transactionDate: '2026-03-11',
        description: 'Bad account',
        amount: '10.00',
        direction: 'debit',
      },
    }),
    /financial account not found/,
  );
});

test('account reconciliation records discrepancy and resolves with an audit trail', async () => {
  const db = createInMemoryDb();
  const account = await db.transaction((tx) => tx.insertFinancialAccount({
    householdId: 'household_1',
    workspaceId: 'household_1',
    name: 'Savings',
    accountType: 'savings',
    institution: null,
    currency: 'CAD',
    currentBalance: '1000.00',
    availableBalance: null,
    balanceAsOf: '2026-03-01T00:00:00.000Z',
    isManual: true,
    status: 'active',
  }));

  const createResponse = await createReconciliationRoute(jsonRequest(`/financial-accounts/${account.id}/reconciliations`, {
    reported_balance: '975.25',
    reported_as_of: '2026-03-31T23:59:59.000Z',
    source: 'statement',
    note: 'March statement',
  }), { db, householdId: 'household_1', params: { accountId: account.id } });
  assert.equal(createResponse.status, 201);
  const reconciliation = await createResponse.json();
  assert.equal(reconciliation.recorded_balance, '1000.00');
  assert.equal(reconciliation.reported_balance, '975.25');
  assert.equal(reconciliation.discrepancy, '-24.75');
  assert.equal(reconciliation.status, 'open');

  const listResponse = await listReconciliationsRoute(
    new Request(`http://localhost/api/v1/financial-accounts/${account.id}/reconciliations`, { headers: { 'x-household-id': 'household_1' } }),
    { db, householdId: 'household_1', params: { accountId: account.id } },
  );
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).items.length, 1);

  const resolveResponse = await resolveReconciliationRoute(jsonRequest(`/financial-accounts/${account.id}/reconciliations/${reconciliation.id}`, {
    action: 'accept_reported_balance',
    note: 'Accepted statement after review',
  }), {
    db,
    householdId: 'household_1',
    params: { accountId: account.id, reconciliationId: reconciliation.id },
  });
  assert.equal(resolveResponse.status, 200);
  const resolved = await resolveResponse.json();
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolved_action, 'accept_reported_balance');

  const updatedAccount = await db.transaction((tx) => tx.getFinancialAccountById({ householdId: 'household_1', accountId: account.id }));
  assert.equal(updatedAccount.currentBalance, '975.25');
});

test('account reconciliation rejects account ids outside the active workspace', async () => {
  const db = createInMemoryDb();
  const otherAccount = await db.transaction((tx) => tx.insertFinancialAccount({
    householdId: 'household_2',
    workspaceId: 'household_2',
    name: 'Other Savings',
    accountType: 'savings',
    institution: null,
    currency: 'CAD',
    currentBalance: '1000.00',
    availableBalance: null,
    balanceAsOf: '2026-03-01T00:00:00.000Z',
    isManual: true,
    status: 'active',
  }));

  const response = await createReconciliationRoute(jsonRequest(`/financial-accounts/${otherAccount.id}/reconciliations`, {
    reported_balance: '900.00',
  }), { db, householdId: 'household_1', params: { accountId: otherAccount.id } });

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'financial account not found');
});

test('import upload and approval preserve selected account on resulting transactions', async () => {
  const db = createInMemoryDb();
  const account = await db.transaction((tx) => tx.insertFinancialAccount({
    householdId: 'household_1',
    workspaceId: 'household_1',
    name: 'Everyday Checking',
    accountType: 'checking',
    institution: null,
    currency: 'CAD',
    currentBalance: '500.00',
    availableBalance: null,
    balanceAsOf: '2026-03-01T00:00:00.000Z',
    isManual: true,
    status: 'active',
  }));

  const upload = await uploadImportBatch({
    db,
    householdId: 'household_1',
    input: {
      filename: 'statement.csv',
      text: 'Date,Description,Amount\n2026-03-10,Coffee,4.25\n',
      accountId: account.id,
    },
  });
  const importedRowId = db.state.importedRows[0].id;

  await db.transaction((tx) => tx.updateImportedRow({
    householdId: 'household_1',
    rowId: importedRowId,
    patch: {
      parsedDate: '2026-03-10',
      parsedDescription: 'Coffee',
      parsedMerchant: 'Coffee',
      parsedAmount: '4.25',
      parsedDirection: 'debit',
      suggestedCategoryId: db.state.allocationCategories[0].id,
      status: 'approved',
    },
  }));
  await db.transaction((tx) => tx.updateImportBatch({ householdId: 'household_1', batchId: upload.batchId, status: 'review' }));

  const result = await approveImportBatch({ db, householdId: 'household_1', batchId: upload.batchId });

  assert.equal(result.inserted, 1);
  assert.equal(db.state.importBatches[0].accountId, account.id);
  assert.equal(db.state.importedRows[0].accountId, account.id);
  assert.equal(db.state.transactions[0].accountId, account.id);
});

test('reviewed imported transactions carry account identity into classified RAF transactions', async () => {
  const db = createInMemoryDb();
  const account = await db.transaction((tx) => tx.insertFinancialAccount({
    householdId: 'household_1',
    workspaceId: 'household_1',
    name: 'Everyday Checking',
    accountType: 'checking',
    institution: null,
    currency: 'CAD',
    currentBalance: '500.00',
    availableBalance: null,
    balanceAsOf: '2026-03-01T00:00:00.000Z',
    isManual: true,
    status: 'active',
  }));
  const categoryId = db.state.allocationCategories[0].id;

  await db.transaction((tx) => tx.insertImportedTransactions({
    rows: [{
      householdId: 'household_1',
      accountId: account.id,
      date: '2026-03-10',
      description: 'Coffee',
      amount: '-4.25',
      currency: 'CAD',
      source: 'bank_import',
      rawDescription: 'Coffee',
      referenceNumber: null,
      balanceAfterTransaction: null,
      status: 'unreviewed',
      classificationType: null,
      linkedTransactionId: null,
      linkedDebtId: null,
      linkedFixedBillId: null,
      linkedGoalId: null,
      reviewedAt: null,
      reviewNote: null,
    }],
  }));

  const result = await classifyImportedTransaction({
    db,
    householdId: 'household_1',
    importedTransactionId: db.state.importedTransactions[0].id,
    input: {
      classification_type: 'transaction',
      category_id: categoryId,
    },
  });

  assert.equal(result.account_id, account.id);
  assert.equal(db.state.transactions[0].accountId, account.id);
});
