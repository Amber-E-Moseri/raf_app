import type { ReactNode } from "react";

import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";

interface SummaryMetricCardProps {
  title: string;
  value: string;
  subtitle: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  badge?: string;
  icon?: ReactNode;
}

export function SummaryMetricCard({
  title,
  value,
  subtitle,
  tone = "neutral",
  badge,
  icon,
}: SummaryMetricCardProps) {
  return (
    <Card className="summary-metric-card min-h-[120px] overflow-hidden">
      <div className="flex h-full flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">{title}</p>
          {badge ? <Badge tone={tone}>{badge}</Badge> : null}
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="financial-value text-[30px] font-bold leading-none tracking-[-0.02em] text-[var(--text-primary)]">{value}</p>
            <p className="mt-2 text-[12px] font-medium text-[var(--text-secondary)]">{subtitle}</p>
          </div>
          {icon ? <div className="text-[var(--text-subtle)]">{icon}</div> : null}
        </div>
      </div>
    </Card>
  );
}
