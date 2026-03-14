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
    <Card className="min-h-[96px] overflow-hidden">
      <div className="flex h-full flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-medium text-[var(--text-muted)]">{title}</p>
          {badge ? <Badge tone={tone}>{badge}</Badge> : null}
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[24px] font-bold leading-none text-[var(--text-strong)]">{value}</p>
            <p className="mt-2 text-[10px] font-medium text-[var(--text-muted)]">{subtitle}</p>
          </div>
          {icon ? <div className="text-[var(--text-muted)]/40">{icon}</div> : null}
        </div>
      </div>
    </Card>
  );
}
