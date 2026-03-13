import { useMemo } from "react";
import { Link } from "react-router-dom";

import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { ApiError } from "../api/client";
import { getIncome, getIncomeAllocations } from "../api/incomeApi";
import { getDashboardReport, getFinancialHealthReport } from "../api/reportsApi";
import { getTransactions } from "../api/transactionsApi";
import { AllocationBarChart } from "../components/dashboard/AllocationBarChart";
import { SummaryMetricCard } from "../components/dashboard/SummaryMetricCard";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { PageShell } from "../components/layout/PageShell";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { useAsyncData } from "../hooks/useAsyncData";
import { formatCurrency, formatIsoDate, monthRange } from "../lib/format";
import type {
  AllocationCategory,
  DashboardPeriod,
  IncomeAllocationReport,
  Transaction,
} from "../lib/types";

interface DashboardViewModel {
  dashboard: DashboardViewModelReport;
  categories: AllocationCategory[];
  latestAllocationReport: IncomeAllocationReport | null;
  latestPeriod: DashboardPeriod | null;
  financialHealth: DashboardHealthReport;
  recentTransactions: Transaction[];
  incomeCount: number;
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
  const { from, to } = useMemo(() => monthRange(), []);

  const { data, error, isLoading, reload } = useAsyncData<DashboardViewModel>(async () => {
    const [dashboard, financialHealth, incomeResponse, transactionsResponse] = await Promise.all([
      getDashboardReport({ from, to }),
      getFinancialHealthReport(),
      getIncome({ from, to }),
      getTransactions({ from, to, limit: 10 }),
    ]);

    let categories: AllocationCategory[] = [];

    try {
      categories = await getAllocationCategories();
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
      recentTransactions: transactionsResponse.items.slice(0, 5),
      incomeCount: incomeResponse.items.length,
    };
  }, [from, to]);

  if (isLoading) {
    return (
      <PageShell eyebrow="Overview" title="Dashboard" description="Monthly financial snapshot.">
        <LoadingState label="Loading the current financial snapshot..." />
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell eyebrow="Overview" title="Dashboard" description="Monthly financial snapshot.">
        <ErrorState title="Failed to load dashboard" message={error ?? "We could not load the current dashboard data. Please try again."} onRetry={() => void reload()} />
      </PageShell>
    );
  }

  const activeCategories = data.categories
    .filter((category) => category.isActive !== false)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug));

  const activeCategoryCount = activeCategories.length || data.latestAllocationReport?.allocations.length || 0;
  const latestPeriodIncome = data.latestPeriod?.incomeTotal ?? "0.00";
  const latestSurplus = data.latestPeriod?.surplusOrDeficit ?? "0.00";
  const bucketBalancesBySlug = new Map(data.dashboard.bucket_balances.map((bucket) => [bucket.slug, bucket.balance]));
  const monthlyProgressByBucketId = new Map(data.dashboard.monthly_bucket_progress.map((progress) => [progress.bucket_id, progress]));
  const goalProgressByBucketId = new Map(data.dashboard.goal_progress.map((progress) => [progress.bucket_id, progress]));
  const latestAllocationAmounts = new Map((data.latestAllocationReport?.allocations ?? []).map((allocation) => [allocation.slug, allocation.amount]));
  const allocationRows = activeCategories.length
    ? activeCategories.map((category) => ({
      bucketId: category.id,
      slug: category.slug,
      label: category.label,
      percent: category.allocationPercent,
      allocatedAmount: latestAllocationAmounts.get(category.slug) ?? null,
      currentBalance: bucketBalancesBySlug.get(category.slug) ?? null,
      monthlyProgress: monthlyProgressByBucketId.get(category.id) ?? null,
      goalProgress: goalProgressByBucketId.get(category.id) ?? null,
    }))
    : [];

  const savingsBalance = Number(data.financialHealth.savingsBalance);
  const savingsFloor = Number(data.financialHealth.savingsFloor);
  const emergencyFundBalance = Number(data.financialHealth.emergencyFundBalance);
  const availableSavings = Number(data.financialHealth.availableSavings);
  const savingsMax = Math.max(savingsBalance, emergencyFundBalance, savingsFloor, 1);
  const savingsPercent = Math.max(0, Math.min(100, (savingsBalance / savingsMax) * 100));
  const floorPercent = Math.max(0, Math.min(100, (savingsFloor / savingsMax) * 100));

  return (
    <PageShell eyebrow="Overview" title="Dashboard" description="Monthly financial snapshot.">
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
          subtitle={`${data.dashboard.monthly_bucket_progress.length} buckets tracked`}
          badge={data.latestPeriod?.alertStatus ?? "ok"}
          tone={alertTone(data.latestPeriod?.alertStatus)}
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
              label: row.label,
              allocationPercent: row.percent,
              allocatedThisMonth: row.monthlyProgress?.allocated_this_month ?? row.allocatedAmount ?? null,
              usedThisMonth: row.monthlyProgress?.used_this_month ?? null,
              remainingThisMonth: row.monthlyProgress?.remaining_this_month ?? row.currentBalance ?? null,
              percentUsedThisMonth: row.monthlyProgress?.percent_used_this_month ?? null,
              goalName: row.goalProgress?.goal_name ?? null,
              goalTargetAmount: row.goalProgress?.target_amount ?? null,
              goalReservedAmount: row.goalProgress?.reserved_amount ?? null,
              goalProgressPercent: row.goalProgress?.progress_percent ?? null,
            }))}
          />
        </div>

        <div className="space-y-4">
          <Card
            title="Savings floor"
            actions={<Badge tone={alertTone(data.financialHealth.alertStatus)}>{data.financialHealth.alertStatus === "ok" ? "Protected" : "At risk"}</Badge>}
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-[24px] font-bold leading-none text-raf-ink">{formatCurrency(data.financialHealth.savingsBalance)}</div>
                <div className="text-[11px] font-medium text-stone-500">{data.financialHealth.alertStatus === "ok" ? "Protected" : "At risk"}</div>
              </div>
              <div className="relative">
                <div className="progress-track h-2 overflow-hidden rounded-full">
                  <div className="h-full rounded-full bg-raf-moss" style={{ width: `${savingsPercent}%` }} />
                </div>
                <div
                  className="absolute top-[-3px] h-4 w-[2px] rounded-full bg-amber-500"
                  style={{ left: `calc(${floorPercent}% - 1px)` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-medium text-stone-500">
                <span>$0</span>
                <span>{formatCurrency(data.financialHealth.savingsFloor)} floor</span>
                <span>{formatCurrency(String(savingsMax.toFixed(2)))} max</span>
              </div>
              <p className="text-[13px] text-stone-500">
                Available savings: {formatCurrency(data.financialHealth.availableSavings)}
              </p>
            </div>
          </Card>

          <Card
            title="Recent activity"
            actions={(
              <Link className="text-[11px] font-medium text-stone-500" to="/transactions">
                See all -&gt;
              </Link>
            )}
          >
            {data.recentTransactions.length ? (
              <div className="divide-y divide-stone-200">
                {data.recentTransactions.map((transaction) => {
                  const categoryLabel = transaction.categoryId
                    ? activeCategories.find((category) => category.id === transaction.categoryId)?.label ?? transaction.categoryId
                    : "Unassigned";

                  return (
                    <div key={transaction.id} className="flex min-h-9 items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-raf-ink">{transaction.description}</div>
                        <div className="mt-1 text-[10px] text-stone-500">{formatIsoDate(transaction.transactionDate)}</div>
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
