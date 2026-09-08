import cron from 'node-cron';
import { runWeeklyReminders } from '../email/weeklyReminders.js';

let _scheduledTask = null;
let _tokenCleanupTask = null;

export function startScheduler({ db, config = {} }) {
  if (db?.transaction) {
    _tokenCleanupTask = cron.schedule('17 * * * *', async () => {
      try {
        await db.transaction(async (tx) => {
          if (typeof tx.cleanupExpiredBlacklistedTokens === 'function') {
            await tx.cleanupExpiredBlacklistedTokens();
          }
        });
      } catch (err) {
        console.error('[RAF scheduler] token cleanup error:', err.message);
      }
    });
    console.info('[RAF scheduler] started — token blacklist cleanup will run hourly');
  }

  if (!config.resendApiKey) {
    console.info('[RAF scheduler] RESEND_API_KEY not set — weekly reminders disabled');
    return;
  }

  // Run at the top of every hour; the reminder logic checks if it matches the household's preferred day/hour
  _scheduledTask = cron.schedule('0 * * * *', async () => {
    console.info('[RAF scheduler] running weekly reminder check');
    try {
      await runWeeklyReminders({ db, config });
    } catch (err) {
      console.error('[RAF scheduler] weekly reminders error:', err.message);
    }
  });

  console.info('[RAF scheduler] started — weekly reminders will run hourly');
}

export function stopScheduler() {
  _scheduledTask?.stop();
  _tokenCleanupTask?.stop();
  _scheduledTask = null;
  _tokenCleanupTask = null;
}
