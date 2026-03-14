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
      title="Allocation buckets"
      actions={<button type="button" className="text-[11px] font-medium text-stone-500">Edit -&gt;</button>}
    >
      {validItems.length ? (
        <div className="space-y-2">
          {validItems.map((item, index) => {
            const allocationPercent = item.allocationPercent ? formatPercentWithDigits(item.allocationPercent, 2) : null;
            const percentUsed = item.percentUsedThisMonth ?? 0;
            const usageWidth = Math.max(0, Math.min(100, percentUsed));
            const amountLabel = item.remainingThisMonth ?? item.allocatedThisMonth ?? item.goalReservedAmount ?? "0.00";

            return (
              <div
                key={item.bucketId}
                className="rounded-2xl border px-3 py-2.5"
                style={{
                  borderColor: "var(--border-color)",
                  background: "var(--surface-plain)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md ${barColor(index)}`} />
                  <div className="w-[90px] min-w-0 text-[13px] font-medium text-[var(--text-strong)]">{item.label}</div>
                  <div className="flex-1">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                      <div
                        className={`h-full rounded-full ${barColor(index)} transition-all duration-500`}
                        style={{ width: `${usageWidth}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-7 text-right text-[11px] font-medium text-[var(--text-muted)]">
                    {allocationPercent ? allocationPercent.replace(".00", "") : "--"}
                  </div>
                  <div className="w-12 text-right text-[11px] font-semibold text-[var(--text-strong)]">
                    {formatCurrency(amountLabel)}
                  </div>
                </div>
                {item.goalName ? (
                  <div className="mt-2 flex items-center justify-between gap-3 pl-8 text-[10px] text-[var(--text-muted)]">
                    <span className="truncate">{item.goalName}</span>
                    <span>
                      {item.goalReservedAmount && item.goalTargetAmount
                        ? `${formatCurrency(item.goalReservedAmount)} / ${formatCurrency(item.goalTargetAmount)}`
                        : "Goal target unavailable"}
                    </span>
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
