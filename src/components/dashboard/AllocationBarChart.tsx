import { Link } from "react-router-dom";

import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { formatCurrency, formatPercentWithDigits } from "../../lib/format";

export interface AllocationBarDatum {
  bucketId: string;
  slug?: string | null;
  label: string;
  allocationPercent: string | null;
  allocatedThisMonth: string | null;
  addedThisMonth: string | null;
  reservedForGoalsThisMonth: string | null;
  availableThisMonth: string | null;
  usedThisMonth: string | null;
  remainingThisMonth: string | null;
  percentUsedThisMonth: number | null;
  percentReservedForGoalsThisMonth?: number | null;
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

function parseMoney(value: string | null | undefined) {
  const numeric = Number(value ?? "0");
  return Number.isFinite(numeric) ? numeric : 0;
}

export function AllocationBarChart({ items }: AllocationBarChartProps) {
  const validItems = items.filter((item) => item.allocationPercent != null || item.availableThisMonth != null || item.remainingThisMonth != null);

  return (
    <Card
      title="Allocation buckets"
      actions={<button type="button" className="text-[11px] font-medium text-stone-500">Edit -&gt;</button>}
    >
      {validItems.length ? (
        <div className="space-y-3">
          {validItems.map((item, index) => {
            const allocationPercent = item.allocationPercent ? formatPercentWithDigits(item.allocationPercent, 2) : null;
            const allocated = parseMoney(item.allocatedThisMonth);
            const added = parseMoney(item.addedThisMonth);
            const reserved = parseMoney(item.reservedForGoalsThisMonth);
            const spent = parseMoney(item.usedThisMonth);
            const available = Math.max(parseMoney(item.availableThisMonth), 0);
            const used = reserved + spent;
            const totalForBar = Math.max(allocated + added, 0);
            const usedWidth = totalForBar === 0 ? 0 : Math.max(0, Math.min(100, (used / totalForBar) * 100));
            const hasAdded = added > 0;
            const allocatedLabel = hasAdded
              ? `${formatCurrency((allocated + added).toFixed(2))} (includes ${formatCurrency(added.toFixed(2))} added)`
              : formatCurrency(allocated.toFixed(2));

            return (
              <Link
                key={item.bucketId}
                to={item.slug
                  ? `/transactions?categorySlug=${encodeURIComponent(item.slug)}&focusLabel=${encodeURIComponent(item.label)}#transactions-table`
                  : `/transactions?categoryId=${encodeURIComponent(item.bucketId)}&focusLabel=${encodeURIComponent(item.label)}#transactions-table`}
                className="group block rounded-[1.4rem] border px-4 py-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0"
                style={{
                  borderColor: "var(--border-color)",
                  background: "var(--surface-plain)",
                }}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md ${barColor(index)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-[15px] font-semibold text-[var(--text-strong)]">{item.label}</div>
                        </div>
                        <div className="mt-1 text-[11px] font-medium text-[var(--text-muted)]">
                          {allocationPercent ? `${allocationPercent.replace(".00", "")} of monthly allocation` : "Monthly bucket"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right">
                          <div className="text-[11px] font-medium text-[var(--text-muted)]">Available</div>
                          <div className="mt-1 text-[18px] font-semibold tracking-tight text-[var(--text-strong)]">
                            {formatCurrency(available.toFixed(2))}
                          </div>
                        </div>
                        <div className="pt-1 text-[16px] text-[var(--text-muted)] transition group-hover:text-[var(--text-strong)]">
                          &gt;
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-medium text-[var(--text-muted)]">
                        <span>Used this month</span>
                        <span>{formatCurrency(used.toFixed(2))}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                        <div
                          className={`h-full rounded-full ${barColor(index)} transition-all duration-500`}
                          style={{ width: `${usedWidth}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-4 text-[11px] text-[var(--text-muted)]">
                      <span>Allocated {allocatedLabel}</span>
                      <span> · </span>
                      <span>Goals {formatCurrency(reserved.toFixed(2))}</span>
                      <span> · </span>
                      <span>Spent {formatCurrency(spent.toFixed(2))}</span>
                    </div>
                  </div>
                </div>
              </Link>
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
