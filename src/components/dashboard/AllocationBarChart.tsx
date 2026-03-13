import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { formatPercentWithDigits } from "../../lib/format";

export interface AllocationBarDatum {
  slug: string;
  label: string;
  percent: string | null;
}

interface AllocationBarChartProps {
  items: AllocationBarDatum[];
}

function barColor(index: number) {
  const colors = [
    "bg-emerald-500",
    "bg-lime-500",
    "bg-amber-500",
    "bg-sky-500",
    "bg-teal-500",
    "bg-stone-500",
  ];

  return colors[index % colors.length];
}

export function AllocationBarChart({ items }: AllocationBarChartProps) {
  const validItems = items.filter((item) => item.percent != null);

  return (
    <Card
      title="Allocation Visualization"
      subtitle="Configured percentages shown as horizontal bars when the category API is available."
    >
      {validItems.length ? (
        <div className="space-y-4">
          {validItems.map((item, index) => {
            const rawPercent = Number(item.percent);
            const percent = Number.isFinite(rawPercent) ? rawPercent * 100 : 0;

            return (
              <div key={item.slug}>
                <div className="mb-2 flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-raf-ink">{item.label}</span>
                  <span className="text-sm text-stone-500">{formatPercentWithDigits(item.percent, 2)}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className={`h-full rounded-full ${barColor(index)} transition-all duration-500`}
                    style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Allocation percentages unavailable"
          message="The live backend does not currently expose allocation categories, so the chart cannot render configured percentages."
        />
      )}
    </Card>
  );
}
