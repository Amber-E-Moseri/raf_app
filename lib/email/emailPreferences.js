import { z } from 'zod';

export class EmailPreferencesHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'EmailPreferencesHttpError';
    this.status = status;
  }
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const patchSchema = z.object({
  remindersEnabled: z.boolean().optional(),
  preferredDay: z.enum(DAYS).optional(),
  preferredHour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().trim().min(1).optional(),
  contactEmail: z.string().email().optional().nullable(),
  optedInWeeklySummary: z.boolean().optional(),
  optedInPendingImports: z.boolean().optional(),
  optedInBudgetAlerts: z.boolean().optional(),
});

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('DB adapter must implement transaction().');
  }
}

function formatPrefs(row) {
  return {
    remindersEnabled: row.remindersEnabled ?? true,
    preferredDay: row.preferredDay ?? 'monday',
    preferredHour: row.preferredHour ?? 9,
    timezone: row.timezone ?? 'America/New_York',
    contactEmail: row.contactEmail ?? null,
    optedInWeeklySummary: row.optedInWeeklySummary ?? true,
    optedInPendingImports: row.optedInPendingImports ?? true,
    optedInBudgetAlerts: row.optedInBudgetAlerts ?? true,
    lastReminderSentAt: row.lastReminderSentAt ?? null,
  };
}

export async function getEmailPreferences({ db, householdId }) {
  if (!householdId) throw new EmailPreferencesHttpError(400, 'householdId is required');
  requireDbContract(db);

  return db.transaction(async (tx) => {
    const row = await tx.getEmailPreferences({ householdId });
    return row ? formatPrefs(row) : formatPrefs({ householdId });
  });
}

export async function patchEmailPreferences({ db, householdId, input }) {
  if (!householdId) throw new EmailPreferencesHttpError(400, 'householdId is required');
  requireDbContract(db);

  const result = patchSchema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new EmailPreferencesHttpError(400, `${issue.path.join('.') || 'request'} ${issue.message}`);
  }

  if (result.data.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: result.data.timezone });
    } catch {
      throw new EmailPreferencesHttpError(400, 'timezone must be a valid IANA timezone');
    }
  }

  return db.transaction(async (tx) => {
    const row = await tx.upsertEmailPreferences({ householdId, patch: result.data });
    return formatPrefs(row);
  });
}
