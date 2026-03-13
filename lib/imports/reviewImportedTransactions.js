import { z } from 'zod';

import { createTransactionSchema } from '../transactions/createTransaction.js';
import { ImportHttpError, normalizeMoney, normalizeOptionalString, parseMoneyToCents } from './shared.js';

const importedStatusSchema = z.enum(['unreviewed', 'classified', 'ignored']);
const classificationTypeSchema = z.enum([
  'transaction',
  'debt_payment',
  'fixed_bill_payment',
  'goal_funding',
  'duplicate',
  'transfer',
  'ignore',
]);
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
  goalId: z.string().trim().min(1, 'is required').optional(),
  goal_id: z.string().trim().min(1, 'is required').optional(),
  rememberChoice: z.boolean().optional(),
  remember_choice: z.boolean().optional(),
  autoApplyRule: z.boolean().optional(),
  auto_apply_rule: z.boolean().optional(),
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

  if (classificationType === 'goal_funding' && !value.goal_id && !value.goalId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['goal_id'],
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

function normalizeDescription(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    goalId: input.goal_id ?? input.goalId ?? null,
    rememberChoice: Boolean(input.remember_choice ?? input.rememberChoice ?? false),
    autoApplyRule: Boolean(input.auto_apply_rule ?? input.autoApplyRule ?? false),
    reviewNote: normalizeOptionalString(input.review_note ?? input.reviewNote),
  };
}

function formatSuggestion(rule) {
  if (!rule) {
    return null;
  }

  return {
    id: rule.id,
    normalized_description: rule.normalizedDescription,
    classification_type: rule.classificationType,
    category_id: rule.categoryId ?? null,
    linked_debt_id: rule.linkedDebtId ?? null,
    linked_fixed_bill_id: rule.linkedFixedBillId ?? null,
    linked_goal_id: rule.linkedGoalId ?? null,
    auto_apply: rule.autoApply === true,
    created_at: rule.createdAt,
    updated_at: rule.updatedAt,
  };
}

function formatImportedTransaction(row, suggestion = null) {
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
    status: importedStatusSchema.catch('unreviewed').parse(row.status ?? 'unreviewed'),
    classification_type: row.classificationType ?? null,
    linked_transaction_id: row.linkedTransactionId ?? null,
    linked_debt_id: row.linkedDebtId ?? null,
    linked_fixed_bill_id: row.linkedFixedBillId ?? null,
    linked_goal_id: row.linkedGoalId ?? null,
    normalized_description: row.normalizedDescription ?? normalizeDescription(row.rawDescription ?? row.description),
    suggestion,
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
    merchant: Object.prototype.hasOwnProperty.call(overrides, 'merchant')
      ? overrides.merchant
      : importedRow.rawDescription ?? null,
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

async function requireGoal(tx, householdId, goalId) {
  const goal = await tx.getGoalById({ householdId, goalId });
  if (!goal || goal.active === false) {
    throw new ImportHttpError(404, 'linked goal not found');
  }

  return goal;
}

async function requireCategoryIdBySlug(tx, householdId, slug) {
  const categories = await tx.listAllocationCategories({ householdId });
  const category = categories.find((item) => item.slug === slug && item.isActive !== false);
  if (!category) {
    throw new ImportHttpError(422, `category_slug must reference an active allocation category: ${slug}`);
  }

  return category.id;
}

async function requireCategoryById(tx, householdId, categoryId) {
  const categories = await tx.listAllocationCategories({ householdId });
  const category = categories.find((item) => item.id === categoryId && item.isActive !== false);
  if (!category) {
    throw new ImportHttpError(404, 'allocation category not found');
  }

  return category;
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

async function resolveSuggestion(tx, householdId, row) {
  const normalizedDescription = row.normalizedDescription ?? normalizeDescription(row.rawDescription ?? row.description);
  if (!normalizedDescription || typeof tx.findImportReviewRuleByNormalizedDescription !== 'function') {
    return null;
  }

  const rule = await tx.findImportReviewRuleByNormalizedDescription({ householdId, normalizedDescription });
  return formatSuggestion(rule);
}

async function rememberReviewChoice(tx, householdId, importedRow, reviewDecision) {
  if (!reviewDecision.rememberChoice || typeof tx.upsertImportReviewRule !== 'function') {
    return null;
  }

  const normalizedDescription = importedRow.normalizedDescription
    ?? normalizeDescription(importedRow.rawDescription ?? importedRow.description);

  if (!normalizedDescription) {
    return null;
  }

  const rule = await tx.upsertImportReviewRule({
    householdId,
    normalizedDescription,
    classificationType: reviewDecision.classificationType,
    categoryId: reviewDecision.categoryId ?? null,
    linkedDebtId: reviewDecision.linkedDebtId ?? null,
    linkedFixedBillId: reviewDecision.linkedFixedBillId ?? null,
    linkedGoalId: reviewDecision.linkedGoalId ?? null,
    autoApply: reviewDecision.autoApplyRule === true,
  });

  return formatSuggestion(rule);
}

export async function listReviewedImportedTransactions({ db, householdId }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const items = await tx.listImportedTransactions({ householdId });
    return {
      items: await Promise.all(items.map(async (row) => formatImportedTransaction(row, await resolveSuggestion(tx, householdId, row)))),
    };
  });
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

    return formatImportedTransaction(importedTransaction, await resolveSuggestion(tx, householdId, importedTransaction));
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

    const normalizedDescription = importedTransaction.normalizedDescription
      ?? normalizeDescription(importedTransaction.rawDescription ?? importedTransaction.description);

    if (parsedInput.classificationType === 'ignore') {
      const ignored = await tx.updateImportedTransaction({
        householdId,
        importedTransactionId,
        patch: {
          status: 'ignored',
          classificationType: 'ignore',
          normalizedDescription,
          reviewedAt: new Date().toISOString(),
          reviewNote: parsedInput.reviewNote,
        },
      });

      const suggestion = await rememberReviewChoice(tx, householdId, ignored, {
        classificationType: 'ignore',
        rememberChoice: parsedInput.rememberChoice,
        autoApplyRule: parsedInput.autoApplyRule,
      });

      return formatImportedTransaction(ignored, suggestion ?? await resolveSuggestion(tx, householdId, ignored));
    }

    let linkedTransaction = null;
    let linkedDebtId = null;
    let linkedFixedBillId = null;
    let linkedGoalId = null;
    let categoryId = parsedInput.categoryId;

    if (parsedInput.classificationType === 'duplicate' || parsedInput.classificationType === 'transfer') {
      const updated = await tx.updateImportedTransaction({
        householdId,
        importedTransactionId,
        patch: {
          status: 'classified',
          classificationType: parsedInput.classificationType,
          normalizedDescription,
          reviewedAt: new Date().toISOString(),
          reviewNote: parsedInput.reviewNote,
        },
      });

      const suggestion = await rememberReviewChoice(tx, householdId, updated, {
        classificationType: parsedInput.classificationType,
        rememberChoice: parsedInput.rememberChoice,
        autoApplyRule: parsedInput.autoApplyRule,
      });

      return formatImportedTransaction(updated, suggestion ?? await resolveSuggestion(tx, householdId, updated));
    }

    if (parsedInput.classificationType === 'transaction') {
      if (categoryId) {
        await requireCategoryById(tx, householdId, categoryId);
      }
      const validatedPayload = validateTransactionPayload(
        deriveTransactionPayload(importedTransaction, {
          transactionDate: parsedInput.transactionDate,
          description: parsedInput.description,
          merchant: parsedInput.merchant,
          categoryId,
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
      categoryId = await requireCategoryIdBySlug(tx, householdId, fixedBill.categorySlug);
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

    if (parsedInput.classificationType === 'goal_funding') {
      linkedGoalId = parsedInput.goalId;
      const goal = await requireGoal(tx, householdId, linkedGoalId);
      categoryId = goal.bucketId;
      await requireCategoryById(tx, householdId, categoryId);
      const validatedPayload = validateTransactionPayload(
        deriveTransactionPayload(importedTransaction, {
          transactionDate: parsedInput.transactionDate,
          description: parsedInput.description ?? goal.name,
          merchant: parsedInput.merchant,
          categoryId,
        }),
      );

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
        linkedGoalId,
        normalizedDescription,
        reviewedAt: new Date().toISOString(),
        reviewNote: parsedInput.reviewNote,
      },
    });

    const suggestion = await rememberReviewChoice(tx, householdId, updated, {
      classificationType: parsedInput.classificationType,
      categoryId,
      linkedDebtId,
      linkedFixedBillId,
      linkedGoalId,
      rememberChoice: parsedInput.rememberChoice,
      autoApplyRule: parsedInput.autoApplyRule,
    });

    return formatImportedTransaction(updated, suggestion ?? await resolveSuggestion(tx, householdId, updated));
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
  formatSuggestion,
  normalizeDescription,
};
