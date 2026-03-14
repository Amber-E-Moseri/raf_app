import { z } from 'zod';

import { computeBucketBalancesSnapshot, formatCents, parseMoneyToCents } from '../raf/reporting.js';

export class GoalHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GoalHttpError';
    this.status = status;
  }
}

const moneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const positiveMoneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value.trim()))
  .refine((value) => moneyPattern.test(value), {
    message: 'must be a positive decimal with up to 2 places',
  })
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${(fraction + '00').slice(0, 2)}`;
  })
  .refine((value) => value !== '0.00', {
    message: 'must be greater than 0',
  });

const isoDateSchema = z.string().trim().refine((value) => isoDatePattern.test(value), {
  message: 'must be a valid ISO date',
});

const trimmedStringSchema = z.string().trim().min(1, 'is required');
const nullableNotesSchema = z.union([z.string().trim(), z.literal(null)]).optional();

export const createGoalSchema = z.object({
  bucket_id: trimmedStringSchema.optional(),
  bucketId: trimmedStringSchema.optional(),
  name: trimmedStringSchema,
  target_amount: positiveMoneySchema.optional(),
  targetAmount: positiveMoneySchema.optional(),
  target_date: z.union([isoDateSchema, z.literal(null)]).optional(),
  targetDate: z.union([isoDateSchema, z.literal(null)]).optional(),
  notes: nullableNotesSchema,
  active: z.boolean().optional().default(true),
}).superRefine((value, context) => {
  if (!value.bucket_id && !value.bucketId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bucket_id'],
      message: 'is required',
    });
  }

  if (!value.target_amount && !value.targetAmount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target_amount'],
      message: 'is required',
    });
  }
});

export const updateGoalSchema = z.object({
  bucket_id: trimmedStringSchema.optional(),
  bucketId: trimmedStringSchema.optional(),
  name: trimmedStringSchema.optional(),
  target_amount: positiveMoneySchema.optional(),
  targetAmount: positiveMoneySchema.optional(),
  target_date: z.union([isoDateSchema, z.literal(null)]).optional(),
  targetDate: z.union([isoDateSchema, z.literal(null)]).optional(),
  notes: z.union([z.string().trim(), z.literal(null)]).optional(),
  active: z.boolean().optional(),
}).superRefine((value, context) => {
  const keys = ['bucket_id', 'bucketId', 'name', 'target_amount', 'targetAmount', 'target_date', 'targetDate', 'notes', 'active'];
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'at least one editable field is required',
    });
  }
});

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Goal DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input, status = 400) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new GoalHttpError(status, `${path} ${issue.message}`.trim());
  }

  return result.data;
}

function normalizeGoalInput(input) {
  return {
    bucketId: input.bucket_id ?? input.bucketId,
    name: input.name,
    targetAmount: input.target_amount ?? input.targetAmount,
    targetDate: input.target_date ?? input.targetDate ?? null,
    notes: input.notes ?? null,
    active: input.active,
  };
}

function formatGoalResponse(goal) {
  return {
    id: goal.id,
    household_id: goal.householdId,
    bucket_id: goal.bucketId,
    name: goal.name,
    target_amount: goal.targetAmount,
    target_date: goal.targetDate ?? null,
    notes: goal.notes ?? null,
    active: goal.active !== false,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
  };
}

async function requireActiveBucket(tx, householdId, bucketId) {
  const categories = await tx.listAllocationCategories({ householdId });
  const bucket = categories.find((category) => category.id === bucketId && category.isActive !== false);
  if (!bucket) {
    throw new GoalHttpError(422, `bucket_id must reference an active allocation bucket: ${bucketId}`);
  }

  return bucket;
}

function formatGoalProgress(goal, bucketBalance) {
  const bucketName = bucketBalance?.bucket_name ?? null;
  const reservedAmountCents = parseMoneyToCents(bucketBalance?.balance ?? '0.00');
  const targetAmountCents = parseMoneyToCents(goal.targetAmount);
  const remainingAmountCents = Math.max(targetAmountCents - reservedAmountCents, 0);
  const unclampedProgressPercent = targetAmountCents === 0 ? 0 : Number(((reservedAmountCents / targetAmountCents) * 100).toFixed(2));
  const progressPercent = Math.min(unclampedProgressPercent, 100);

  return {
    goal_id: goal.id,
    goal_name: goal.name,
    bucket_id: goal.bucketId,
    bucket: bucketName,
    bucket_name: bucketName,
    target_amount: formatCents(targetAmountCents),
    reserved_amount: formatCents(reservedAmountCents),
    current_amount: formatCents(reservedAmountCents),
    remaining_amount: formatCents(remainingAmountCents),
    progress_percent: progressPercent,
  };
}

export async function listGoals({ db, householdId }) {
  if (!householdId) {
    throw new GoalHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => ({
    items: (await tx.listGoals({ householdId })).map(formatGoalResponse),
  }));
}

export async function createGoal({ db, householdId, input }) {
  if (!householdId) {
    throw new GoalHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedInput = normalizeGoalInput(parseWithSchema(createGoalSchema, input));

  return db.transaction(async (tx) => {
    await requireActiveBucket(tx, householdId, parsedInput.bucketId);

    const created = await tx.insertGoal({
      householdId,
      bucketId: parsedInput.bucketId,
      name: parsedInput.name,
      targetAmount: parsedInput.targetAmount,
      targetDate: parsedInput.targetDate,
      notes: parsedInput.notes,
      active: parsedInput.active !== false,
    });

    return formatGoalResponse(created);
  });
}

export async function updateGoal({ db, householdId, goalId, input }) {
  if (!householdId) {
    throw new GoalHttpError(400, 'householdId is required');
  }

  if (!goalId) {
    throw new GoalHttpError(400, 'goalId is required');
  }

  requireDbContract(db);
  const parsedInput = normalizeGoalInput(parseWithSchema(updateGoalSchema, input));

  return db.transaction(async (tx) => {
    const existing = await tx.getGoalById({ householdId, goalId });
    if (!existing) {
      throw new GoalHttpError(404, 'goal not found');
    }

    if (parsedInput.bucketId) {
      await requireActiveBucket(tx, householdId, parsedInput.bucketId);
    }

    const updated = await tx.updateGoal({
      householdId,
      goalId,
      patch: {
        ...(parsedInput.bucketId != null ? { bucketId: parsedInput.bucketId } : {}),
        ...(parsedInput.name != null ? { name: parsedInput.name } : {}),
        ...(parsedInput.targetAmount != null ? { targetAmount: parsedInput.targetAmount } : {}),
        ...(Object.prototype.hasOwnProperty.call(parsedInput, 'targetDate') ? { targetDate: parsedInput.targetDate } : {}),
        ...(Object.prototype.hasOwnProperty.call(parsedInput, 'notes') ? { notes: parsedInput.notes } : {}),
        ...(parsedInput.active != null ? { active: parsedInput.active } : {}),
      },
    });

    return formatGoalResponse(updated);
  });
}

export async function deleteGoal({ db, householdId, goalId }) {
  if (!householdId) {
    throw new GoalHttpError(400, 'householdId is required');
  }

  if (!goalId) {
    throw new GoalHttpError(400, 'goalId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const existing = await tx.getGoalById({ householdId, goalId });
    if (!existing) {
      throw new GoalHttpError(404, 'goal not found');
    }

    await tx.updateGoal({
      householdId,
      goalId,
      patch: {
        active: false,
      },
    });
  });
}

export async function listGoalProgress({ db, householdId }) {
  if (!householdId) {
    throw new GoalHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const [goals, buckets, incomeAllocations, transactionsResult] = await Promise.all([
      tx.listGoals({ householdId }),
      tx.listAllocationCategories({ householdId }),
      tx.listIncomeAllocations({ householdId }),
      tx.listTransactions({ householdId }),
    ]);
    const transactions = Array.isArray(transactionsResult) ? transactionsResult : transactionsResult?.items ?? [];
    // RAF goal progress reflects the current saved balance inside the linked bucket.
    // It does not require a transfer transaction to have occurred outside RAF.
    const bucketBalances = computeBucketBalancesSnapshot({
      buckets,
      incomeAllocations,
      transactions,
    });
    const bucketBalancesById = new Map(bucketBalances.map((bucket) => [bucket.bucket_id, bucket]));

    return goals
      .filter((goal) => goal.active !== false)
      .filter((goal) => bucketBalancesById.has(goal.bucketId))
      .map((goal) => formatGoalProgress(goal, bucketBalancesById.get(goal.bucketId)));
  });
}

export const __internal = {
  createGoalSchema,
  formatGoalProgress,
  formatGoalResponse,
  normalizeGoalInput,
  updateGoalSchema,
};
