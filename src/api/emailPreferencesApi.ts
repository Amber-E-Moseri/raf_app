import { getJson, patchJson } from "./client";

export interface EmailPreferences {
  remindersEnabled: boolean;
  preferredDay: string;
  preferredHour: number;
  timezone: string;
  contactEmail: string | null;
  optedInWeeklySummary: boolean;
  optedInPendingImports: boolean;
  optedInBudgetAlerts: boolean;
  lastReminderSentAt: string | null;
}

export async function getEmailPreferences(): Promise<EmailPreferences> {
  return getJson<EmailPreferences>("household/email-preferences");
}

export async function patchEmailPreferences(patch: Partial<Omit<EmailPreferences, "lastReminderSentAt">>): Promise<EmailPreferences> {
  return patchJson<EmailPreferences>("household/email-preferences", patch);
}
