import { z } from 'zod';

import { createTransactionSchema } from '../transactions/createTransaction.js';
import { ImportHttpError, normalizeMoney, normalizeOptionalString, parseMoneyToCents } from './shared.js';

const importedStatusSchema = z.enum(['unreviewed', 'classified', 'ignored']);
const classificationTypeSchema = z.enum(['transaction', 'debt_payment', 'fixed_bill_payment', 'ignore']);
const isoDateSchema = z.string().trim().refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), {
  message: 'must be a valid ISO date',
});

const classifyImportedTransactionSchema = z.object({
  classification_type: classificationTypeSchema.optional(),
  classificationType: classificationTypeSchema.optional(),
  transactionDate: isoDateSchema.optional(),
  transaction_date: isoDateSchema.optional(),
  description: z.string().trim().min(1, 'is required').optional(),
  merchant: z.union([z.string(), z.null()]).optional(),
  categoryId: z.string().trim().min(1, 'is required').optional(),
  category_id: z.string().trim().min(1, 'is required').optional(),
  debtId: z.string().trim().min(1, 'is required').optional(),
  debt_id: z.string().trim().min(1, 'is required').optional(),
  fixedBillId: z.string().trim().min(1, 'is required').optional(),
  fixed_bill_id: z.string().trim().min(1, 'is required').optional(),
  reviewNote: z.union([z.string(), z.null()]).optional(),
  review_note: z.union([z.string(), z.null()]).optional(),
}).superRefine((value, context) => {
  const classificationType = value.classification_type ?? value.classificationType;
  if (!classificationType) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['classification_type'],
      message: 'is required',
    });
    return;
  }

  if (classificationType === 'debt_payment' && !value.debt_id && !value.debtId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['debt_id'],
      message: 'is required',
    });
  }

  if (classificationType === 'fixed_bill_payment' && !value.fixed_bill_id && !value.fixedBillId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fixed_bill_id'],
      message: 'is required',
    });
  }
});

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Import review DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input, status = 400) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new ImportHttpError(status, `${path} ${issue.message}`.trim());
  }

  return result.data;
}

function normalizeClassifyInput(input) {
  return {
    classificationType: input.classification_type ?? input.classificationType,
    transactionDate: input.transaction_date ?? input.transactionDate ?? null,
    description: input.description?.trim() ?? null,
    merchant: normalizeOptionalString(input.merchant),
    categoryId: input.category_id ?? input.categoryId ?? null,
    debtId: input.debt_id ?? input.debtId ?? null,
    fixedBillId: input.fixed_bill_id ?? input.fixedBillId ?? null,
    reviewNote: normalizeOptionalString(input.review_note ?? input.reviewNote),
  };
}

function formatImportedTransaction(row) {
  return {
    id: row.id,
    household_id: row.householdId,
    date: row.date,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    source: row.source,
    raw_description: row.rawDescription,
    reference_number: row.referenceNumber ?? null,
    balance_after_transaction: row.balanceAfterTransaction ?? null,
    status: row.status ?? 'unreviewed',
    classification_type: row.classificationType ?? null,
    linked_transaction_id: row.linkedTransactionId ?? null,
    linked_debt_id: row.linkedDebtId ?? null,
    linked_fixed_bill_id: row.linkedFixedBillId ?? null,
    reviewed_at: row.reviewedAt ?? null,
    review_note: row.reviewNote ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function ensureImportedRowIsReviewable(row) {
  if (!row) {
    throw new ImportHttpError(404, 'imported transaction not found');
  }

  if ((row.status ?? 'unreviewed') !== 'unreviewed') {
    throw new ImportHttpError(409, 'imported transaction has already been reviewed');
  }
}

function deriveTransactionPayload(importedRow, overrides = {}) {
  const normalizedAmount = normalizeMoney(importedRow.amount, 'amount');
  const amountCents = parseMoneyToCents(normalizedAmount, 'amount');
  const direction = amountCents < 0 ? 'debit' : 'credit';
  const transactionAmount = String(Math.abs(amountCents / 100).toFixed(2));

  return {
    transactionDate: overrides.transactionDate ?? importedRow.date,
    description: overrides.description ?? importedRow.description,
    merchant: Object.prototype.hasOwnProperty.call(overrides, 'merchant') ? overrides.merchant : importedRow.rawDescription ?? null,
    amount: transactionAmount,
    direction,
    categoryId: overrides.categoryId ?? null,
    linkedDebtId: overrides.linkedDebtId ?? null,
  };
}

function validateTransactionPayload(payload) {
  const result = createTransactionSchema.safeParse(payload);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new ImportHttpError(400, `${path} ${issue.message}`.trim());
  }

  return result.data;
}

async function requireDebt(tx, householdId, debtId) {
  const debt = await tx.getDebtById({ householdId, debtId });
  if (!debt) {
    throw new ImportHttpError(404, 'linked debt not found');
  }

  return debt;
}

async function requireFixedBill(tx, householdId, fixedBillId) {
  const fixedBill = await tx.getFixedBillById({ householdId, fixedBillId });
  if (!fixedBill) {
    throw new ImportHttpError(404, 'linked fixed bill not found');
  }

  return fixedBill;
}

async function requireCategoryIdBySlug(tx, householdId, slug) {
  const categories = await tx.listAllocationCategories({ householdId });
  const category = categories.find((item) => item.slug === slug && item.isActive !== false);
  if (!category) {
    throw new ImportHttpError(422, `category_slug must reference an active allocation category: ${slug}`);
  }

  return category.id;
}

async function createLinkedTransaction(tx, householdId, payload) {
  const transaction = await tx.insertTransaction({
    householdId,
    transactionDate: payload.transactionDate,
    description: payload.description,
    merchant: payload.merchant,
    amount: payload.amount,
    direction: payload.direction,
    categoryId: payload.categoryId,
    linkedDebtId: payload.linkedDebtId,
    source: 'import',
  });

  if (payload.linkedDebtId) {
    await tx.insertDebtPayment({
      householdId,
      debtId: payload.linkedDebtId,
      transactionId: transaction.id,
      paymentDate: payload.transactionDate,
      amount: payload.amount,
    });
  }

  return transaction;
}

export async function listReviewedImportedTransactions({ db, householdId }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => ({
    items: (await tx.listImportedTransactions({ householdId })).map(formatImportedTransaction),
  }));
}

export async function getImportedTransaction({ db, householdId, importedTransactionId }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  if (!importedTransactionId) {
    throw new ImportHttpError(400, 'importedTransactionId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const importedTransaction = await tx.getImportedTransactionById({ householdId, importedTransactionId });
    if (!importedTransaction) {
      throw new ImportHttpError(404, 'imported transaction not found');
    }

    return formatImportedTransaction(importedTransaction);
  });
}

export async function classifyImportedTransaction({ db, householdId, importedTransactionId, input }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  if (!importedTransactionId) {
    throw new ImportHttpError(400, 'importedTransactionId is required');
  }

  requireDbContract(db);
  const parsedInput = normalizeClassifyInput(parseWithSchema(classifyImportedTransactionSchema, input));

  return db.transaction(async (tx) => {
    const importedTransaction = await tx.getImportedTransactionById({ householdId, importedTransactionId });
    ensureImportedRowIsReviewable(importedTransaction);

    if (parsedInput.classificationType === 'ignore') {
      const ignored = await tx.updateImportedTransaction({
        householdId,
        importedTransactionId,
        patch: {
          status: 'ignored',
          classificationType: 'ignore',
          reviewedAt: new Date().toISOString(),
          reviewNote: parsedInput.reviewNote,
        },
      });

      return formatImportedTransaction(ignored);
    }

    let linkedTransaction = null;
    let linkedDebtId = null;
    let linkedFixedBillId = null;

    if (parsedInput.classificationType === 'transaction') {
      const validatedPayload = validateTransactionPayload(
        deriveTransactionPayload(importedTransaction, {
          transactionDate: parsedInput.transactionDate,
          description: parsedInput.description,
          merchant: parsedInput.merchant,
          categoryId: parsedInput.categoryId,
        }),
      );
      linkedTransaction = await createLinkedTransaction(tx, householdId, validatedPayload);
    }

    if (parsedInput.classificationType === 'debt_payment') {
      linkedDebtId = parsedInput.debtId;
      await requireDebt(tx, householdId, linkedDebtId);
      const validatedPayload = validateTransactionPayload(
        deriveTransactionPayload(importedTransaction, {
          transactionDate: parsedInput.transactionDate,
          description: parsedInput.description,
          merchant: parsedInput.merchant,
          linkedDebtId,
        }),
      );
      if (validatedPayload.direction !== 'debit') {
        throw new ImportHttpError(422, 'debt payments must classify to debit transactions');
      }

      linkedTransaction = await createLinkedTransaction(tx, householdId, validatedPayload);
    }

    if (parsedInput.classificationType === 'fixed_bill_payment') {
      linkedFixedBillId = parsedInput.fixedBillId;
      const fixedBill = await requireFixedBill(tx, householdId, linkedFixedBillId);
      const categoryId = await requireCategoryIdBySlug(tx, householdId, fixedBill.categorySlug);
      const validatedPayload = validateTransactionPayload(
        deriveTransactionPayload(importedTransaction, {
          transactionDate: parsedInput.transactionDate,
          description: parsedInput.description ?? fixedBill.name,
          merchant: parsedInput.merchant,
          categoryId,
        }),
      );
      if (validatedPayload.direction !== 'debit') {
        throw new ImportHttpError(422, 'fixed bill payments must classify to debit transactions');
      }

      linkedTransaction = await createLinkedTransaction(tx, householdId, validatedPayload);
    }

    const updated = await tx.updateImportedTransaction({
      householdId,
      importedTransactionId,
      patch: {
        status: 'classified',
        classificationType: parsedInput.classificationType,
        linkedTransactionId: linkedTransaction?.id ?? null,
        linkedDebtId,
        linkedFixedBillId,
        reviewedAt: new Date().toISOString(),
        reviewNote: parsedInput.reviewNote,
      },
    });

    return formatImportedTransaction(updated);
  });
}

export async function ignoreImportedTransaction({ db, householdId, importedTransactionId, input = {} }) {
  return classifyImportedTransaction({
    db,
    householdId,
    importedTransactionId,
    input: {
      ...input,
      classification_type: 'ignore',
    },
  });
}

export const __internal = {
  classifyImportedTransactionSchema,
  deriveTransactionPayload,
  formatImportedTransaction,
};
