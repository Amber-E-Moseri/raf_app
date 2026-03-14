import { z } from 'zod';

import { ImportHttpError } from './shared.js';

const ruleTypeSchema = z.enum(['suggestion', 'reusable_rule']);
const matchTypeSchema = z.enum(['contains', 'exact']);
const classificationTypeSchema = z.enum([
  'income',
  'transaction',
  'debt_payment',
  'fixed_bill_payment',
  'goal_funding',
  'duplicate',
  'transfer',
  'ignore',
]);

const updateImportReviewRuleSchema = z.object({
  match_value: z.string().trim().min(1).optional(),
  matchValue: z.string().trim().min(1).optional(),
  match_type: matchTypeSchema.optional(),
  matchType: matchTypeSchema.optional(),
  category_id: z.union([z.string().trim().min(1), z.null()]).optional(),
  categoryId: z.union([z.string().trim().min(1), z.null()]).optional(),
  debt_id: z.union([z.string().trim().min(1), z.null()]).optional(),
  debtId: z.union([z.string().trim().min(1), z.null()]).optional(),
  fixed_bill_id: z.union([z.string().trim().min(1), z.null()]).optional(),
  fixedBillId: z.union([z.string().trim().min(1), z.null()]).optional(),
  goal_id: z.union([z.string().trim().min(1), z.null()]).optional(),
  goalId: z.union([z.string().trim().min(1), z.null()]).optional(),
  classification_type: classificationTypeSchema.optional(),
  classificationType: classificationTypeSchema.optional(),
  rule_type: ruleTypeSchema.optional(),
  ruleType: ruleTypeSchema.optional(),
  auto_apply: z.boolean().optional(),
  autoApply: z.boolean().optional(),
}).superRefine((value, context) => {
  const classificationType = value.classification_type ?? value.classificationType;
  const categoryId = value.category_id ?? value.categoryId;

  if (classificationType === 'transaction' && categoryId === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['category_id'],
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

function formatImportReviewRule(rule) {
  return {
    id: rule.id,
    household_id: rule.householdId,
    match_type: rule.matchType ?? 'contains',
    match_value: rule.matchValue ?? rule.normalizedDescription,
    normalized_description: rule.normalizedDescription ?? rule.matchValue ?? null,
    classification_type: rule.classificationType,
    category_id: rule.categoryId ?? null,
    linked_debt_id: rule.linkedDebtId ?? null,
    linked_fixed_bill_id: rule.linkedFixedBillId ?? null,
    linked_goal_id: rule.linkedGoalId ?? null,
    rule_type: rule.ruleType ?? 'suggestion',
    auto_apply: rule.autoApply === true,
    created_at: rule.createdAt,
    updated_at: rule.updatedAt,
    last_used_at: rule.lastUsedAt ?? null,
  };
}

function normalizeUpdateInput(input) {
  return {
    matchValue: input.match_value ?? input.matchValue,
    matchType: input.match_type ?? input.matchType,
    classificationType: input.classification_type ?? input.classificationType,
    categoryId: input.category_id ?? input.categoryId,
    linkedDebtId: input.debt_id ?? input.debtId,
    linkedFixedBillId: input.fixed_bill_id ?? input.fixedBillId,
    linkedGoalId: input.goal_id ?? input.goalId,
    ruleType: input.rule_type ?? input.ruleType,
    autoApply: input.auto_apply ?? input.autoApply,
  };
}

async function requireRule(tx, householdId, ruleId) {
  if (typeof tx.getImportReviewRuleById !== 'function') {
    throw new Error('Import review DB adapter must implement getImportReviewRuleById().');
  }

  const rule = await tx.getImportReviewRuleById({ householdId, ruleId });
  if (!rule) {
    throw new ImportHttpError(404, 'import review rule not found');
  }

  return rule;
}

export async function listImportReviewRules({ db, householdId }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    if (typeof tx.listImportReviewRules !== 'function') {
      return { items: [] };
    }

    const items = await tx.listImportReviewRules({ householdId });
    return {
      items: items.map(formatImportReviewRule),
    };
  });
}

export async function updateImportReviewRule({ db, householdId, ruleId, input }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }
  if (!ruleId) {
    throw new ImportHttpError(400, 'ruleId is required');
  }

  requireDbContract(db);
  const parsed = normalizeUpdateInput(parseWithSchema(updateImportReviewRuleSchema, input));

  return db.transaction(async (tx) => {
    const existing = await requireRule(tx, householdId, ruleId);

    const matchValue = parsed.matchValue == null
      ? undefined
      : normalizeDescription(parsed.matchValue);

    if (matchValue === '') {
      throw new ImportHttpError(400, 'match_value is required');
    }

    const updated = await tx.updateImportReviewRule({
      householdId,
      ruleId,
      patch: {
        ...(matchValue !== undefined
          ? {
            matchValue,
            normalizedDescription: matchValue,
          }
          : {}),
        ...(parsed.matchType !== undefined ? { matchType: parsed.matchType } : {}),
        ...(parsed.classificationType !== undefined ? { classificationType: parsed.classificationType } : {}),
        ...(parsed.categoryId !== undefined ? { categoryId: parsed.categoryId } : {}),
        ...(parsed.linkedDebtId !== undefined ? { linkedDebtId: parsed.linkedDebtId } : {}),
        ...(parsed.linkedFixedBillId !== undefined ? { linkedFixedBillId: parsed.linkedFixedBillId } : {}),
        ...(parsed.linkedGoalId !== undefined ? { linkedGoalId: parsed.linkedGoalId } : {}),
        ...(parsed.ruleType !== undefined ? { ruleType: parsed.ruleType } : {}),
        ...(parsed.autoApply !== undefined ? { autoApply: parsed.autoApply } : {}),
        createdAt: existing.createdAt,
      },
    });

    return formatImportReviewRule(updated);
  });
}

export async function deleteImportReviewRule({ db, householdId, ruleId }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }
  if (!ruleId) {
    throw new ImportHttpError(400, 'ruleId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    await requireRule(tx, householdId, ruleId);
    await tx.deleteImportReviewRule({ householdId, ruleId });
    return { success: true };
  });
}

export const __internal = {
  formatImportReviewRule,
  normalizeDescription,
  updateImportReviewRuleSchema,
};
