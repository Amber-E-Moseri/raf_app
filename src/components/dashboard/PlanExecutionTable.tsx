/**
 * PlanExecutionTable
 *
 * Shows how this month's income allocations translated to real spending.
 * Complements AllocationBarChart (visual) with a numerical comparison + status.
 *
 * Label semantics (audit SC-1 binding):
 *   - "Allocated" = income that flowed to the bucket via allocation percentages
 *   - "Used"      = debit transactions charged to the bucket
 *   - "Remaining" = Allocated + Credits − Used
 *   NOT "Planned", NOT "Budget", NOT "Target"
 *
 * Statuses emitted in Phase B:
 *   WITHIN_ALLOCATION  → "Within allocation" (green)
 *   ABOVE_ALLOCATION   → "Above allocation"  (red)
 *   NO_ALLOCATION_USED → "Not allocated"     (neutral)
 *
 * Constraint: reuses AllocationBarDatum from AllocationBarChart — no new API,
 * no new DB table, no new Plan Engine behavior.
 */

import { Link } from "react-router-dom";
import type { AllocationBarDatum } from "./AllocationBarChart";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlanExecutionStatus =
  | "WITHIN_ALLOCATION"
  | "ABOVE_ALLOCATION"
  | "NO_ALLOCATION_USED";

interface PlanExecutionRow {
  bucketId: string;
  slug: string | null | undefined;
  label: string;
  allocatedCents: number;
  addedCents: number;
  usedCents: number;
  remainingCents: number;
  status: PlanExecutionStatus;
}

interface PlanExecutionTableProps {
  items: AllocationBarDatum[];
  activeMonthLabel: string;
}

// ---------------------------------------------------------------------------
// Pure derivation helpers (mirrors lib/planExecution/derivePlanExecutionRows.js)
// ---------------------------------------------------------------------------

function parseMoneyToCents(value: string | number | null | undefined): number {
  const numeric = typeof value === "number" ? value : Number(value ?? "0");
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100);
}

function derivePlanExecutionRow(
  item: AllocationBarDatum
): PlanExecutionRow | null {
  const allocatedCents = parseMoneyToCents(item.thisMonth.allocated);
  const addedCents = parseMoneyToCents(item.thisMonth.added);
  const usedCents = parseMoneyToCents(item.thisMonth.used);
  const remainingCents = allocatedCents + addedCents - usedCents;

  const hasActivity =
    allocatedCents !== 0 || usedCents !== 0 || addedCents !== 0;
  if (!hasActivity) return null;

  if (allocatedCents === 0 && addedCents === 0 && usedCents > 0) {
    return {
      bucketId: item.bucketId,
      slug: item.slug,
      label: item.label,
      allocatedCents,
      addedCents,
      usedCents,
      remainingCents,
      status: "NO_ALLOCATION_USED",
    };
  }

  const status: PlanExecutionStatus =
    remainingCents < 0 ? "ABOVE_ALLOCATION" : "WITHIN_ALLOCATION";

  return {
    bucketId: item.bucketId,
    slug: item.slug,
    label: item.label,
    allocatedCents,
    addedCents,
    usedCents,
    remainingCents,
    status,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = abs / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: PlanExecutionStatus }) {
  if (status === "ABOVE_ALLOCATION") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Above allocation
      </span>
    );
  }

  if (status === "NO_ALLOCATION_USED") {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
        Not allocated
      </span>
    );
  }

  // WITHIN_ALLOCATION
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      Within allocation
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PlanExecutionTable({
  items,
  activeMonthLabel,
}: PlanExecutionTableProps) {
  const rows: PlanExecutionRow[] = items
    .map((item) => derivePlanExecutionRow(item))
    .filter((r): r is PlanExecutionRow => r !== null);

  // Footer totals
  const totalAllocatedCents = rows.reduce((s, r) => s + r.allocatedCents, 0);
  const totalUsedCents = rows.reduce((s, r) => s + r.usedCents, 0);
  const aboveCount = rows.filter(
    (r) => r.status === "ABOVE_ALLOCATION"
  ).length;

  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
        No allocation activity for {activeMonthLabel}.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      {/* Desktop table */}
      <table className="hidden w-full min-w-[560px] text-sm md:table">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-left text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
            <th className="px-4 py-3 font-semibold">Bucket</th>
            <th className="px-3 py-3 text-right font-semibold">Allocated</th>
            <th className="px-3 py-3 text-right font-semibold">Used</th>
            <th className="px-3 py-3 text-right font-semibold">Remaining</th>
            <th className="px-3 py-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const txLink = row.slug
              ? `/transactions?categorySlug=${encodeURIComponent(row.slug)}`
              : `/transactions?categoryId=${encodeURIComponent(row.bucketId)}`;

            const isAbove = row.status === "ABOVE_ALLOCATION";
            const isNoAlloc = row.status === "NO_ALLOCATION_USED";

            return (
              <tr
                key={row.bucketId}
                className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-hover)]"
              >
                <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                  <Link
                    to={txLink}
                    className="hover:text-[var(--accent)] hover:underline"
                  >
                    {row.label}
                  </Link>
                </td>

                {isNoAlloc ? (
                  /* Span columns 2–4 for the "no allocation" message */
                  <td
                    colSpan={3}
                    className="px-3 py-2.5 text-right text-[var(--text-secondary)]"
                  >
                    No income allocated · Used{" "}
                    <span className="font-semibold text-[var(--text-primary)]">
                      {formatDollars(row.usedCents)}
                    </span>
                  </td>
                ) : (
                  <>
                    {/* Allocated — show credit sub-line when returned > 0 */}
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                      <div>{formatDollars(row.allocatedCents)}</div>
                      {row.addedCents > 0 && (
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          +{formatDollars(row.addedCents)} returned
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                      {formatDollars(row.usedCents)}
                    </td>
                    {/* Remaining = allocated + returned − used; credits already included */}
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        isAbove ? "text-red-600 dark:text-red-400" : "text-[var(--text-primary)]"
                      }`}
                    >
                      {isAbove ? "−" : ""}
                      {formatDollars(Math.abs(row.remainingCents))}
                    </td>
                  </>
                )}

                <td className="px-3 py-2.5">
                  <StatusChip status={row.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]">
            <td className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide">
              Total
            </td>
            <td className="px-3 py-2.5 text-right text-[12px] tabular-nums font-semibold text-[var(--text-primary)]">
              {formatDollars(totalAllocatedCents)}
            </td>
            <td className="px-3 py-2.5 text-right text-[12px] tabular-nums font-semibold text-[var(--text-primary)]">
              {formatDollars(totalUsedCents)}
            </td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-[11px]">
              {aboveCount > 0 ? (
                <span className="text-red-600 dark:text-red-400">
                  {aboveCount} bucket{aboveCount !== 1 ? "s" : ""} above
                  allocation
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">
                  All within allocation
                </span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Mobile card list */}
      <ul className="divide-y divide-[var(--border-subtle)] md:hidden">
        {rows.map((row) => {
          const txLink = row.slug
            ? `/transactions?categorySlug=${encodeURIComponent(row.slug)}`
            : `/transactions?categoryId=${encodeURIComponent(row.bucketId)}`;

          const isAbove = row.status === "ABOVE_ALLOCATION";
          const isNoAlloc = row.status === "NO_ALLOCATION_USED";

          return (
            <li key={row.bucketId} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={txLink}
                  className="truncate font-medium text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline"
                >
                  {row.label}
                </Link>
                <StatusChip status={row.status} />
              </div>

              {isNoAlloc ? (
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  No income allocated · Used{" "}
                  <span className="font-semibold">{formatDollars(row.usedCents)}</span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Allocated{" "}
                  <span className="tabular-nums text-[var(--text-primary)]">
                    {formatDollars(row.allocatedCents)}
                  </span>
                  {row.addedCents > 0 && (
                    <>
                      {" · "}
                      <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                        +{formatDollars(row.addedCents)} returned
                      </span>
                    </>
                  )}
                  {" · "}Used{" "}
                  <span className="tabular-nums text-[var(--text-primary)]">
                    {formatDollars(row.usedCents)}
                  </span>
                  {" · "}
                  <span
                    className={`tabular-nums font-semibold ${
                      isAbove
                        ? "text-red-600 dark:text-red-400"
                        : "text-[var(--text-primary)]"
                    }`}
                  >
                    {isAbove ? "−" : ""}
                    {formatDollars(Math.abs(row.remainingCents))}
                  </span>
                  {" "}remaining
                </p>
              )}
            </li>
          );
        })}

        {/* Mobile footer */}
        <li className="bg-[var(--bg-subtle)] px-4 py-2.5">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>
              Alloc{" "}
              <span className="font-semibold text-[var(--text-primary)]">
                {formatDollars(totalAllocatedCents)}
              </span>
              {" · "}Used{" "}
              <span className="font-semibold text-[var(--text-primary)]">
                {formatDollars(totalUsedCents)}
              </span>
            </span>
            {aboveCount > 0 ? (
              <span className="font-semibold text-red-600 dark:text-red-400">
                {aboveCount} above
              </span>
            ) : (
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                All within
              </span>
            )}
          </div>
        </li>
      </ul>
    </div>
  );
}
