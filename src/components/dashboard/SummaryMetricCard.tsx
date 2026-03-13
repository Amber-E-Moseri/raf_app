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
    <Card className="overflow-hidden border-stone-200/80 bg-white/90">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">{title}</p>
          <p className="mt-3 text-3xl font-semibold text-raf-ink">{value}</p>
          <p className="mt-2 text-sm text-stone-500">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          {badge ? <Badge tone={tone}>{badge}</Badge> : null}
          {icon ? <div className="text-stone-300">{icon}</div> : null}
        </div>
      </div>
    </Card>
  );
}
