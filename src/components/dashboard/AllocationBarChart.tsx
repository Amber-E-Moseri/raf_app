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
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
    "var(--chart-6)",
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
    <Card title="Categories">
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
              const uncappedProgress = barBase === 0 ? 0 : Math.max(0, ((reserved + spent) / barBase) * 100);
              const progress = Math.min(uncappedProgress, 100);

              return (
                <Link
                  key={item.bucketId}
                  to={item.slug
                    ? `/transactions?categorySlug=${encodeURIComponent(item.slug)}&focusLabel=${encodeURIComponent(item.label)}#transactions-table`
                    : `/transactions?categoryId=${encodeURIComponent(item.bucketId)}&focusLabel=${encodeURIComponent(item.label)}#transactions-table`}
                  className="group block rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-4 py-3.5 transition duration-150 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] sm:py-4"
                >
                  {/* Mobile layout */}
                  <div className="space-y-2 sm:hidden">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: barColor(index) }} />
                      <div className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--text-primary)]">{item.label}</div>
                      <div className="financial-value text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
                        {formatCurrency(currentMonthAmount.toFixed(2))}
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        aria-label={uncappedProgress > 100 ? "over budget" : "budget usage"}
                        style={{
                          width: `${progress}%`,
                          background: uncappedProgress > 100 ? "var(--status-danger)" : barColor(index),
                        }}
                      />
                    </div>
                  </div>

                  {/* Desktop layout */}
                  <div className="hidden space-y-3 sm:block">
                    <div className="flex items-center gap-4">
                      <div className="flex min-w-[152px] items-center gap-3">
                        <div className="h-[14px] w-[14px] shrink-0 rounded-full" style={{ background: barColor(index) }} />
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{item.label}</div>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-1 items-center gap-4">
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            aria-label={uncappedProgress > 100 ? "over budget" : "budget usage"}
                            style={{
                              width: `${progress}%`,
                              background: uncappedProgress > 100 ? "var(--status-danger)" : barColor(index),
                            }}
                          />
                        </div>

                        <div className="flex min-w-[116px] items-baseline justify-end gap-3 text-right">
                          <div className="text-[11px] font-medium text-[var(--text-secondary)]">
                            {allocationPercent ?? "--"}
                          </div>
                          <div className="financial-value text-[18px] font-semibold tracking-tight text-[var(--text-primary)]">
                            {formatCurrency(currentMonthAmount.toFixed(2))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pl-[24px] text-[11px] text-[var(--text-secondary)]">
                      <span>Spent {formatCurrency(spent.toFixed(2))}</span>
                      <span>{" | "}</span>
                      <span>Goals {formatCurrency(reserved.toFixed(2))}</span>
                      <span>{" | "}</span>
                      <span>Available {formatCurrency(available.toFixed(2))}</span>
                      {spent + reserved > currentMonthAmount && currentMonthAmount > 0 ? (
                        <>
                          <span>{" | "}</span>
                          <span className="font-semibold text-[var(--status-danger)]">Over budget</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-4 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            <span>{activeMonthLabel} | {validItems.length} categories</span>
            <span>{formatCurrency(totalAllocated.toFixed(2))} allocated</span>
          </div>
        </div>
      ) : (
        <EmptyState
          title="No category usage data yet"
          message="Once the current month has allocations, this view will show the current category distribution."
        />
      )}
    </Card>
  );
}
