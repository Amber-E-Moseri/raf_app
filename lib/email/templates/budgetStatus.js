import { wrapInBase, escHtml } from './base.js';

function alertBadge(status) {
  const map = {
    ok: ['badge-ok', 'On Track'],
    elevated: ['badge-elevated', 'Needs Attention'],
    risky: ['badge-risky', 'At Risk'],
  };
  const [cls, label] = map[status] ?? map.ok;
  return `<span class="badge ${cls}">${label}</span>`;
}

export function renderBudgetStatusEmail({ householdName, alertStatus, netSurplus, distributions, reviewMonth, appUrl }) {
  const [year, month] = reviewMonth.split('-');
  const displayMonth = new Date(`${year}-${month}-01T00:00:00Z`)
    .toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const surplus = Number(netSurplus ?? 0);
  const surplusDisplay = surplus >= 0
    ? `+$${surplus.toFixed(2)}`
    : `-$${Math.abs(surplus).toFixed(2)}`;

  const distributionRows = Array.isArray(distributions)
    ? distributions.map((d) => `
        <div class="stat">
          <span class="stat-label">${escHtml(d.label ?? d.slug)}</span>
          <span class="stat-value">$${Number(d.amount ?? 0).toFixed(2)}</span>
        </div>`).join('')
    : '';

  const body = `
<div class="section">
  <div class="section-title">Budget Status — ${escHtml(displayMonth)}</div>
  <div class="card">
    <div class="stat">
      <span class="stat-label">Financial Health</span>
      <span class="stat-value">${alertBadge(alertStatus)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Net Surplus</span>
      <span class="stat-value" style="color:${surplus >= 0 ? '#2e7d32' : '#c62828'}">${escHtml(surplusDisplay)}</span>
    </div>
  </div>
</div>
${distributionRows ? `
<div class="section">
  <div class="section-title">Surplus Distributions</div>
  <div class="card">${distributionRows}</div>
</div>` : ''}
<div class="section">
  <a class="btn" href="${escHtml(appUrl + '/monthly-reviews')}">View Full Review</a>
</div>`;

  return {
    subject: `RAF: Your ${displayMonth} budget summary`,
    html: wrapInBase({ title: `Budget Summary — ${displayMonth}`, body, appUrl }),
  };
}
