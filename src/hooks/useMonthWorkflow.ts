import { useMemo } from "react";

import { getAllocationCategoriesAsOf } from "../api/allocationCategoriesApi";
import { ApiError } from "../api/client";
import { getDebts } from "../api/debtsApi";
import { getGoals } from "../api/goalsApi";
import { getImportedTransactions } from "../api/importsApi";
import { getIncome } from "../api/incomeApi";
import { getMonthlyReviews } from "../api/monthlyReviewApi";
import { getDashboardReport } from "../api/reportsApi";
import { getTransactions } from "../api/transactionsApi";
import { useAsyncData } from "./useAsyncData";
import {
  formatMonthLabel,
  getCurrentMonthKey,
  getMonthKeyFromDate,
  monthRangeFromKey,
  shiftMonthKey,
} from "../lib/period";

type MonthStatus = "open" | "needs_review" | "ready_to_close" | "closed";

interface MonthStatusItem {
  monthKey: string;
  label: string;
  status: MonthStatus;
  hasActivity: boolean;
  unresolvedImports: number;
  reviewId: string | null;
}

interface CloseSummary {
  incomeTotal: string;
  expenseTotal: string;
  debtPaymentsTotal: string;
  protectedContributionsTotal: string;
  remainingSurplusOrDeficit: string;
  unresolvedImportedTransactions: number;
  canClose: boolean;
}

interface MonthWorkflowData {
  activeMonthStatus: MonthStatusItem;
  reminderMonth: MonthStatusItem | null;
  monthStatuses: MonthStatusItem[];
  closeSummary: CloseSummary;
}

function parseMoney(value: string | number | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatMoney(value: number) {
  return value.toFixed(2);
}

function isProtectedBucket(bucketName: string, hasGoal: boolean) {
  return hasGoal || /saving|buffer|invest/i.test(bucketName);
}

async function getTransactionsForHistoryRange(from: string, to: string) {
  const items = [];
  let cursor = null;

  do {
    const response = await getTransactions({
      from,
      to,
      cursor,
      limit: 100,
    });

    items.push(...response.items);
    cursor = response.nextCursor;
  } while (cursor);

  return items;
}

export function useMonthWorkflow(activeMonth: string) {
  const historyStartMonth = useMemo(() => shiftMonthKey(activeMonth, -11), [activeMonth]);
  const historyRange = useMemo(() => ({
    from: `${historyStartMonth}-01`,
    to: monthRangeFromKey(activeMonth).to,
  }), [activeMonth, historyStartMonth]);

  return useAsyncData<MonthWorkflowData>(async () => {
    const activeRange = monthRangeFromKey(activeMonth);

    const [
      dashboard,
      incomeResponse,
      historyTransactions,
      importedRowsResponse,
      monthlyReviewsResponse,
      categoriesResponse,
      _debtsResponse,
      _goalsResponse,
    ] = await Promise.all([
      getDashboardReport(activeRange),
      getIncome(historyRange),
      getTransactionsForHistoryRange(historyRange.from, historyRange.to),
      getImportedTransactions(),
      getMonthlyReviews(historyRange),
      getAllocationCategoriesAsOf(activeRange.to).catch((error) => {
        if (error instanceof ApiError && error.status === 404) {
          return [];
        }

        throw error;
      }),
      getDebts(),
      getGoals(),
    ]);

    const reviewByMonth = new Map(
      monthlyReviewsResponse.items.map((review) => [review.reviewMonth.slice(0, 7), review.id]),
    );
    const importsByMonth = new Map<string, number>();
    const incomeMonths = new Set<string>();
    const transactionMonths = new Set<string>();

    incomeResponse.items.forEach((item) => {
      const monthKey = getMonthKeyFromDate(item.receivedDate);
      if (monthKey) {
        incomeMonths.add(monthKey);
      }
    });

    historyTransactions.forEach((item) => {
      const monthKey = getMonthKeyFromDate(item.transactionDate);
      if (monthKey) {
        transactionMonths.add(monthKey);
      }
    });

    importedRowsResponse.items.forEach((item) => {
      const monthKey = getMonthKeyFromDate(item.date);
      if (!monthKey || item.status !== "unreviewed") {
        return;
      }

      importsByMonth.set(monthKey, (importsByMonth.get(monthKey) ?? 0) + 1);
    });

    const monthStatuses: MonthStatusItem[] = [];
    let cursor = historyStartMonth;

    while (cursor <= activeMonth) {
      const unresolvedImports = importsByMonth.get(cursor) ?? 0;
      const hasActivity = incomeMonths.has(cursor) || transactionMonths.has(cursor) || unresolvedImports > 0;
      const reviewId = reviewByMonth.get(cursor) ?? null;

      let status: MonthStatus = "open";
      if (reviewId) {
        status = "closed";
      } else if (unresolvedImports > 0) {
        status = "needs_review";
      } else if (hasActivity && cursor < getCurrentMonthKey()) {
        status = "ready_to_close";
      }

      monthStatuses.push({
        monthKey: cursor,
        label: formatMonthLabel(cursor),
        status,
        hasActivity,
        unresolvedImports,
        reviewId,
      });

      cursor = shiftMonthKey(cursor, 1);
    }

    const activeMonthStatus = monthStatuses.find((item) => item.monthKey === activeMonth) ?? {
      monthKey: activeMonth,
      label: formatMonthLabel(activeMonth),
      status: "open" as MonthStatus,
      hasActivity: false,
      unresolvedImports: 0,
      reviewId: null,
    };

    const reminderMonth = monthStatuses.find((item) => (
      item.monthKey < activeMonth && item.hasActivity && item.status !== "closed"
    )) ?? null;

    const debtPaymentsTotal = historyTransactions
      .filter((item) => getMonthKeyFromDate(item.transactionDate) === activeMonth)
      .filter((item) => item.direction === "debit" && item.linkedDebtId)
      .reduce((sum, item) => sum + parseMoney(item.amount), 0);

    const goalBucketIds = new Set(dashboard.goal_progress.map((goal) => goal.bucket_id));
    const categoryById = new Map(categoriesResponse.map((category) => [category.id, category]));

    const protectedContributionsTotal = dashboard.monthly_bucket_progress.reduce((sum, bucket) => {
      const category = categoryById.get(bucket.bucket_id);
      const hasGoal = goalBucketIds.has(bucket.bucket_id);
      if (!isProtectedBucket(category?.label ?? bucket.bucket_name, hasGoal)) {
        return sum;
      }

      return sum + parseMoney(bucket.allocated_this_month);
    }, 0);

    return {
      activeMonthStatus,
      reminderMonth,
      monthStatuses,
      closeSummary: {
        incomeTotal: dashboard.periods[0]?.incomeTotal ?? "0.00",
        expenseTotal: dashboard.periods[0]?.spendingTotal ?? "0.00",
        debtPaymentsTotal: formatMoney(debtPaymentsTotal),
        protectedContributionsTotal: formatMoney(protectedContributionsTotal),
        remainingSurplusOrDeficit: dashboard.periods[0]?.surplusOrDeficit ?? "0.00",
        unresolvedImportedTransactions: activeMonthStatus.unresolvedImports,
        canClose: activeMonthStatus.unresolvedImports === 0,
      },
    };
  }, [activeMonth, historyRange.from, historyRange.to]);
}
