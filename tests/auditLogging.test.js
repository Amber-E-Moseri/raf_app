import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountReconciliation,
  createFinancialAccount,
  resolveAccountReconciliation,
  updateFinancialAccount,
} from '../lib/accounts/accounts.js';
import { createDebt, createDebtAdjustment, deleteDebt, updateDebt } from '../lib/debts/debts.js';
import { createIncome, deleteIncome, updateIncome } from '../lib/income/createIncome.js';
import { approveImportBatch } from '../lib/imports/approveImportBatch.js';
import { rejectImportBatch } from '../lib/imports/rejectImportBatch.js';
import { uploadImportBatch } from '../lib/imports/uploadImportBatch.js';
import { applyMonthlyReview } from '../lib/monthlyReviews/applyMonthlyReview.js';
import { deleteMonthlyReview } from '../lib/monthlyReviews/monthlyReviews.js';
import { createInMemoryDb } from '../lib/server/inMemoryDb.js';
import { createTransaction, deleteTransaction, updateTransaction } from '../lib/transactions/createTransaction.js';

const householdId = 'household_1';
const userId = 'audit_user';

function events(db) {
  return db.state.workspaceActivity.map((row) => ({
    workspaceId: row.workspaceId,
    actorUserId: row.actorUserId,
    action: row.action,
    entityId: row.entityId,
    metadata: row.metadata,
  }));
}

function assertAudit(db, action, entityId = null) {
  const match = events(db).find((row) =>
    row.workspaceId === householdId
    && row.actorUserId === userId
    && row.action === action
    && (entityId == null || row.entityId === entityId));
  assert.ok(match, `missing audit event ${action}`);
  const serialized = JSON.stringify(match.metadata);
  assert.ok(!serialized.includes('100.00'));
  assert.ok(!serialized.includes('Payroll'));
  assert.ok(!serialized.includes('Coffee'));
  return match;
}

test('income and transaction mutations create safe audit events', async () => {
  const db = createInMemoryDb();
  const income = await createIncome({
    db,
    householdId,
    userId,
    input: {
      sourceName: 'Payroll',
      amount: '100.00',
      receivedDate: '2026-03-01',
    },
  });
  await updateIncome({
    db,
    householdId,
    userId,
    incomeId: income.incomeId,
    input: { notes: 'Reviewed' },
  });
  await deleteIncome({ db, householdId, userId, incomeId: income.incomeId });

  const transaction = await createTransaction({
    db,
    householdId,
    userId,
    input: {
      transactionDate: '2026-03-02',
      description: 'Coffee',
      amount: '5.00',
      direction: 'debit',
      categoryId: null,
    },
  });
  await updateTransaction({
    db,
    householdId,
    userId,
    transactionId: transaction.id,
    input: { description: 'Coffee updated' },
  });
  await deleteTransaction({ db, householdId, userId, transactionId: transaction.id });

  assertAudit(db, 'income.created', income.incomeId);
  assertAudit(db, 'income.updated', income.incomeId);
  assertAudit(db, 'income.deleted', income.incomeId);
  assertAudit(db, 'transaction.created', transaction.id);
  assertAudit(db, 'transaction.updated', transaction.id);
  assertAudit(db, 'transaction.deleted', transaction.id);
});

test('debt, account, reconciliation, import, and monthly review mutations create safe audit events', async () => {
  const db = createInMemoryDb();

  const debt = await createDebt({
    db,
    householdId,
    userId,
    input: {
      name: 'Card',
      startingBalance: '100.00',
      apr: '10.00',
      minimumPayment: '10.00',
      monthlyPayment: '20.00',
    },
  });
  await updateDebt({ db, householdId, userId, debtId: debt.id, input: { sortOrder: 2 } });
  const adjustment = await createDebtAdjustment({
    db,
    householdId,
    userId,
    debtId: debt.id,
    input: {
      amount: '1.00',
      adjustment_type: 'fee',
      effective_date: '2026-03-03',
      note: 'Reviewed fee',
    },
  });

  const account = await createFinancialAccount({
    db,
    householdId,
    userId,
    input: {
      name: 'Checking',
      account_type: 'checking',
      current_balance: '100.00',
      balance_as_of: '2026-03-01T00:00:00.000Z',
    },
  });
  await updateFinancialAccount({ db, householdId, userId, accountId: account.id, input: { status: 'active' } });
  const reconciliation = await createAccountReconciliation({
    db,
    householdId,
    userId,
    accountId: account.id,
    input: {
      reported_balance: '101.00',
      reported_as_of: '2026-03-31T00:00:00.000Z',
      source: 'statement',
    },
  });
  await resolveAccountReconciliation({
    db,
    householdId,
    userId,
    accountId: account.id,
    reconciliationId: reconciliation.id,
    input: { action: 'mark_reviewed' },
  });

  const upload = await uploadImportBatch({
    db,
    householdId,
    userId,
    input: {
      filename: 'statement.csv',
      text: 'Date,Description,Amount\n2026-03-10,Coffee,4.25\n',
      accountId: account.id,
    },
  });
  await db.transaction((tx) => tx.updateImportBatch({ householdId, batchId: upload.batchId, status: 'review' }));
  await rejectImportBatch({ db, householdId, userId, batchId: upload.batchId });

  const uploadToApprove = await uploadImportBatch({
    db,
    householdId,
    userId,
    input: {
      filename: 'statement-2.csv',
      text: 'Date,Description,Amount\n2026-03-11,Store,4.25\n',
      accountId: account.id,
    },
  });
  await db.transaction(async (tx) => {
    const row = db.state.importedRows.find((item) => item.batchId === uploadToApprove.batchId);
    await tx.updateImportedRow({
      householdId,
      rowId: row.id,
      patch: {
        parsedDate: '2026-03-11',
        parsedDescription: 'Store',
        parsedAmount: '4.25',
        parsedDirection: 'debit',
        suggestedCategoryId: db.state.allocationCategories[0].id,
        status: 'approved',
      },
    });
    await tx.updateImportBatch({ householdId, batchId: uploadToApprove.batchId, status: 'review' });
  });
  await approveImportBatch({ db, householdId, userId, batchId: uploadToApprove.batchId });

  await createIncome({
    db,
    householdId,
    userId,
    input: {
      sourceName: 'Review income',
      amount: '500.00',
      receivedDate: '2026-04-01',
    },
  });
  const reviewResult = await applyMonthlyReview({
    db,
    householdId,
    userId,
    input: { reviewMonth: '2026-04-01' },
  });
  await deleteMonthlyReview({ db, householdId, userId, reviewId: reviewResult.review.id });

  await deleteDebt({ db, householdId, userId, debtId: debt.id });

  assertAudit(db, 'debt.created', debt.id);
  assertAudit(db, 'debt.updated', debt.id);
  assertAudit(db, 'debt.adjustment_created', adjustment.id);
  assertAudit(db, 'debt.deleted', debt.id);
  assertAudit(db, 'account.created', account.id);
  assertAudit(db, 'account.updated', account.id);
  assertAudit(db, 'account.reconciliation_created', reconciliation.id);
  assertAudit(db, 'account.reconciliation_resolved', reconciliation.id);
  assertAudit(db, 'import.uploaded', upload.batchId);
  assertAudit(db, 'import.rejected', upload.batchId);
  assertAudit(db, 'import.approved', uploadToApprove.batchId);
  assertAudit(db, 'monthly_review.applied', reviewResult.review.id);
  assertAudit(db, 'monthly_review.deleted', reviewResult.review.id);
});
