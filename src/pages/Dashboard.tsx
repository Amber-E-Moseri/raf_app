import { useMemo } from "react";

import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { ApiError } from "../api/client";
import { getIncome, getIncomeAllocations } from "../api/incomeApi";
import { getDashboardReport, getFinancialHealthReport } from "../api/reportsApi";
import { getTransactions } from "../api/transactionsApi";
import { AllocationBarChart } from "../components/dashboard/AllocationBarChart";
import { FinancialHealthIndicator } from "../components/dashboard/FinancialHealthIndicator";
import { SummaryMetricCard } from "../components/dashboard/SummaryMetricCard";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { PageShell } from "../components/layout/PageShell";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Table } from "../components/ui/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { formatCurrency, formatIsoDate, formatPercentWithDigits, monthRange } from "../lib/format";
import type {
  AllocationCategory,
  DashboardPeriod,
  DashboardReport,
  FinancialHealthReport,
  IncomeAllocationReport,
  Transaction,
} from "../lib/types";

interface DashboardViewModel {
  dashboard: DashboardReport;
  categories: AllocationCategory[];
  latestAllocationReport: IncomeAllocationReport | null;
  latestPeriod: DashboardPeriod | null;
  financialHealth: FinancialHealthReport;
  recentTransactions: Transaction[];
}

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
      recentTransactions: transactionsResponse.items,
    };
  }, [from, to]);

  if (isLoading) {
    return (
      <PageShell
        eyebrow="Overview"
        title="Dashboard"
        description="A current snapshot of income, allocation posture, and recent movement."
      >
        <LoadingState label="Loading the current financial snapshot..." />
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell
        eyebrow="Overview"
        title="Dashboard"
        description="A current snapshot of income, allocation posture, and recent movement."
      >
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
  const bucketBalancesBySlug = new Map(
    data.dashboard.bucket_balances.map((bucket) => [bucket.slug, bucket.balance]),
  );
  const monthlyProgressByBucketName = new Map(
    data.dashboard.monthly_bucket_progress.map((progress) => [progress.bucket_id, progress]),
  );
  const goalProgressByBucketName = new Map(
    data.dashboard.goal_progress.map((progress) => [progress.bucket_id, progress]),
  );
  const latestAllocationAmounts = new Map(
    (data.latestAllocationReport?.allocations ?? []).map((allocation) => [allocation.slug, allocation.amount]),
  );
  const allocationRows = activeCategories.length
    ? activeCategories.map((category) => ({
      bucketId: category.id,
      slug: category.slug,
      label: category.label,
      percent: category.allocationPercent,
      allocatedAmount: latestAllocationAmounts.get(category.slug) ?? null,
      currentBalance: bucketBalancesBySlug.get(category.slug) ?? null,
      monthlyProgress: monthlyProgressByBucketName.get(category.id) ?? null,
      goalProgress: goalProgressByBucketName.get(category.id) ?? null,
    }))
    : (data.latestAllocationReport?.allocations.map((allocation) => ({
      bucketId: allocation.slug,
      slug: allocation.slug,
      label: allocation.label,
      percent: null,
      allocatedAmount: allocation.amount,
      currentBalance: null,
      monthlyProgress: null,
      goalProgress: null,
    })) ?? []);

  return (
    <PageShell
      eyebrow="Overview"
      title="Dashboard"
      description="A clearer operating view of income, allocations, financial health, and recent movement, using backend responses as the source of truth."
    >
      <section className="grid gap-4 xl:grid-cols-3">
        <SummaryMetricCard
          title="Total Income This Month"
          value={formatCurrency(latestPeriodIncome)}
          subtitle="Reported by the dashboard endpoint for the current month."
          badge="income"
          tone="success"
        />
        <SummaryMetricCard
          title="Net Surplus"
          value={formatCurrency(latestSurplus)}
          subtitle="Latest monthly surplus or deficit from backend reporting."
          badge={data.latestPeriod?.alertStatus ?? "unknown"}
          tone={alertTone(data.latestPeriod?.alertStatus)}
        />
        <SummaryMetricCard
          title="Active Categories"
          value={String(activeCategoryCount)}
          subtitle="Count of currently exposed allocation categories."
          badge={activeCategoryCount ? "configured" : "unavailable"}
          tone={activeCategoryCount ? "success" : "warning"}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.45fr,0.95fr]">
        <Card
          title="Allocation Breakdown"
          subtitle="Current allocation bucket configuration from the backend, with the latest deposit snapshot shown when available."
        >
          {allocationRows.length ? (
            <>
              <Table headers={["Category", "Percent Allocation", "Allocated Amount", "Current Balance"]}>
                {allocationRows.map((row) => (
                  <tr key={row.slug}>
                    <td className="px-4 py-3 text-sm font-medium text-raf-ink">{row.label}</td>
                    <td className="px-4 py-3 text-sm text-stone-600">
                      {row.percent ? formatPercentWithDigits(row.percent, 2) : "N/A"}
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-600">
                      {row.allocatedAmount == null ? "No recent deposit snapshot" : formatCurrency(row.allocatedAmount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-500">
                      {row.currentBalance == null ? "Not exposed by API" : formatCurrency(row.currentBalance)}
                    </td>
                  </tr>
                ))}
              </Table>
              <p className="mt-4 text-xs text-stone-500">
                Current balance is reserved money in RAF. The monthly usage view on the right shows how much is left this month.
              </p>
            </>
          ) : (
            <EmptyState
              title="No allocation buckets available"
              message="Configure allocation preferences or create the first deposit to populate this view."
            />
          )}
        </Card>

        <div className="space-y-6">
          <AllocationBarChart
            items={allocationRows.map((row) => ({
              bucketId: row.bucketId,
              label: row.label,
              allocationPercent: row.percent,
              allocatedThisMonth: row.monthlyProgress?.allocated_this_month ?? null,
              usedThisMonth: row.monthlyProgress?.used_this_month ?? null,
              remainingThisMonth: row.monthlyProgress?.remaining_this_month ?? null,
              percentUsedThisMonth: row.monthlyProgress?.percent_used_this_month ?? null,
              goalName: row.goalProgress?.goal_name ?? null,
              goalTargetAmount: row.goalProgress?.target_amount ?? null,
              goalReservedAmount: row.goalProgress?.reserved_amount ?? null,
              goalProgressPercent: row.goalProgress?.progress_percent ?? null,
            }))}
          />
          <FinancialHealthIndicator report={data.financialHealth} />
        </div>
      </section>

      <Card title="Recent Transactions" subtitle="Latest 10 transactions from the backend ledger.">
        {data.recentTransactions.length ? (
          <Table headers={["Date", "Description", "Category", "Amount"]}>
            {data.recentTransactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className="px-4 py-3 text-sm text-stone-600">{formatIsoDate(transaction.transactionDate)}</td>
                <td className="px-4 py-3 text-sm font-medium text-raf-ink">{transaction.description}</td>
                <td className="px-4 py-3 text-sm text-stone-600">{transaction.categoryId ?? "Unassigned"}</td>
                <td className="px-4 py-3 text-sm text-stone-600">{formatCurrency(transaction.amount)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState
            title="No transactions recorded"
            message="Transaction history will appear here once money starts moving through categories."
          />
        )}
      </Card>
    </PageShell>
  );
}
