import { z } from 'zod';

import { buildDebtListResponse, deriveDebtSnapshot } from '../raf/debts.js';

export class DebtHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DebtHttpError';
    this.status = status;
  }
}

const isoMoneyPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const aprPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

const nonNegativeMoneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value.trim()))
  .refine((value) => isoMoneyPattern.test(value), {
    message: 'must be a non-negative decimal with up to 2 places',
  })
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${(fraction + '00').slice(0, 2)}`;
  });

const positiveMoneySchema = nonNegativeMoneySchema.refine((value) => value !== '0.00', {
  message: 'must be greater than 0',
});

const aprSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value.trim()))
  .refine((value) => aprPattern.test(value), {
    message: 'must be a non-negative decimal with up to 2 places',
  })
  .transform((value) => Number(value))
  .refine((value) => value >= 0 && value <= 100, {
    message: 'must be between 0 and 100',
  })
  .transform((value) => Number(value.toFixed(2)));

const trimmedStringSchema = z.string().trim().min(1, 'is required');

export const createDebtSchema = z.object({
  name: trimmedStringSchema,
  startingBalance: positiveMoneySchema,
  apr: aprSchema,
  minimumPayment: nonNegativeMoneySchema,
  monthlyPayment: nonNegativeMoneySchema,
  sortOrder: z.number().int().optional().default(0),
});

export const updateDebtSchema = z
  .object({
    name: trimmedStringSchema.optional(),
    apr: aprSchema.optional(),
    minimumPayment: nonNegativeMoneySchema.optional(),
    monthlyPayment: nonNegativeMoneySchema.optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
    startingBalance: z.any().optional(),
    currentBalance: z.any().optional(),
  })
  .superRefine((value, context) => {
    if (Object.prototype.hasOwnProperty.call(value, 'startingBalance')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startingBalance'],
        message: 'is a derived or immutable balance field and cannot be edited',
      });
    }

    if (Object.prototype.hasOwnProperty.call(value, 'currentBalance')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentBalance'],
        message: 'is a derived or immutable balance field and cannot be edited',
      });
    }

    const editableKeys = ['name', 'apr', 'minimumPayment', 'monthlyPayment', 'sortOrder', 'isActive'];
    if (!editableKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one editable field is required',
      });
    }
  });

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Debt DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input, { businessRule = false } = {}) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new DebtHttpError(businessRule ? 422 : 400, `${path} ${issue.message}`.trim());
  }

  return result.data;
}

function groupDebtPaymentsByDebtId(payments) {
  const byDebtId = new Map();

  for (const payment of payments) {
    const existing = byDebtId.get(payment.debtId) ?? [];
    existing.push(payment);
    byDebtId.set(payment.debtId, existing);
  }

  return byDebtId;
}

function formatDebtResponse(snapshot) {
  return {
    id: snapshot.id,
    name: snapshot.name,
    startingBalance: snapshot.startingBalance,
    currentBalance: snapshot.currentBalance,
    apr: snapshot.apr,
    minimumPayment: snapshot.minimumPayment,
    monthlyPayment: snapshot.monthlyPayment,
    status: snapshot.status,
    sortOrder: snapshot.sortOrder,
    isActive: snapshot.isActive,
  };
}

export async function createDebt({ db, householdId, input }) {
  if (!householdId) {
    throw new DebtHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const parsedInput = parseWithSchema(createDebtSchema, input);

  return db.transaction(async (tx) => {
    const created = await tx.insertDebt({
      householdId,
      name: parsedInput.name,
      startingBalance: parsedInput.startingBalance,
      apr: parsedInput.apr,
      minimumPayment: parsedInput.minimumPayment,
      monthlyPayment: parsedInput.monthlyPayment,
      sortOrder: parsedInput.sortOrder,
      isActive: true,
    });

    return formatDebtResponse(
      deriveDebtSnapshot({
        ...created,
        ...parsedInput,
        id: created.id,
        isActive: created.isActive ?? true,
      }),
    );
  });
}

export async function listDebts({ db, householdId }) {
  if (!householdId) {
    throw new DebtHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const debts = await tx.listDebts({ householdId });
    const debtPayments = await tx.listDebtPayments({ householdId });

    return buildDebtListResponse(debts, groupDebtPaymentsByDebtId(debtPayments));
  });
}

export async function updateDebt({ db, householdId, debtId, input }) {
  if (!householdId) {
    throw new DebtHttpError(400, 'householdId is required');
  }

  if (!debtId) {
    throw new DebtHttpError(400, 'debtId is required');
  }

  requireDbContract(db);

  if (Object.prototype.hasOwnProperty.call(input ?? {}, 'startingBalance')
    || Object.prototype.hasOwnProperty.call(input ?? {}, 'currentBalance')) {
    parseWithSchema(updateDebtSchema, input, { businessRule: true });
  }

  const parsedInput = parseWithSchema(updateDebtSchema, input);

  return db.transaction(async (tx) => {
    const existing = await tx.getDebtById({ householdId, debtId });
    if (!existing) {
      throw new DebtHttpError(404, 'debt not found');
    }

    const updated = await tx.updateDebt({
      householdId,
      debtId,
      patch: parsedInput,
    });

    const payments = await tx.listDebtPayments({ householdId, debtId });

    return formatDebtResponse(
      deriveDebtSnapshot(
        {
          ...existing,
          ...updated,
          ...parsedInput,
          id: debtId,
        },
        payments,
      ),
    );
  });
}

export async function deleteDebt({ db, householdId, debtId }) {
  if (!householdId) {
    throw new DebtHttpError(400, 'householdId is required');
  }

  if (!debtId) {
    throw new DebtHttpError(400, 'debtId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const existing = await tx.getDebtById({ householdId, debtId });
    if (!existing) {
      throw new DebtHttpError(404, 'debt not found');
    }

    const paymentCount = await tx.countDebtPaymentsForDebt({ householdId, debtId });
    if (paymentCount > 0) {
      throw new DebtHttpError(422, 'debt has linked payments; set isActive=false instead');
    }

    await tx.deleteDebt({ householdId, debtId });
  });
}

export const __internal = {
  createDebtSchema,
  updateDebtSchema,
  groupDebtPaymentsByDebtId,
};
