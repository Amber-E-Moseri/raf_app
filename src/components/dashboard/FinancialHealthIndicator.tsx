import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { formatCurrency, formatPercentWithDigits } from "../../lib/format";
import { formatMonthLabel } from "../../lib/period";
import type { FinancialHealthReport } from "../../lib/types";

interface FinancialHealthIndicatorProps {
  report: FinancialHealthReport;
  title?: string;
  subtitle?: string;
}

function alertTone(status: FinancialHealthReport["alertStatus"]) {
  if (status === "risky") {
    return "danger";
  }

  if (status === "elevated") {
    return "warning";
  }

  return "success";
}

function pillarTone(score: number) {
  if (score < 45) {
    return "danger";
  }

  if (score < 70) {
    return "warning";
  }

  return "success";
}

export function FinancialHealthIndicator({
  report,
  title = "Financial Health Score",
  subtitle = "Monthly score with the six pillars affecting household resilience.",
}: FinancialHealthIndicatorProps) {
  const monthLabel = report.reviewMonth ? formatMonthLabel(report.reviewMonth.slice(0, 7)) : null;

  return (
    <Card title={title} subtitle={subtitle}>
      <div className="space-y-4">
        <div
          className="rounded-[1.5rem] border px-4 py-4"
          style={{ borderColor: "var(--border-color)", background: "var(--surface-plain)" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {monthLabel ? `${monthLabel} score` : "Current score"}
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div className="text-[2rem] font-semibold leading-none tracking-tight text-[var(--text-strong)]">
                  {report.healthScore}
                </div>
                <div className="pb-1 text-sm text-[var(--text-muted)]">/ 100</div>
              </div>
              <div className="mt-2 text-[12px] text-[var(--text-muted)]">
                Debt ratio {formatPercentWithDigits(report.debtRatio, 1)} · Savings coverage{" "}
                {report.emergencyCoverageMonths == null ? "N/A" : `${report.emergencyCoverageMonths.toFixed(1)} mo`}
              </div>
            </div>
            <Badge tone={alertTone(report.alertStatus)}>{report.alertStatus}</Badge>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {report.healthPillars.map((pillar) => (
            <div
              key={pillar.key}
              className="rounded-[1.35rem] border px-4 py-3"
              style={{ borderColor: "var(--border-color)", background: "var(--surface-color)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {pillar.label}
                  </div>
                  <div className="mt-2 text-[1.35rem] font-semibold leading-none text-[var(--text-strong)]">
                    {pillar.score}
                  </div>
                </div>
                <Badge tone={pillarTone(pillar.score)} className="px-2.5 py-0.5 text-[10px]">
                  {pillar.score}
                </Badge>
              </div>
              <div className="mt-3 text-[12px] leading-5 text-[var(--text-muted)]">{pillar.value}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[1.2rem] border px-3 py-3" style={{ borderColor: "var(--border-color)", background: "var(--surface-plain)" }}>
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Income</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-strong)]">{formatCurrency(report.activeMonthIncome)}</div>
          </div>
          <div className="rounded-[1.2rem] border px-3 py-3" style={{ borderColor: "var(--border-color)", background: "var(--surface-plain)" }}>
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Debt payments</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-strong)]">{formatCurrency(report.monthlyDebtPayments)}</div>
          </div>
          <div className="rounded-[1.2rem] border px-3 py-3" style={{ borderColor: "var(--border-color)", background: "var(--surface-plain)" }}>
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Savings balance</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-strong)]">{formatCurrency(report.savingsBalance)}</div>
          </div>
          <div className="rounded-[1.2rem] border px-3 py-3" style={{ borderColor: "var(--border-color)", background: "var(--surface-plain)" }}>
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Available savings</div>
            <div className="mt-2 text-sm font-semibold text-[var(--text-strong)]">{formatCurrency(report.availableSavings)}</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
