import { z } from 'zod';

export class HouseholdHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HouseholdHttpError';
    this.status = status;
  }
}

const moneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => typeof value === 'number' ? value.toFixed(2) : value.trim())
  .refine((value) => /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value), {
    message: 'must be a non-negative money amount with up to 2 decimals',
  })
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${(fraction + '00').slice(0, 2)}`;
  });

const isoFirstDaySchema = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), { message: 'must be a valid ISO date' })
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value.endsWith('-01');
  }, { message: 'must be the first day of the month' });

const patchHouseholdSchema = z.object({
  timezone: z.string().trim().min(1).optional(),
  periodStartDay: z.number().int().min(1).max(28).optional(),
  activeMonth: isoFirstDaySchema.optional(),
  savingsFloor: moneySchema.optional(),
  savingsFloorEnabled: z.boolean().optional(),
  monthlyEssentialsBaseline: moneySchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'at least one household field must be provided',
});

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Household DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input, status = 400) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new HouseholdHttpError(status, `${path} ${issue.message}`);
  }

  return result.data;
}

function formatHouseholdResponse(household) {
  return {
    id: household.id,
    name: household.name,
    timezone: household.timezone,
    activeMonth: household.activeMonth,
    periodStartDay: household.periodStartDay,
    savingsFloor: household.savingsFloor ?? '0.00',
    savingsFloorEnabled: household.savingsFloorEnabled === true,
    monthlyEssentialsBaseline: household.monthlyEssentialsBaseline ?? '0.00',
  };
}

export async function getHousehold({ db, householdId }) {
  if (!householdId) {
    throw new HouseholdHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const household = await tx.getHousehold({ householdId });
    if (!household) {
      throw new HouseholdHttpError(404, 'household not found');
    }

    return formatHouseholdResponse(household);
  });
}

export async function patchHousehold({ db, householdId, input }) {
  if (!householdId) {
    throw new HouseholdHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const patch = parseWithSchema(patchHouseholdSchema, input);

  return db.transaction(async (tx) => {
    const household = await tx.getHousehold({ householdId });
    if (!household) {
      throw new HouseholdHttpError(404, 'household not found');
    }

    if (typeof tx.updateHousehold !== 'function') {
      throw new Error('Household DB adapter must implement updateHousehold().');
    }

    const updated = await tx.updateHousehold({
      householdId,
      patch,
    });

    return formatHouseholdResponse(updated);
  });
}
