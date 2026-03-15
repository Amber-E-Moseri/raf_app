import { z } from 'zod';

export class HouseholdSurplusSplitRulesHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HouseholdSurplusSplitRulesHttpError';
    this.status = status;
  }
}

const FRACTION_SCALE = 10000;
const SUM_TOLERANCE_BPS = 1;

const splitPercentSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(4) : value.trim()))
  .refine((value) => /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value), {
    message: 'splitPercent must be a decimal with up to 4 places',
  })
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${(fraction + '0000').slice(0, 4)}`;
  });

const nullableTrimmedString = z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
});

const replaceItemSchema = z.object({
  id: nullableTrimmedString.optional(),
  slug: nullableTrimmedString.optional(),
  label: z.string().trim().min(1, 'label is required'),
  splitPercent: splitPercentSchema,
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  destinationType: z.enum(['bucket', 'goal', 'debt']),
  destinationBucketSlug: nullableTrimmedString.optional(),
  destinationGoalId: nullableTrimmedString.optional(),
  destinationDebtId: nullableTrimmedString.optional(),
}).superRefine((value, context) => {
  if (value.destinationType === 'bucket' && !value.destinationBucketSlug) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destinationBucketSlug'],
      message: 'destinationBucketSlug is required for bucket destinations',
    });
  }

  if (value.destinationType === 'goal' && !value.destinationGoalId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destinationGoalId'],
      message: 'destinationGoalId is required for goal destinations',
    });
  }

  if (value.destinationType === 'debt' && !value.destinationDebtId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['destinationDebtId'],
      message: 'destinationDebtId is required for debt destinations',
    });
  }
});

const replaceSchema = z.object({
  items: z.array(replaceItemSchema).min(1, 'items is required'),
});

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Household surplus split DB adapter must implement transaction().');
  }
}

function parseFractionToBps(value) {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * FRACTION_SCALE + Number((fraction + '0000').slice(0, 4));
}

function parseWithSchema(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new HouseholdSurplusSplitRulesHttpError(400, `${path} ${issue.message}`);
  }

  return result.data;
}

function formatRule(rule) {
  return {
    id: rule.id,
    slug: rule.slug,
    label: rule.label ?? rule.slug,
    splitPercent: rule.splitPercent,
    sortOrder: rule.sortOrder ?? 0,
    isActive: rule.isActive !== false,
    destinationType: rule.destinationType ?? 'bucket',
    destinationBucketSlug: rule.destinationBucketSlug ?? null,
    destinationGoalId: rule.destinationGoalId ?? null,
    destinationDebtId: rule.destinationDebtId ?? null,
  };
}

function normalizeItems(items, existingRules) {
  const existingById = new Map(existingRules.map((rule) => [rule.id, rule]));
  let customIndex = 0;

  return items.map((item) => {
    const existing = item.id ? existingById.get(item.id) ?? null : null;
    const fallbackSlug = existing?.slug ?? `surplus_rule_${String(customIndex += 1).padStart(2, '0')}`;

    return {
      id: item.id ?? existing?.id ?? null,
      slug: item.slug ?? existing?.slug ?? fallbackSlug,
      label: item.label,
      splitPercent: item.splitPercent,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      destinationType: item.destinationType,
      destinationBucketSlug: item.destinationType === 'bucket' ? item.destinationBucketSlug ?? null : null,
      destinationGoalId: item.destinationType === 'goal' ? item.destinationGoalId ?? null : null,
      destinationDebtId: item.destinationType === 'debt' ? item.destinationDebtId ?? null : null,
    };
  });
}

function validateNormalizedItems(items) {
  const slugs = new Set();

  for (const item of items) {
    if (slugs.has(item.slug)) {
      throw new HouseholdSurplusSplitRulesHttpError(422, `duplicate surplus rule slug ${item.slug}`);
    }

    slugs.add(item.slug);
  }

  const activeItems = items.filter((item) => item.isActive !== false);
  if (!activeItems.length) {
    throw new HouseholdSurplusSplitRulesHttpError(422, 'at least one active surplus allocation rule is required');
  }

  const totalBps = activeItems.reduce((sum, item) => sum + parseFractionToBps(item.splitPercent), 0);
  if (Math.abs(totalBps - FRACTION_SCALE) > SUM_TOLERANCE_BPS) {
    throw new HouseholdSurplusSplitRulesHttpError(422, 'active surplus allocation percentages must sum to 1.0000 +/- 0.0001');
  }

  if (!activeItems.some((item) => item.slug === 'emergency_fund')) {
    throw new HouseholdSurplusSplitRulesHttpError(422, 'one active surplus allocation rule must remain assigned to the emergency_fund slug');
  }
}

async function validateDestinations({ tx, householdId, items }) {
  const [categories, goals, debts] = await Promise.all([
    typeof tx.listAllocationCategories === 'function'
      ? tx.listAllocationCategories({ householdId })
      : [],
    typeof tx.listGoals === 'function'
      ? tx.listGoals({ householdId })
      : [],
    typeof tx.listDebts === 'function'
      ? tx.listDebts({ householdId })
      : [],
  ]);

  const activeBucketSlugs = new Set(
    categories
      .filter((item) => item.isActive !== false)
      .map((item) => item.slug),
  );
  const activeGoalIds = new Set(
    goals
      .filter((item) => item.active !== false)
      .map((item) => item.id),
  );
  const activeDebtIds = new Set(
    debts
      .filter((item) => item.active !== false && item.isActive !== false)
      .map((item) => item.id),
  );

  for (const item of items) {
    if (item.destinationType === 'bucket' && !activeBucketSlugs.has(item.destinationBucketSlug)) {
      throw new HouseholdSurplusSplitRulesHttpError(422, `destination bucket ${item.destinationBucketSlug ?? '(missing)'} is unavailable`);
    }

    if (item.destinationType === 'goal' && !activeGoalIds.has(item.destinationGoalId)) {
      throw new HouseholdSurplusSplitRulesHttpError(422, `destination goal ${item.destinationGoalId ?? '(missing)'} is unavailable`);
    }

    if (item.destinationType === 'debt' && !activeDebtIds.has(item.destinationDebtId)) {
      throw new HouseholdSurplusSplitRulesHttpError(422, `destination debt ${item.destinationDebtId ?? '(missing)'} is unavailable`);
    }
  }
}

export async function listHouseholdSurplusSplitRules({ db, householdId }) {
  if (!householdId) {
    throw new HouseholdSurplusSplitRulesHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  return db.transaction(async (tx) => {
    const items = await tx.listSurplusSplitRules({ householdId });
    return {
      items: items.map(formatRule),
    };
  });
}

export async function replaceHouseholdSurplusSplitRules({ db, householdId, input }) {
  if (!householdId) {
    throw new HouseholdSurplusSplitRulesHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsed = parseWithSchema(replaceSchema, input);

  return db.transaction(async (tx) => {
    const existingRules = await tx.listSurplusSplitRules({ householdId });
    const normalized = normalizeItems(parsed.items, existingRules);
    validateNormalizedItems(normalized);
    await validateDestinations({ tx, householdId, items: normalized });

    const saved = await tx.replaceSurplusSplitRules({
      householdId,
      items: normalized,
    });

    return {
      items: saved.map(formatRule),
    };
  });
}
