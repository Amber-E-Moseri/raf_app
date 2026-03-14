import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getAllocationCategoriesAsOf } from "../api/allocationCategoriesApi";
import { ApiError } from "../api/client";
import { getIncome, getIncomeAllocations } from "../api/incomeApi";
import { getDashboardReport, getFinancialHealthReport, getSurplusRecommendations } from "../api/reportsApi";
import { getTransactions } from "../api/transactionsApi";
import { AllocationBarChart } from "../components/dashboard/AllocationBarChart";
import { SummaryMetricCard } from "../components/dashboard/SummaryMetricCard";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { MonthReminderBanner } from "../components/feedback/MonthReminderBanner";
import { PageShell } from "../components/layout/PageShell";
import { usePeriod } from "../components/layout/PeriodProvider";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { MoneyInput } from "../components/ui/MoneyInput";
import { useAsyncData } from "../hooks/useAsyncData";
import { useMonthWorkflow } from "../hooks/useMonthWorkflow";
import { formatCurrency, formatIsoDate } from "../lib/format";
import { normalizeMoneyInput } from "../lib/validation";
import type {
  AllocationCategory,
  DashboardPeriod,
  IncomeAllocationReport,
  SurplusRecommendationsReport,
  Transaction,
} from "../lib/types";

interface DashboardViewModel {
  dashboard: DashboardViewModelReport;
  categories: AllocationCategory[];
  latestAllocationReport: IncomeAllocationReport | null;
  latestPeriod: DashboardPeriod | null;
  financialHealth: DashboardHealthReport;
  surplusRecommendations: SurplusRecommendationsReport;
  recentTransactions: Transaction[];
  incomeCount: number;
}

interface SurplusSuggestionDraftRow {
  id: string;
  destinationSlug: string;
  destinationLabel: string;
  amount: string;
}

type DashboardViewModelReport = Awaited<ReturnType<typeof getDashboardReport>>;
type DashboardHealthReport = Awaited<ReturnType<typeof getFinancialHealthReport>>;

function alertTone(status: "ok" | "elevated" | "risky" | undefined) {
  if (status === "risky") {
    return "danger";
  }

  if (status === "elevated") {
    return "warning";
  }

  if (status === "ok") {
    return "success";
  }

  return "neutral";
}

function transactionTone(transaction: Transaction) {
  return transaction.direction === "credit" ? "success" : "warning";
}

export function Dashboard() {
  const { activeMonthLabel, activeRange, isCurrentMonth, jumpToCurrentMonth } = usePeriod();
  const { from, to } = activeRange;
  const monthWorkflow = useMonthWorkflow(activeRange.from.slice(0, 7));
  const [surplusDraftRows, setSurplusDraftRows] = useState<SurplusSuggestionDraftRow[]>([]);
  const [editingSurplusRowId, setEditingSurplusRowId] = useState<string | null>(null);
  const [surplusRowDraft, setSurplusRowDraft] = useState<{ destinationSlug: string; amount: string }>({ destinationSlug: "", amount: "0.00" });
  const [surplusMessage, setSurplusMessage] = useState<string | null>(null);

  const { data, error, isLoading, reload } = useAsyncData<DashboardViewModel>(async () => {
    const [dashboard, financialHealth, surplusRecommendations, incomeResponse, transactionsResponse] = await Promise.all([
      getDashboardReport({ from, to }),
      getFinancialHealthReport(),
      getSurplusRecommendations(from),
      getIncome({ from, to }),
      getTransactions({ from, to, limit: 10 }),
    ]);

    let categories: AllocationCategory[] = [];

    try {
      categories = await getAllocationCategoriesAsOf(to);
    } catch (loadError) {
      if (!(loadError instanceof ApiError) || loadError.status !== 404) {
        throw loadError;
      }
    }

    const latestIncome = [...incomeResponse.items].sort((left, right) => right.receivedDate.localeCompare(left.receivedDate))[0];
    const latestAllocationReport = latestIncome ? await getIncomeAllocations(latestIncome.incomeId) : null;
    const latestPeriod = [...dashboard.periods].sort((left, right) => right.month.localeCompare(left.month))[0] ?? null;

    return {
      dashboard,
      categories,
      latestAllocationReport,
      latestPeriod,
      financialHealth,
      surplusRecommendations,
      recentTransactions: transactionsResponse.items.slice(0, 5),
      incomeCount: incomeResponse.items.length,
    };
  }, [from, to]);

  useEffect(() => {
    if (!data?.surplusRecommendations) {
      return;
    }

    setSurplusDraftRows(
      data.surplusRecommendations.distributions
        .filter((distribution) => Number(distribution.amount) > 0)
        .map((distribution, index) => ({
          id: `surplus_row_${index}_${distribution.slug}`,
          destinationSlug: distribution.slug,
          destinationLabel: distribution.label,
          amount: distribution.amount,
        })),
    );
    setSurplusMessage(null);
    setEditingSurplusRowId(null);
  }, [data?.surplusRecommendations]);

  if (isLoading || monthWorkflow.isLoading) {
    return (
      <PageShell eyebrow="Overview" title="Dashboard" description={`${activeMonthLabel} financial snapshot.`}>
        <LoadingState label="Loading the current financial snapshot..." />
      </PageShell>
    );
  }

  if (error || !data || monthWorkflow.error || !monthWorkflow.data) {
    return (
      <PageShell eyebrow="Overview" title="Dashboard" description={`${activeMonthLabel} financial snapshot.`}>
        <ErrorState
          title="Failed to load dashboard"
          message={error ?? monthWorkflow.error ?? "We could not load the current dashboard data. Please try again."}
          onRetry={() => {
            void reload();
            void monthWorkflow.reload();
          }}
        />
      </PageShell>
    );
  }

  const activeCategories = data.categories
    .filter((category) => category.isActive !== false)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug));

  const activeCategoryCount = activeCategories.length || data.latestAllocationReport?.allocations.length || 0;
  const latestPeriodIncome = data.latestPeriod?.incomeTotal ?? "0.00";
  const latestSurplus = data.latestPeriod?.surplusOrDeficit ?? "0.00";
  const bucketBalancesBySlug = new Map(data.dashboard.bucket_balances.map((bucket) => [bucket.slug, bucket]));
  const monthlyProgressByBucketId = new Map(data.dashboard.monthly_bucket_progress.map((progress) => [progress.bucket_id, progress]));
  const latestAllocationAmounts = new Map((data.latestAllocationReport?.allocations ?? []).map((allocation) => [allocation.slug, allocation.amount]));
  const allocationRows = activeCategories.length
    ? activeCategories.map((category) => ({
      bucketId: category.id,
      slug: category.slug,
      label: category.label,
      percent: category.allocationPercent,
      allocatedAmount: latestAllocationAmounts.get(category.slug) ?? null,
      currentBalance: bucketBalancesBySlug.get(category.slug)?.balance ?? null,
      percentOfTotal: bucketBalancesBySlug.get(category.slug)?.percent_of_total ?? null,
      monthlyProgress: monthlyProgressByBucketId.get(category.id) ?? null,
    }))
    : [];

  const savingsBalance = Number(data.financialHealth.savingsBalance);
  const savingsFloor = Number(data.financialHealth.savingsFloor);
  const savingsFloorEnabled = data.financialHealth.savingsFloorEnabled === true;
  const isBelowSavingsFloor = savingsFloorEnabled && savingsBalance < savingsFloor;
  const activeDestinationOptions = activeCategories.map((category) => ({
    slug: category.slug,
    label: category.label,
  }));
  const suggestedRows = savingsFloorEnabled && isBelowSavingsFloor
    ? [...surplusDraftRows].sort((left, right) => (left.destinationSlug === "savings" ? -1 : 0) - (right.destinationSlug === "savings" ? -1 : 0))
    : surplusDraftRows;
  const surplusExists = Number(data.surplusRecommendations.netSurplus) > 0 && suggestedRows.length > 0;
  const draftTotal = suggestedRows.reduce((sum, row) => sum + Number(normalizeMoneyInput(row.amount) ?? "0.00"), 0);
  const netSurplus = Number(data.surplusRecommendations.netSurplus);
  const draftMatchesSurplus = Math.abs(draftTotal - netSurplus) < 0.005;
  const editingSurplusRow = suggestedRows.find((row) => row.id === editingSurplusRowId) ?? null;
  const movingSavingsPriorityAway = Boolean(
    editingSurplusRow
    && savingsFloorEnabled
    && isBelowSavingsFloor
    && editingSurplusRow.destinationSlug === "savings"
    && surplusRowDraft.destinationSlug !== "savings",
  );

  function handleResetSurplusDraftRows() {
    setSurplusDraftRows(
      data.surplusRecommendations.distributions
        .filter((distribution) => Number(distribution.amount) > 0)
        .map((distribution, index) => ({
          id: `surplus_row_${index}_${distribution.slug}`,
          destinationSlug: distribution.slug,
          destinationLabel: distribution.label,
          amount: distribution.amount,
        })),
    );
    setSurplusMessage(null);
    setEditingSurplusRowId(null);
  }

  function openSurplusRowEditor(row: SurplusSuggestionDraftRow) {
    setEditingSurplusRowId(row.id);
    setSurplusRowDraft({
      destinationSlug: row.destinationSlug,
      amount: row.amount,
    });
    setSurplusMessage(null);
  }

  function handleApplySurplusRowEdit() {
    const nextDestination = activeDestinationOptions.find((option) => option.slug === surplusRowDraft.destinationSlug);
    if (!editingSurplusRow || !nextDestination) {
      return;
    }

    setSurplusDraftRows((current) => current.map((row) => (
      row.id === editingSurplusRow.id
        ? {
          ...row,
          destinationSlug: nextDestination.slug,
          destinationLabel: nextDestination.label,
          amount: normalizeMoneyInput(surplusRowDraft.amount) ?? surplusRowDraft.amount,
        }
        : row
    )));
    setEditingSurplusRowId(null);
    setSurplusMessage("Suggestion updated. Nothing has been moved automatically.");
  }

  function handleCancelSurplusRowEdit() {
    setEditingSurplusRowId(null);
    setSurplusRowDraft({ destinationSlug: "", amount: "0.00" });
  }

  return (
    <PageShell eyebrow="Overview" title="Dashboard" description={`${activeMonthLabel} financial snapshot.`}>
      {!isCurrentMonth ? (
        <div
          className="rounded-2xl border px-4 py-3 text-sm"
          style={{
            borderColor: "var(--border-color)",
            background: "var(--surface-plain)",
            color: "var(--text-muted)",
          }}
        >
          Viewing {activeMonthLabel} - this is a historical snapshot.{" "}
          <button type="button" className="font-medium text-[var(--primary-color)]" onClick={jumpToCurrentMonth}>
            Back to current month
          </button>
        </div>
      ) : null}
      {monthWorkflow.data.reminderMonth ? <MonthReminderBanner monthKey={monthWorkflow.data.reminderMonth.monthKey} /> : null}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryMetricCard
          title="Income this month"
          value={formatCurrency(latestPeriodIncome)}
          subtitle={`${data.incomeCount} deposit${data.incomeCount === 1 ? "" : "s"}`}
          badge={data.latestPeriod?.alertStatus ?? "ok"}
          tone={alertTone(data.latestPeriod?.alertStatus)}
        />
        <SummaryMetricCard
          title="Net surplus"
          value={formatCurrency(latestSurplus)}
          subtitle={monthWorkflow.data.activeMonthStatus.status.replaceAll("_", " ")}
          badge={monthWorkflow.data.activeMonthStatus.status}
          tone={monthWorkflow.data.activeMonthStatus.status === "closed" ? "success" : alertTone(data.latestPeriod?.alertStatus)}
        />
        <SummaryMetricCard
          title="Active categories"
          value={String(activeCategoryCount)}
          subtitle={activeCategoryCount ? "Configuration ready" : "Awaiting setup"}
          badge={activeCategoryCount ? "configured" : "empty"}
          tone={activeCategoryCount ? "success" : "warning"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.6fr,1fr]">
        <div className="space-y-4">
          <AllocationBarChart
            items={allocationRows.map((row) => ({
              bucketId: row.bucketId,
              slug: row.slug,
              label: row.label,
              allocationPercent: row.percent,
              allocatedThisMonth: row.monthlyProgress?.allocated_this_month ?? row.allocatedAmount ?? null,
              addedThisMonth: row.monthlyProgress?.added_this_month ?? "0.00",
              reservedForGoalsThisMonth: row.monthlyProgress?.reserved_for_goals_this_month ?? "0.00",
              availableThisMonth: row.monthlyProgress?.available_this_month ?? row.currentBalance ?? null,
              usedThisMonth: row.monthlyProgress?.used_this_month ?? null,
              remainingThisMonth: row.monthlyProgress?.remaining_this_month ?? row.currentBalance ?? null,
              ttdBalance: row.currentBalance ?? "0.00",
              percentOfTotal: row.percentOfTotal ?? null,
              percentUsedThisMonth: row.monthlyProgress?.percent_used_this_month ?? null,
              percentReservedForGoalsThisMonth: row.monthlyProgress?.percent_reserved_for_goals_this_month ?? null,
            }))}
          />
        </div>

        <div className="space-y-4">
          {savingsFloorEnabled && isBelowSavingsFloor ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">Savings is below your floor.</div>
                  <div className="mt-1 text-[12px] leading-5">
                    Current savings is {formatCurrency(data.financialHealth.savingsBalance)} against a floor of {formatCurrency(data.financialHealth.savingsFloor)}.
                  </div>
                </div>
                <Link className="text-[12px] font-semibold text-rose-700 underline-offset-2 hover:underline" to="/settings">
                  Adjust in Settings
                </Link>
              </div>
            </div>
          ) : null}

          {surplusExists ? (
            <Card
              title="Surplus Suggestions"
              subtitle="Review the current recommendation, adjust it if needed, and keep it manual until you apply it elsewhere."
              actions={<Badge tone={alertTone(data.surplusRecommendations.alertStatus)}>Surplus {formatCurrency(data.surplusRecommendations.netSurplus)}</Badge>}
            >
              <div className="space-y-4">
                <div className="rounded-2xl border border-[var(--border-color)] px-4 py-4" style={{ background: "var(--surface-plain)" }}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-[var(--text-strong)]">Surplus available</div>
                      <div className="mt-1 text-[12px] text-[var(--text-muted)]">{formatCurrency(data.surplusRecommendations.netSurplus)} ready for review.</div>
                    </div>
                    <Link className="text-xs font-semibold text-[var(--primary-color)]" to="/monthly-review">
                      Open Monthly Review -&gt;
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {suggestedRows.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        className="flex items-center justify-between rounded-2xl border border-[var(--border-color)] px-3 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-lift"
                        style={{ background: "var(--surface-color)" }}
                        onClick={() => openSurplusRowEditor(row)}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[var(--text-strong)]">+ {formatCurrency(row.amount)} to {row.destinationLabel}</span>
                          {savingsFloorEnabled && isBelowSavingsFloor && row.destinationSlug === "savings" ? (
                            <span className="mt-1 inline-flex rounded-full bg-[var(--badge-warning-bg,var(--surface-elevated))] px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                              Savings priority
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[11px] font-medium text-[var(--text-muted)]">Edit</span>
                      </button>
                    ))}
                  </div>
                </div>

                {editingSurplusRow ? (
                  <div className="rounded-[1.5rem] border border-[var(--border-color)] px-4 py-4" style={{ background: "var(--surface-plain)" }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--text-strong)]">Edit suggestion</div>
                        <div className="mt-1 text-[12px] text-[var(--text-muted)]">Adjust the amount and destination bucket, then apply or cancel the change.</div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <MoneyInput
                        label="Amount"
                        name={`surplus-amount-${editingSurplusRow.id}`}
                        value={surplusRowDraft.amount}
                        onChange={(value) => {
                          setSurplusRowDraft((current) => ({ ...current, amount: value }));
                          setSurplusMessage(null);
                        }}
                      />
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium tracking-[0.01em] text-[var(--text-strong)]">Destination bucket</span>
                        <select
                          className="ui-field"
                          value={surplusRowDraft.destinationSlug}
                          onChange={(event) => {
                            setSurplusRowDraft((current) => ({ ...current, destinationSlug: event.target.value }));
                            setSurplusMessage(null);
                          }}
                        >
                          {activeDestinationOptions.map((option) => (
                            <option key={option.slug} value={option.slug}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {movingSavingsPriorityAway ? (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                        Warning: this choice conflicts with your savings floor. Savings is already below the floor, so RAF is prioritizing Savings in the recommendation.
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-color)] px-3 py-3 text-sm" style={{ background: "var(--surface-color)" }}>
                      <div>
                        <div className="font-semibold text-[var(--text-strong)]">Draft total {formatCurrency(draftTotal.toFixed(2))}</div>
                        <div className="mt-1 text-[12px] text-[var(--text-muted)]">
                          {draftMatchesSurplus
                            ? "The draft matches the current surplus."
                            : `Keep this aligned with ${formatCurrency(data.surplusRecommendations.netSurplus)} before confirming.`}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" className="min-h-9 rounded-full px-3 py-1.5 text-xs" onClick={handleCancelSurplusRowEdit}>
                          Cancel
                        </Button>
                        <Button type="button" className="min-h-9 rounded-full px-3 py-1.5 text-xs" disabled={!draftMatchesSurplus} onClick={handleApplySurplusRowEdit}>
                          Apply
                        </Button>
                      </div>
                    </div>
                    {surplusMessage ? <p className="mt-3 text-[12px] italic text-[var(--text-muted)]">{surplusMessage}</p> : null}
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button type="button" variant="secondary" className="min-h-9 rounded-full px-3 py-1.5 text-xs" onClick={handleResetSurplusDraftRows}>
                    Reset suggestions
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          <Card
            title="Recent activity"
            actions={(
              <Link className="text-[11px] font-medium text-stone-500" to="/transactions">
                See all -&gt;
              </Link>
            )}
          >
            {data.recentTransactions.length ? (
              <div style={{ borderColor: "var(--border-color)" }} className="divide-y">
                {data.recentTransactions.map((transaction) => {
                  const categoryLabel = transaction.categoryId
                    ? activeCategories.find((category) => category.id === transaction.categoryId)?.label ?? transaction.categoryId
                    : "Unassigned";

                  return (
                    <div key={transaction.id} className="flex min-h-9 items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-[var(--text-strong)]">{transaction.description}</div>
                        <div className="mt-1 text-[10px] text-[var(--text-muted)]">{formatIsoDate(transaction.transactionDate)}</div>
                      </div>
                      <Badge tone={transactionTone(transaction)}>{categoryLabel}</Badge>
                      <div className={`w-20 text-right text-[13px] font-semibold ${transaction.direction === "credit" ? "text-emerald-700" : "text-rose-700"}`}>
                        {formatCurrency(transaction.amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="No activity yet"
                message="Recorded transactions will show up here."
              />
            )}
          </Card>
        </div>
      </section>
    </PageShell>
  );
}
