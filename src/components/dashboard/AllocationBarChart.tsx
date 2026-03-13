import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { formatCurrency, formatPercentWithDigits } from "../../lib/format";

export interface AllocationBarDatum {
  bucketId: string;
  label: string;
  allocationPercent: string | null;
  allocatedThisMonth: string | null;
  usedThisMonth: string | null;
  remainingThisMonth: string | null;
  percentUsedThisMonth: number | null;
  goalName?: string | null;
  goalTargetAmount?: string | null;
  goalReservedAmount?: string | null;
  goalProgressPercent?: number | null;
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
  const validItems = items.filter((item) => item.allocationPercent != null || item.remainingThisMonth != null);

  return (
    <Card
      title="Allocation Visualization"
      subtitle="Monthly bucket usage with what is left to spend, plus goal progress when a target exists."
    >
      {validItems.length ? (
        <div className="space-y-4">
          {validItems.map((item, index) => {
            const allocationPercent = item.allocationPercent ? formatPercentWithDigits(item.allocationPercent, 2) : null;
            const percentUsed = item.percentUsedThisMonth ?? 0;
            const usageWidth = Math.max(0, Math.min(100, percentUsed));
            const goalWidth = Math.max(0, Math.min(100, item.goalProgressPercent ?? 0));

            return (
              <div key={item.bucketId} className="space-y-3 rounded-2xl border border-stone-200/80 bg-white/80 p-4">
                <div className="mb-2 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-raf-ink">{item.label}</p>
                    <p className="text-xs text-stone-500">
                      {allocationPercent ? `${allocationPercent} allocation` : "Allocation percent unavailable"}
                    </p>
                  </div>
                  <span className="text-sm text-stone-500">
                    {item.remainingThisMonth == null ? "No monthly allocation" : `${formatCurrency(item.remainingThisMonth)} left`}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className={`h-full rounded-full ${barColor(index)} transition-all duration-500`}
                    style={{ width: `${usageWidth}%` }}
                  />
                </div>
                <div className="grid gap-2 text-xs text-stone-500 sm:grid-cols-3">
                  <span>Allocated: {item.allocatedThisMonth == null ? "N/A" : formatCurrency(item.allocatedThisMonth)}</span>
                  <span>Used: {item.usedThisMonth == null ? "N/A" : formatCurrency(item.usedThisMonth)}</span>
                  <span>{item.percentUsedThisMonth == null ? "Usage unavailable" : `${item.percentUsedThisMonth}% used`}</span>
                </div>
                {item.goalName ? (
                  <div className="rounded-xl bg-stone-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-4 text-xs text-stone-500">
                      <span>{item.goalName}</span>
                      <span>
                        {item.goalReservedAmount && item.goalTargetAmount
                          ? `${formatCurrency(item.goalReservedAmount)} of ${formatCurrency(item.goalTargetAmount)}`
                          : "Goal target unavailable"}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-stone-200">
                      <div
                        className="h-full rounded-full bg-raf-ink transition-all duration-500"
                        style={{ width: `${goalWidth}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No bucket usage data yet"
          message="Once the current month has allocations, this view will show how much is left in each bucket."
        />
      )}
    </Card>
  );
}
