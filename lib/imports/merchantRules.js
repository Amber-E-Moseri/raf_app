import { z } from 'zod';

export class MerchantRuleHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MerchantRuleHttpError';
    this.status = status;
  }
}

const createMerchantRuleSchema = z.object({
  merchantPattern: z.string().trim().min(1, 'merchantPattern is required'),
  categoryId: z.string().trim().min(1, 'categoryId is required'),
  priority: z.number().int().optional().default(0),
  enabled: z.boolean().optional().default(true),
});

const updateMerchantRuleSchema = z
  .object({
    merchantPattern: z.string().trim().min(1, 'merchantPattern is required').optional(),
    categoryId: z.union([z.string().trim().min(1), z.null()]).optional(),
    priority: z.number().int().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field is required',
  });

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Merchant rule DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new MerchantRuleHttpError(400, `${path} ${issue.message}`);
  }

  return result.data;
}

export function normalizeMerchant(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function getRulePattern(rule) {
  return rule.merchantPattern ?? rule.merchant_pattern ?? rule.matchValue ?? rule.match_value ?? '';
}

function getRuleCategoryId(rule) {
  return rule.categoryId ?? rule.category_id ?? null;
}

function getRuleEnabled(rule) {
  if (typeof rule.enabled === 'boolean') {
    return rule.enabled;
  }

  if (typeof rule.isActive === 'boolean') {
    return rule.isActive;
  }

  return true;
}

export function matchMerchantRule(rules, merchantName) {
  const normalizedMerchant = normalizeMerchant(merchantName);
  if (!normalizedMerchant) {
    return null;
  }

  return [...rules]
    .filter((rule) => getRuleEnabled(rule))
    .sort((left, right) => {
      const priorityDiff = (right.priority ?? 0) - (left.priority ?? 0);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return String(right.createdAt ?? right.created_at ?? '').localeCompare(
        String(left.createdAt ?? left.created_at ?? ''),
      );
    })
    .find((rule) => normalizedMerchant.includes(normalizeMerchant(getRulePattern(rule)))) ?? null;
}

function formatMerchantRule(rule) {
  return {
    id: rule.id,
    merchantPattern: getRulePattern(rule),
    categoryId: getRuleCategoryId(rule),
    priority: rule.priority ?? 0,
    enabled: getRuleEnabled(rule),
  };
}

export async function listMerchantRules({ db, householdId }) {
  if (!householdId) {
    throw new MerchantRuleHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => ({
    items: (await tx.listMerchantRules({ householdId })).map(formatMerchantRule),
  }));
}

export async function createMerchantRule({ db, householdId, input }) {
  if (!householdId) {
    throw new MerchantRuleHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedInput = parseWithSchema(createMerchantRuleSchema, input);

  return db.transaction(async (tx) => {
    const rule = await tx.insertMerchantRule({
      householdId,
      merchantPattern: parsedInput.merchantPattern,
      categoryId: parsedInput.categoryId,
      priority: parsedInput.priority,
      enabled: parsedInput.enabled,
    });

    return formatMerchantRule(rule);
  });
}

export async function updateMerchantRule({ db, householdId, ruleId, input }) {
  if (!householdId) {
    throw new MerchantRuleHttpError(400, 'householdId is required');
  }

  if (!ruleId) {
    throw new MerchantRuleHttpError(400, 'ruleId is required');
  }

  requireDbContract(db);
  const parsedInput = parseWithSchema(updateMerchantRuleSchema, input);

  return db.transaction(async (tx) => {
    const existing = await tx.getMerchantRuleById({ householdId, ruleId });
    if (!existing) {
      throw new MerchantRuleHttpError(404, 'merchant rule not found');
    }

    const updated = await tx.updateMerchantRule({
      householdId,
      ruleId,
      patch: parsedInput,
    });

    return formatMerchantRule(updated);
  });
}

export async function deleteMerchantRule({ db, householdId, ruleId }) {
  if (!householdId) {
    throw new MerchantRuleHttpError(400, 'householdId is required');
  }

  if (!ruleId) {
    throw new MerchantRuleHttpError(400, 'ruleId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const existing = await tx.getMerchantRuleById({ householdId, ruleId });
    if (!existing) {
      throw new MerchantRuleHttpError(404, 'merchant rule not found');
    }

    await tx.deleteMerchantRule({ householdId, ruleId });
  });
}

export const __internal = {
  createMerchantRuleSchema,
  updateMerchantRuleSchema,
  formatMerchantRule,
  getRuleEnabled,
  getRulePattern,
};
