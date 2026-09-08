import { wrapInBase, escHtml } from './base.js';

export function renderPendingImportsEmail({ householdName, pendingCount, appUrl }) {
  const body = `
<div class="section">
  <div class="section-title">Action Required</div>
  <div class="card">
    <p style="margin:0 0 8px;font-size:16px;font-weight:600;">
      You have ${escHtml(String(pendingCount))} transaction${pendingCount !== 1 ? 's' : ''} waiting for review
    </p>
    <p style="margin:0;font-size:14px;color:#555;">
      Classifying these helps RAF accurately track your spending across allocation buckets.
    </p>
    <a class="btn" href="${escHtml(appUrl + '/imports')}">Review Transactions</a>
  </div>
</div>
<div class="section">
  <p style="font-size:14px;color:#666;margin:0;">
    Once reviewed, each transaction will be matched to your allocation categories
    — keeping your monthly summary accurate and up to date.
  </p>
</div>`;

  return {
    subject: `RAF: ${pendingCount} transaction${pendingCount !== 1 ? 's' : ''} waiting for review`,
    html: wrapInBase({ title: 'Pending Transactions — RAF', body, appUrl }),
  };
}
