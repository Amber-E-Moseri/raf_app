import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { formatPercentWithDigits } from "../../lib/format";
import { Money } from "../ui/Money";
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

function ScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative grid h-[124px] w-[124px] place-items-center">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--surface-muted)" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--theme-primary)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 240ms ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="financial-value text-[32px] font-bold leading-none text-[var(--text-primary)]">{clamped}</div>
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">Health</div>
      </div>
    </div>
  );
}

export function FinancialHealthIndicator({
  report,
  title = "Financial Health Score",
  subtitle = "Monthly score with the six pillars affecting household resilience.",
}: FinancialHealthIndicatorProps) {
  const monthLabel = report.reviewMonth ? formatMonthLabel(report.reviewMonth.slice(0, 7)) : null;

  return (
    <Card title={title} subtitle={subtitle}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <ScoreGauge score={report.healthScore} />
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {monthLabel ? `${monthLabel} score` : "Current score"}
                </p>
                <p className="text-[13px] leading-6 text-[var(--text-secondary)]">
                  Debt ratio {formatPercentWithDigits(report.debtRatio, 1)} | Savings coverage{" "}
                  {report.emergencyCoverageMonths == null ? "N/A" : `${report.emergencyCoverageMonths.toFixed(1)} mo`}
                </p>
              </div>
            </div>
            <Badge tone={alertTone(report.alertStatus)}>{report.alertStatus}</Badge>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {report.healthPillars.map((pillar) => (
            <div key={pillar.key} className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{pillar.label}</p>
                  <p className="financial-value mt-1 text-[24px] font-semibold leading-none text-[var(--text-primary)]">{pillar.score}</p>
                </div>
                <Badge tone={pillarTone(pillar.score)}>{pillar.score}</Badge>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                <div
                  className="h-full rounded-full bg-[var(--theme-primary)]"
                  style={{ width: `${Math.max(0, Math.min(pillar.score, 100))}%` }}
                />
              </div>
              <p className="text-[12px] leading-5 text-[var(--text-secondary)]">{pillar.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Income</p>
            <p className="financial-value mt-1 text-sm font-semibold text-[var(--text-primary)]">{<Money value={report.activeMonthIncome} />}</p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Debt payments</p>
            <p className="financial-value mt-1 text-sm font-semibold text-[var(--text-primary)]">{<Money value={report.monthlyDebtPayments} />}</p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Savings balance</p>
            <p className="financial-value mt-1 text-sm font-semibold text-[var(--text-primary)]">{<Money value={report.savingsBalance} />}</p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Available savings</p>
            <p className="financial-value mt-1 text-sm font-semibold text-[var(--text-primary)]">{<Money value={report.availableSavings} />}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}


