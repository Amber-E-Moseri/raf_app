import { Link } from "react-router-dom";

import { formatCurrency, formatPercentWithDigits } from "../../lib/format";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";

export interface BucketScopeMetrics {
  allocated: string | null;
  added: string | null;
  reservedForGoals: string | null;
  used: string | null;
  available: string | null;
  remaining: string | null;
}

export interface AllocationBarDatum {
  bucketId: string;
  slug?: string | null;
  label: string;
  allocationPercent: string | null;
  thisMonth: BucketScopeMetrics;
}

interface AllocationBarChartProps {
  items: AllocationBarDatum[];
  activeMonthLabel: string;
}

function barColor(index: number) {
  const colors = [
    "bg-emerald-500",
    "bg-blue-500",
    "bg-amber-600",
    "bg-violet-500",
    "bg-pink-500",
    "bg-stone-500",
  ];

  return colors[index % colors.length];
}

function parseMoney(value: string | null | undefined) {
  const numeric = Number(value ?? "0");
  return Number.isFinite(numeric) ? numeric : 0;
}

export function AllocationBarChart({ items, activeMonthLabel }: AllocationBarChartProps) {
  const validItems = items.filter((item) => item.allocationPercent != null || item.thisMonth.allocated != null || item.thisMonth.available != null);
  const totalAllocated = validItems.reduce((sum, item) => {
    const allocated = parseMoney(item.thisMonth.allocated);
    const added = parseMoney(item.thisMonth.added);
    return sum + allocated + added;
  }, 0);

  return (
    <Card title="Allocation buckets">
      {validItems.length ? (
        <div>
          <div className="space-y-3">
            {validItems.map((item, index) => {
              const allocationPercent = item.allocationPercent ? formatPercentWithDigits(item.allocationPercent, 2).replace(".00", "") : null;
              const allocated = parseMoney(item.thisMonth.allocated);
              const added = parseMoney(item.thisMonth.added);
              const currentMonthAmount = allocated + added;
              const reserved = parseMoney(item.thisMonth.reservedForGoals);
              const spent = parseMoney(item.thisMonth.used);
              const available = Math.max(parseMoney(item.thisMonth.available), 0);
              const barBase = currentMonthAmount > 0 ? currentMonthAmount : reserved + spent;
              const progress = barBase === 0 ? 0 : Math.max(0, Math.min(100, ((reserved + spent) / barBase) * 100));

              return (
                <Link
                  key={item.bucketId}
                  to={item.slug
                    ? `/transactions?categorySlug=${encodeURIComponent(item.slug)}&focusLabel=${encodeURIComponent(item.label)}#transactions-table`
                    : `/transactions?categoryId=${encodeURIComponent(item.bucketId)}&focusLabel=${encodeURIComponent(item.label)}#transactions-table`}
                  className="group block rounded-[1.35rem] border px-4 py-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0"
                  style={{
                    borderColor: "var(--border-color)",
                    background: "var(--surface-plain)",
                  }}
                >
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="flex min-w-[152px] items-center gap-3">
                        <div className={`h-[18px] w-[18px] shrink-0 rounded-md ${barColor(index)}`} />
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold text-[var(--text-strong)]">{item.label}</div>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-1 items-center gap-4">
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-elevated)]">
                          <div
                            className={`h-full rounded-full ${barColor(index)} transition-all duration-300`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>

                        <div className="flex min-w-[116px] items-baseline justify-end gap-3 text-right">
                          <div className="text-[11px] font-medium text-[var(--text-muted)]">
                            {allocationPercent ?? "--"}
                          </div>
                          <div className="text-[18px] font-semibold tracking-tight text-[var(--text-strong)]">
                            {formatCurrency(currentMonthAmount.toFixed(2))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pl-[30px] text-[11px] text-[var(--text-muted)]">
                      <span>Spent {formatCurrency(spent.toFixed(2))}</span>
                      <span>{" | "}</span>
                      <span>Goals {formatCurrency(reserved.toFixed(2))}</span>
                      <span>{" | "}</span>
                      <span>Available {formatCurrency(available.toFixed(2))}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[var(--border-color)] pt-4 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span>{activeMonthLabel} | {validItems.length} buckets</span>
            <span>{formatCurrency(totalAllocated.toFixed(2))} allocated</span>
          </div>
        </div>
      ) : (
        <EmptyState
          title="No bucket usage data yet"
          message="Once the current month has allocations, this view will show the current bucket distribution."
        />
      )}
    </Card>
  );
}
