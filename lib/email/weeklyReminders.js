import { sendEmail } from './emailService.js';
import { renderPendingImportsEmail } from './templates/pendingImports.js';
import { renderMonthlyReviewPromptEmail } from './templates/monthlyReviewPrompt.js';
import { renderBudgetStatusEmail } from './templates/budgetStatus.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function nowInTimezone(tz) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      hour: 'numeric',
      hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((p) => [p.type, p.value]));
    return {
      day: parts.weekday?.toLowerCase() ?? 'monday',
      hour: Number(parts.hour ?? 0),
    };
  } catch {
    return { day: 'monday', hour: 9 };
  }
}

function shouldSendNow(prefs) {
  const { day, hour } = nowInTimezone(prefs.timezone ?? 'UTC');
  const wantedDay = (prefs.preferredDay ?? 'monday').toLowerCase();
  const wantedHour = prefs.preferredHour ?? 9;
  return day === wantedDay && hour === wantedHour;
}

function lastMidnight(tz) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz ?? 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function alreadySentToday(prefs) {
  if (!prefs.lastReminderSentAt) return false;
  const sentDate = prefs.lastReminderSentAt.slice(0, 10);
  const today = lastMidnight(prefs.timezone ?? 'UTC');
  return sentDate >= today;
}

async function getPendingImportCount(tx, householdId) {
  try {
    const result = await tx.countUnreviewedImportedRows({ householdId });
    return typeof result === 'number' ? result : 0;
  } catch {
    return 0;
  }
}

async function getLatestMonthlyReview(tx, householdId) {
  try {
    const now = new Date();
    const to = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const from = `${now.getUTCFullYear() - 1}-01-01`;
    const { items } = await tx.listMonthlyReviews({ householdId, from, to });
    return items?.length ? items[items.length - 1] : null;
  } catch {
    return null;
  }
}

function getReviewMonthForPrompt(household) {
  const activeMonth = household?.activeMonth;
  if (!activeMonth) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  return activeMonth;
}

export async function sendHouseholdReminders({ db, household, prefs, config }) {
  const { resendApiKey, fromEmail, appUrl } = config;
  const contactEmail = prefs.contactEmail;
  if (!contactEmail) {
    console.info('[RAF reminders] no contact email configured; skipping reminder send');
    return;
  }

  await db.transaction(async (tx) => {
    const sends = [];

    if (prefs.optedInPendingImports !== false) {
      const pending = await getPendingImportCount(tx, household.id);
      if (pending > 0) {
        const { subject, html } = renderPendingImportsEmail({
          householdName: household.name,
          pendingCount: pending,
          appUrl,
        });
        sends.push({ type: 'pending_imports', subject, html });
      }
    }

    const latestReview = prefs.optedInWeeklySummary !== false || prefs.optedInBudgetAlerts !== false
      ? await getLatestMonthlyReview(tx, household.id)
      : null;

    if (prefs.optedInWeeklySummary !== false) {
      const reviewMonth = getReviewMonthForPrompt(household);
      const reviewMonthStart = reviewMonth.slice(0, 7);
      const alreadyReviewed = latestReview && latestReview.reviewMonth?.startsWith(reviewMonthStart);
      if (!alreadyReviewed) {
        const { subject, html } = renderMonthlyReviewPromptEmail({
          householdName: household.name,
          reviewMonth,
          appUrl,
        });
        sends.push({ type: 'monthly_review_prompt', subject, html });
      }
    }

    if (prefs.optedInBudgetAlerts !== false && latestReview) {
      const { subject, html } = renderBudgetStatusEmail({
        householdName: household.name,
        alertStatus: latestReview.alertStatus ?? 'ok',
        netSurplus: latestReview.netSurplus,
        distributions: latestReview.distributions,
        reviewMonth: latestReview.reviewMonth,
        appUrl,
      });
      sends.push({ type: 'budget_status', subject, html });
    }

    for (const send of sends) {
      try {
        const result = await sendEmail({
          apiKey: resendApiKey,
          from: fromEmail,
          to: contactEmail,
          subject: send.subject,
          html: send.html,
        });
        await tx.logEmailSend({
          householdId: household.id,
          reminderType: send.type,
          resendMessageId: result.id,
          status: result.skipped ? 'skipped' : 'sent',
        });
        console.info('[RAF reminders] sent reminder', { type: send.type, skipped: result.skipped === true });
      } catch (err) {
        console.error('[RAF reminders] failed to send reminder', { type: send.type, message: err.message });
        await tx.logEmailSend({
          householdId: household.id,
          reminderType: send.type,
          status: 'error',
          errorMessage: err.message,
        });
      }
    }
  });
}

export async function runWeeklyReminders({ db, config }) {
  let allPrefs;
  try {
    allPrefs = await db.transaction((tx) => tx.listAllEmailPreferences());
  } catch {
    console.info('[RAF reminders] no email preferences found, nothing to send');
    return;
  }

  for (const prefs of allPrefs) {
    if (!prefs.remindersEnabled) continue;
    if (!shouldSendNow(prefs)) continue;
    if (alreadySentToday(prefs)) continue;

    const household = await db.transaction((tx) => tx.getHousehold({ householdId: prefs.householdId }));
    if (!household) continue;

    await sendHouseholdReminders({ db, household, prefs, config });
  }
}
