import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { formatCurrency, formatPercentWithDigits } from "../../lib/format";
import type { FinancialHealthReport } from "../../lib/types";

interface FinancialHealthIndicatorProps {
  report: FinancialHealthReport;
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

export function FinancialHealthIndicator({ report }: FinancialHealthIndicatorProps) {
  return (
    <Card title="Financial Health" subtitle="Directly from the backend financial health report.">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-3xl bg-stone-50 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Alert Status</p>
            <p className="mt-2 text-lg font-semibold text-raf-ink">Household operating posture</p>
          </div>
          <Badge tone={alertTone(report.alertStatus)}>{report.alertStatus}</Badge>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Savings Balance</p>
            <p className="mt-2 text-xl font-semibold text-raf-ink">{formatCurrency(report.savingsBalance)}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Emergency Fund</p>
            <p className="mt-2 text-xl font-semibold text-raf-ink">{formatCurrency(report.emergencyFundBalance)}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Debt Ratio</p>
            <p className="mt-2 text-xl font-semibold text-raf-ink">{formatPercentWithDigits(report.debtRatio, 1)}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Emergency Coverage</p>
            <p className="mt-2 text-xl font-semibold text-raf-ink">
              {report.emergencyCoverageMonths == null ? "N/A" : `${report.emergencyCoverageMonths.toFixed(1)} months`}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
