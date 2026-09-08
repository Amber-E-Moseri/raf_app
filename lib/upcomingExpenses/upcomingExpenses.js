import { z } from 'zod';

export class UpcomingExpenseError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'UpcomingExpenseError';
    this.status = status;
  }
}

const moneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : String(v).trim()))
  .refine((v) => moneyPattern.test(v), { message: 'amount must be a non-negative decimal' })
  .transform((v) => {
    const [whole, fraction = ''] = v.split('.');
    return `${whole}.${(fraction + '00').slice(0, 2)}`;
  });

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  amount: moneySchema,
  expectedDate: z.string().regex(isoDatePattern, 'expectedDate must be YYYY-MM-DD'),
  category: z.string().trim().max(100).optional().nullable(),
  accountId: z.string().trim().max(100).optional().nullable(),
  priority: z.enum(['essential', 'planned', 'optional']).optional().default('planned'),
  confidence: z.enum(['confirmed', 'expected']).optional().default('confirmed'),
  notes: z.string().trim().max(1000).optional().nullable(),
  status: z.enum(['active', 'archived']).optional().default('active'),
});

const updateSchema = createSchema.partial().omit({ status: true }).extend({
  status: z.enum(['active', 'archived']).optional(),
});

export async function listUpcomingExpenses({ db, householdId, status = null }) {
  if (!householdId) throw new UpcomingExpenseError(400, 'householdId is required');
  return db.transaction((tx) => tx.listUpcomingExpenses({ householdId, status }));
}

export async function createUpcomingExpense({ db, householdId, input }) {
  if (!householdId) throw new UpcomingExpenseError(400, 'householdId is required');
  const result = createSchema.safeParse(input ?? {});
  if (!result.success) {
    throw new UpcomingExpenseError(400, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return db.transaction((tx) => tx.insertUpcomingExpense({ householdId, ...result.data }));
}

export async function getUpcomingExpense({ db, householdId, expenseId }) {
  if (!householdId) throw new UpcomingExpenseError(400, 'householdId is required');
  const expense = await db.transaction((tx) => tx.getUpcomingExpenseById({ householdId, expenseId }));
  if (!expense) throw new UpcomingExpenseError(404, 'Upcoming expense not found');
  return expense;
}

export async function updateUpcomingExpense({ db, householdId, expenseId, input }) {
  if (!householdId) throw new UpcomingExpenseError(400, 'householdId is required');
  await getUpcomingExpense({ db, householdId, expenseId });
  const result = updateSchema.safeParse(input ?? {});
  if (!result.success) {
    throw new UpcomingExpenseError(400, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return db.transaction((tx) => tx.updateUpcomingExpense({ householdId, expenseId, patch: result.data }));
}

export async function deleteUpcomingExpense({ db, householdId, expenseId }) {
  if (!householdId) throw new UpcomingExpenseError(400, 'householdId is required');
  await getUpcomingExpense({ db, householdId, expenseId });
  return db.transaction((tx) => tx.deleteUpcomingExpense({ householdId, expenseId }));
}
