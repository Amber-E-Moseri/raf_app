import { z } from 'zod';

export class TransactionHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TransactionHttpError';
    this.status = status;
  }
}

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a valid ISO date')
  .transform((value, context) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be a valid ISO date',
      });
      return z.NEVER;
    }

    return value;
  });

const moneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value.trim()))
  .refine((value) => /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value), {
    message: 'must be a decimal with up to 2 places',
  })
  .transform((value) => {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [whole, fraction = ''] = unsigned.split('.');
    return `${negative ? '-' : ''}${whole}.${(fraction + '00').slice(0, 2)}`;
  })
  .refine((value) => value !== '0.00' && value !== '-0.00', {
    message: 'must not be 0',
  });

const directionSchema = z.enum(['debit', 'credit']);

const nullableTrimmedString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value == null) {
      return null;
    }

    const normalized = value.trim();
    return normalized || null;
  });

export const createTransactionSchema = z
  .object({
    transactionDate: isoDateSchema,
    description: z.string().trim().min(1, 'description is required'),
    merchant: nullableTrimmedString,
    amount: moneySchema,
    direction: directionSchema,
    categoryId: nullableTrimmedString,
    linkedDebtId: nullableTrimmedString,
  })
  .superRefine((value, context) => {
    const amountCents = parseMoneyToCents(value.amount);
    if (amountCents < 0 && value.direction !== 'credit') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'negative amounts are only allowed for credit transactions',
      });
    }

    if (value.linkedDebtId) {
      if (value.direction !== 'debit') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['linkedDebtId'],
          message: 'linkedDebtId requires a debit transaction',
        });
      }

      if (amountCents <= 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['linkedDebtId'],
          message: 'linkedDebtId requires a positive amount',
        });
      }
    }
  });

export const updateTransactionSchema = z
  .object({
    transactionDate: isoDateSchema.optional(),
    description: z.string().trim().min(1, 'description is required').optional(),
    merchant: z.union([z.string(), z.null()]).transform((value) => {
      if (value == null) {
        return null;
      }

      const normalized = value.trim();
      return normalized || null;
    }).optional(),
    amount: moneySchema.optional(),
    direction: directionSchema.optional(),
    categoryId: z.union([z.string(), z.null()]).transform((value) => {
      if (value == null) {
        return null;
      }

      const normalized = value.trim();
      return normalized || null;
    }).optional(),
    linkedDebtId: z.union([z.string(), z.null()]).transform((value) => {
      if (value == null) {
        return null;
      }

      const normalized = value.trim();
      return normalized || null;
    }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field is required',
  });

const listTransactionsSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  categoryId: nullableTrimmedString,
  direction: z.union([directionSchema, z.null(), z.undefined()]).transform((value) => value ?? null),
  cursor: nullableTrimmedString,
  limit: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((value) => {
      if (value == null || value === '') {
        return 50;
      }

      return typeof value === 'number' ? value : Number(value);
    })
    .refine((value) => Number.isInteger(value) && value > 0 && value <= 100, {
      message: 'must be an integer between 1 and 100',
    }),
});

function parseMoneyToCents(value) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = '00'] = unsigned.split('.');
  const cents = Number(whole) * 100 + Number(fraction);
  return negative ? -cents : cents;
}

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Transaction DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new TransactionHttpError(400, `${path} ${issue.message}`);
  }

  return result.data;
}

function formatTransaction(transaction) {
  return {
    id: transaction.id,
    transactionDate: transaction.transactionDate,
    description: transaction.description,
    merchant: transaction.merchant ?? null,
    amount: transaction.amount,
    direction: transaction.direction,
    categoryId: transaction.categoryId ?? null,
    linkedDebtId: transaction.linkedDebtId ?? null,
  };
}

async function ensureDebtExists(tx, householdId, linkedDebtId) {
  if (!linkedDebtId) {
    return null;
  }

  const debt = await tx.findDebtById({
    householdId,
    debtId: linkedDebtId,
  });

  if (!debt) {
    throw new TransactionHttpError(404, 'linked debt not found');
  }

  return debt;
}

async function syncDebtPayment({ tx, householdId, transaction }) {
  await tx.deleteDebtPaymentByTransactionId({
    householdId,
    transactionId: transaction.id,
  });

  if (!transaction.linkedDebtId) {
    return;
  }

  await tx.insertDebtPayment({
    householdId,
    debtId: transaction.linkedDebtId,
    transactionId: transaction.id,
    paymentDate: transaction.transactionDate,
    amount: transaction.amount,
  });
}

export async function createTransaction({ db, householdId, input }) {
  if (!householdId) {
    throw new TransactionHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedInput = parseWithSchema(createTransactionSchema, input);

  return db.transaction(async (tx) => {
    await ensureDebtExists(tx, householdId, parsedInput.linkedDebtId);

    const transaction = await tx.insertTransaction({
      householdId,
      transactionDate: parsedInput.transactionDate,
      description: parsedInput.description,
      merchant: parsedInput.merchant,
      amount: parsedInput.amount,
      direction: parsedInput.direction,
      categoryId: parsedInput.categoryId,
      linkedDebtId: parsedInput.linkedDebtId,
      source: 'manual',
    });

    await syncDebtPayment({
      tx,
      householdId,
      transaction: {
        ...transaction,
        ...parsedInput,
      },
    });

    return formatTransaction({
      ...transaction,
      ...parsedInput,
    });
  });
}

export async function listTransactions({ db, householdId, query }) {
  if (!householdId) {
    throw new TransactionHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedQuery = parseWithSchema(listTransactionsSchema, query);
  if (parsedQuery.from > parsedQuery.to) {
    throw new TransactionHttpError(400, 'from must be before or equal to to');
  }

  return db.transaction(async (tx) => {
    const result = await tx.listTransactions({
      householdId,
      from: parsedQuery.from,
      to: parsedQuery.to,
      categoryId: parsedQuery.categoryId,
      direction: parsedQuery.direction,
      cursor: parsedQuery.cursor,
      limit: parsedQuery.limit,
    });

    return {
      items: result.items.map(formatTransaction),
      nextCursor: result.nextCursor ?? null,
    };
  });
}

export async function updateTransaction({ db, householdId, transactionId, input }) {
  if (!householdId) {
    throw new TransactionHttpError(400, 'householdId is required');
  }

  if (!transactionId) {
    throw new TransactionHttpError(400, 'transactionId is required');
  }

  requireDbContract(db);
  const parsedInput = parseWithSchema(updateTransactionSchema, input);

  return db.transaction(async (tx) => {
    const existing = await tx.getTransactionById({
      householdId,
      transactionId,
    });

    if (!existing) {
      throw new TransactionHttpError(404, 'transaction not found');
    }

    const nextTransaction = {
      transactionDate: parsedInput.transactionDate ?? existing.transactionDate,
      description: parsedInput.description ?? existing.description,
      merchant: Object.prototype.hasOwnProperty.call(parsedInput, 'merchant') ? parsedInput.merchant : existing.merchant ?? null,
      amount: parsedInput.amount ?? existing.amount,
      direction: parsedInput.direction ?? existing.direction,
      categoryId: Object.prototype.hasOwnProperty.call(parsedInput, 'categoryId') ? parsedInput.categoryId : existing.categoryId ?? null,
      linkedDebtId: Object.prototype.hasOwnProperty.call(parsedInput, 'linkedDebtId') ? parsedInput.linkedDebtId : existing.linkedDebtId ?? null,
    };

    const validation = parseWithSchema(createTransactionSchema, nextTransaction);
    await ensureDebtExists(tx, householdId, validation.linkedDebtId);

    const updated = await tx.updateTransaction({
      householdId,
      transactionId,
      patch: validation,
    });

    await syncDebtPayment({
      tx,
      householdId,
      transaction: {
        ...updated,
        ...validation,
        id: transactionId,
      },
    });

    return formatTransaction({
      ...updated,
      ...validation,
      id: transactionId,
    });
  });
}

export async function deleteTransaction({ db, householdId, transactionId }) {
  if (!householdId) {
    throw new TransactionHttpError(400, 'householdId is required');
  }

  if (!transactionId) {
    throw new TransactionHttpError(400, 'transactionId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const existing = await tx.getTransactionById({
      householdId,
      transactionId,
    });

    if (!existing) {
      throw new TransactionHttpError(404, 'transaction not found');
    }

    await tx.deleteDebtPaymentByTransactionId({
      householdId,
      transactionId,
    });

    await tx.deleteTransaction({
      householdId,
      transactionId,
    });
  });
}

export const __internal = {
  createTransactionSchema,
  listTransactionsSchema,
  parseMoneyToCents,
  updateTransactionSchema,
};
