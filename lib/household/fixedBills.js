import { z } from 'zod';

export class FixedBillHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'FixedBillHttpError';
    this.status = status;
  }
}

const isoMoneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

const moneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value.trim()))
  .refine((value) => isoMoneyPattern.test(value), {
    message: 'must be a positive decimal with up to 2 places',
  })
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${(fraction + '00').slice(0, 2)}`;
  })
  .refine((value) => value !== '0.00', {
    message: 'must be greater than 0',
  });

const slugSchema = z.string().trim().min(1, 'is required');
const nameSchema = z.string().trim().min(1, 'is required');
const dueDaySchema = z.number().int().min(1, 'must be between 1 and 31').max(31, 'must be between 1 and 31');

const createFixedBillSchema = z.object({
  name: nameSchema,
  category_slug: slugSchema.optional(),
  categorySlug: slugSchema.optional(),
  expected_amount: moneySchema.optional(),
  expectedAmount: moneySchema.optional(),
  due_day_of_month: dueDaySchema.optional(),
  dueDayOfMonth: dueDaySchema.optional(),
  active: z.boolean().optional().default(true),
}).superRefine((value, context) => {
  if (!value.category_slug && !value.categorySlug) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['category_slug'],
      message: 'is required',
    });
  }

  if (!value.expected_amount && !value.expectedAmount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expected_amount'],
      message: 'is required',
    });
  }

  if (value.due_day_of_month == null && value.dueDayOfMonth == null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['due_day_of_month'],
      message: 'is required',
    });
  }
});

const updateFixedBillSchema = z.object({
  name: nameSchema.optional(),
  category_slug: slugSchema.optional(),
  categorySlug: slugSchema.optional(),
  expected_amount: moneySchema.optional(),
  expectedAmount: moneySchema.optional(),
  due_day_of_month: dueDaySchema.optional(),
  dueDayOfMonth: dueDaySchema.optional(),
  active: z.boolean().optional(),
}).superRefine((value, context) => {
  const keys = ['name', 'category_slug', 'categorySlug', 'expected_amount', 'expectedAmount', 'due_day_of_month', 'dueDayOfMonth', 'active'];
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'at least one editable field is required',
    });
  }
});

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Fixed bill DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input, status = 400) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new FixedBillHttpError(status, `${path} ${issue.message}`.trim());
  }

  return result.data;
}

function normalizePayload(input) {
  return {
    name: input.name,
    category_slug: input.category_slug ?? input.categorySlug,
    expected_amount: input.expected_amount ?? input.expectedAmount,
    due_day_of_month: input.due_day_of_month ?? input.dueDayOfMonth,
    active: input.active,
  };
}

function formatFixedBillResponse(fixedBill) {
  return {
    id: fixedBill.id,
    household_id: fixedBill.householdId,
    name: fixedBill.name,
    category_slug: fixedBill.categorySlug,
    expected_amount: fixedBill.expectedAmount,
    due_day_of_month: fixedBill.dueDayOfMonth,
    active: fixedBill.active !== false,
    created_at: fixedBill.createdAt,
    updated_at: fixedBill.updatedAt,
  };
}

async function requireActiveAllocationCategory(tx, householdId, categorySlug) {
  const categories = await tx.listAllocationCategories({ householdId });
  const matched = categories.find((category) => category.slug === categorySlug && category.isActive !== false);
  if (!matched) {
    throw new FixedBillHttpError(422, `category_slug must reference an active allocation category: ${categorySlug}`);
  }
}

export async function listFixedBills({ db, householdId }) {
  if (!householdId) {
    throw new FixedBillHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => ({
    items: (await tx.listFixedBills({ householdId })).map(formatFixedBillResponse),
  }));
}

export async function createFixedBill({ db, householdId, input }) {
  if (!householdId) {
    throw new FixedBillHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedInput = normalizePayload(parseWithSchema(createFixedBillSchema, input));

  return db.transaction(async (tx) => {
    await requireActiveAllocationCategory(tx, householdId, parsedInput.category_slug);

    const created = await tx.insertFixedBill({
      householdId,
      name: parsedInput.name,
      categorySlug: parsedInput.category_slug,
      expectedAmount: parsedInput.expected_amount,
      dueDayOfMonth: parsedInput.due_day_of_month,
      active: parsedInput.active !== false,
    });

    return formatFixedBillResponse(created);
  });
}

export async function updateFixedBill({ db, householdId, fixedBillId, input }) {
  if (!householdId) {
    throw new FixedBillHttpError(400, 'householdId is required');
  }

  if (!fixedBillId) {
    throw new FixedBillHttpError(400, 'fixedBillId is required');
  }

  requireDbContract(db);
  const parsedInput = normalizePayload(parseWithSchema(updateFixedBillSchema, input));

  return db.transaction(async (tx) => {
    const existing = await tx.getFixedBillById({ householdId, fixedBillId });
    if (!existing) {
      throw new FixedBillHttpError(404, 'fixed bill not found');
    }

    if (parsedInput.category_slug) {
      await requireActiveAllocationCategory(tx, householdId, parsedInput.category_slug);
    }

    const updated = await tx.updateFixedBill({
      householdId,
      fixedBillId,
      patch: {
        ...(parsedInput.name != null ? { name: parsedInput.name } : {}),
        ...(parsedInput.category_slug != null ? { categorySlug: parsedInput.category_slug } : {}),
        ...(parsedInput.expected_amount != null ? { expectedAmount: parsedInput.expected_amount } : {}),
        ...(parsedInput.due_day_of_month != null ? { dueDayOfMonth: parsedInput.due_day_of_month } : {}),
        ...(parsedInput.active != null ? { active: parsedInput.active } : {}),
      },
    });

    return formatFixedBillResponse(updated);
  });
}

export async function deleteFixedBill({ db, householdId, fixedBillId }) {
  if (!householdId) {
    throw new FixedBillHttpError(400, 'householdId is required');
  }

  if (!fixedBillId) {
    throw new FixedBillHttpError(400, 'fixedBillId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const existing = await tx.getFixedBillById({ householdId, fixedBillId });
    if (!existing) {
      throw new FixedBillHttpError(404, 'fixed bill not found');
    }

    await tx.updateFixedBill({
      householdId,
      fixedBillId,
      patch: {
        active: false,
      },
    });
  });
}

export const __internal = {
  createFixedBillSchema,
  formatFixedBillResponse,
  normalizePayload,
  updateFixedBillSchema,
};
