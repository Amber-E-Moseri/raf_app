import { wrapInBase, escHtml } from './base.js';

export function renderMonthlyReviewPromptEmail({ householdName, reviewMonth, appUrl }) {
  const [year, month] = reviewMonth.split('-');
  const monthName = new Date(`${year}-${month}-01T00:00:00Z`)
    .toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const displayMonth = `${monthName} ${year}`;

  const body = `
<div class="section">
  <div class="section-title">Monthly Review</div>
  <div class="card">
    <p style="margin:0 0 8px;font-size:16px;font-weight:600;">
      Ready to close out ${escHtml(displayMonth)}?
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#555;">
      Create your monthly review to capture net surplus, see your allocation distributions,
      and get your financial health status for the month.
    </p>
    <a class="btn" href="${escHtml(appUrl + '/monthly-reviews')}">Create Monthly Review</a>
  </div>
</div>
<div class="section">
  <p style="font-size:13px;color:#888;margin:0;">
    Monthly reviews snapshot your income, spending, and debt payments so you can
    track progress over time and spot trends early.
  </p>
</div>`;

  return {
    subject: `RAF: Time to review ${displayMonth}`,
    html: wrapInBase({ title: `Monthly Review — ${displayMonth}`, body, appUrl }),
  };
}
