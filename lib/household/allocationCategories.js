import { z } from 'zod';

export class HouseholdAllocationCategoriesHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HouseholdAllocationCategoriesHttpError';
    this.status = status;
  }
}

const FRACTION_SCALE = 10000;
const SUM_TOLERANCE_BPS = 1;

const allocationPercentSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(4) : value.trim()))
  .refine((value) => /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value), {
    message: 'allocationPercent must be a decimal with up to 4 places',
  })
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${(fraction + '0000').slice(0, 4)}`;
  });

const replaceItemSchema = z.object({
  slug: z.string().trim().min(1, 'slug is required'),
  label: z.union([z.string(), z.undefined()]).transform((value) => value == null ? undefined : value.trim()),
  name: z.union([z.string(), z.undefined()]).transform((value) => value == null ? undefined : value.trim()),
  sortOrder: z.number().int(),
  allocationPercent: allocationPercentSchema.optional(),
  percent: allocationPercentSchema.optional(),
  isActive: z.boolean(),
  isBuffer: z.boolean().optional(),
}).superRefine((value, context) => {
  if (!value.label && !value.name) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['label'],
      message: 'label is required',
    });
  }

  if (!value.allocationPercent && !value.percent) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allocationPercent'],
      message: 'allocationPercent is required',
    });
  }
});

const replaceAllocationCategoriesSchema = z.object({
  items: z.array(replaceItemSchema).min(1, 'items is required'),
});

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Household allocation category DB adapter must implement transaction().');
  }
}

function parseFractionToBps(value) {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * FRACTION_SCALE + Number((fraction + '0000').slice(0, 4));
}

function parseWithSchema(schema, input, status = 400) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new HouseholdAllocationCategoriesHttpError(status, `${path} ${issue.message}`);
  }

  return result.data;
}

function isBufferCategory(category) {
  return category.isBuffer === true || (category.isBuffer == null && category.slug === 'buffer');
}

function formatCategoryResponse(category) {
  return {
    id: category.id,
    name: category.label,
    label: category.label,
    slug: category.slug,
    percent: category.allocationPercent,
    allocationPercent: category.allocationPercent,
    isActive: category.isActive !== false,
    active: category.isActive !== false,
    sortOrder: category.sortOrder ?? 0,
    isSystem: category.isSystem === true,
    isBuffer: isBufferCategory(category),
  };
}

function normalizeItems(items) {
  return items.map((item) => ({
    slug: item.slug,
    label: item.label ?? item.name,
    allocationPercent: item.allocationPercent ?? item.percent,
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    isBuffer: item.isBuffer,
  }));
}

function validateNormalizedItems(items, existingCategories) {
  const existingBySlug = new Map(existingCategories.map((category) => [category.slug, category]));
  const incomingSlugs = new Set();

  for (const item of items) {
    if (incomingSlugs.has(item.slug)) {
      throw new HouseholdAllocationCategoriesHttpError(400, `items duplicate slug ${item.slug}`);
    }

    incomingSlugs.add(item.slug);
    if (!existingBySlug.has(item.slug)) {
      throw new HouseholdAllocationCategoriesHttpError(
        422,
        `new allocation category slugs are not supported in the runnable backend: ${item.slug}`,
      );
    }
  }

  for (const existing of existingCategories) {
    if (!incomingSlugs.has(existing.slug)) {
      throw new HouseholdAllocationCategoriesHttpError(
        422,
        `omitting existing allocation categories is not supported in the runnable backend: ${existing.slug}`,
      );
    }
  }

  const merged = items.map((item) => {
    const existing = existingBySlug.get(item.slug);
    return {
      ...existing,
      label: item.label,
      allocationPercent: item.allocationPercent,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      isBuffer: item.isBuffer ?? existing.isBuffer ?? existing.slug === 'buffer',
    };
  });

  const activeCategories = merged.filter((category) => category.isActive !== false);
  if (activeCategories.length === 0) {
    throw new HouseholdAllocationCategoriesHttpError(422, 'at least one active allocation category is required');
  }

  const bufferCategories = activeCategories.filter(isBufferCategory);
  if (bufferCategories.length !== 1) {
    throw new HouseholdAllocationCategoriesHttpError(422, 'exactly one active buffer category is required');
  }

  const totalBps = activeCategories.reduce((sum, category) => sum + parseFractionToBps(category.allocationPercent), 0);
  if (Math.abs(totalBps - FRACTION_SCALE) > SUM_TOLERANCE_BPS) {
    throw new HouseholdAllocationCategoriesHttpError(422, 'active allocation percentages must sum to 1.0000 +/- 0.0001');
  }

  return merged;
}

export async function listHouseholdAllocationCategories({ db, householdId }) {
  if (!householdId) {
    throw new HouseholdAllocationCategoriesHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => ({
    items: (await tx.listAllocationCategories({ householdId })).map(formatCategoryResponse),
  }));
}

export async function replaceHouseholdAllocationCategories({ db, householdId, input }) {
  if (!householdId) {
    throw new HouseholdAllocationCategoriesHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedInput = parseWithSchema(replaceAllocationCategoriesSchema, input);
  const normalizedItems = normalizeItems(parsedInput.items);

  return db.transaction(async (tx) => {
    const existingCategories = await tx.listAllocationCategories({ householdId });
    const merged = validateNormalizedItems(normalizedItems, existingCategories);

    const updated = await tx.replaceAllocationCategories({
      householdId,
      items: merged.map((category) => ({
        slug: category.slug,
        label: category.label,
        allocationPercent: category.allocationPercent,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        isBuffer: category.isBuffer,
      })),
    });

    return {
      items: updated.map(formatCategoryResponse),
      notes: [
        'Rounding remainder is routed to the configured buffer category.',
      ],
    };
  });
}

export const __internal = {
  formatCategoryResponse,
  isBufferCategory,
  normalizeItems,
  replaceAllocationCategoriesSchema,
  validateNormalizedItems,
};
