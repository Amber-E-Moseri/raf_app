import { useEffect, useMemo, useState } from "react";

import { applyMonthlyReview, applyMonthlyReviewsInRange } from "../api/monthlyReviewApi";
import { getSurplusRecommendations } from "../api/reportsApi";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingSpinner } from "../components/feedback/LoadingSpinner";
import { LoadingState } from "../components/feedback/LoadingState";
import { MonthReminderBanner } from "../components/feedback/MonthReminderBanner";
import { SuccessNotice } from "../components/feedback/SuccessNotice";
import { PageShell } from "../components/layout/PageShell";
import { usePeriod } from "../components/layout/PeriodProvider";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { Table } from "../components/ui/Table";
import { useMonthWorkflow } from "../hooks/useMonthWorkflow";
import { formatCurrency } from "../lib/format";
import { validateFirstDayOfMonth } from "../lib/validation";
import type { ApplyMonthlyReviewResponse, SurplusRecommendationsReport } from "../lib/types";

function defaultReviewMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function alertTone(status: "ok" | "elevated" | "risky") {
  if (status === "risky") {
    return "danger";
  }

  if (status === "elevated") {
    return "warning";
  }

  return "success";
}

function incrementMonth(reviewMonth: string) {
  const value = new Date(`${reviewMonth}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
}

function buildReviewMonthRange(startMonth: string, endMonth: string) {
  if (startMonth > endMonth) {
    return [];
  }

  const reviewMonths = [];
  let currentMonth = startMonth;

  while (currentMonth <= endMonth) {
    reviewMonths.push(currentMonth);
    currentMonth = incrementMonth(currentMonth);
  }

  return reviewMonths;
}

export function MonthlyReview() {
  const { activeMonth, activeMonthLabel, isCurrentMonth, jumpToCurrentMonth, setActiveMonth } = usePeriod();
  const initialMonth = useMemo(() => activeMonth ? `${activeMonth}-01` : defaultReviewMonth(), [activeMonth]);
  const [reviewMonth, setReviewMonth] = useState(initialMonth);
  const [batchStartMonth, setBatchStartMonth] = useState(initialMonth);
  const [batchEndMonth, setBatchEndMonth] = useState(initialMonth);
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [preview, setPreview] = useState<SurplusRecommendationsReport | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyMonthlyReviewResponse | null>(null);
  const [batchResult, setBatchResult] = useState<{
    reviewMonths: string[];
    appliedCount: number;
    totalTransactions: number;
  } | null>(null);
  const monthWorkflow = useMonthWorkflow(activeMonth);

  useEffect(() => {
    const nextMonth = `${activeMonth}-01`;
    setReviewMonth(nextMonth);
    setBatchStartMonth(nextMonth);
    setBatchEndMonth(nextMonth);
  }, [activeMonth]);

  useEffect(() => {
    let isCancelled = false;

    async function loadPreview() {
      setIsPreviewLoading(true);
      setPreviewError(null);

      try {
        const next = await getSurplusRecommendations(reviewMonth);
        if (!isCancelled) {
          setPreview(next);
        }
      } catch (error) {
        if (!isCancelled) {
          setPreview(null);
          setPreviewError(error instanceof Error ? error.message : "Preview could not be loaded.");
        }
      } finally {
        if (!isCancelled) {
          setIsPreviewLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      isCancelled = true;
    };
  }, [reviewMonth]);

  async function handleSubmit() {
    const reviewMonthError = validateFirstDayOfMonth(reviewMonth, "Review month");
    const nextErrors = { reviewMonth: reviewMonthError };
    setFieldErrors(nextErrors);

    if (reviewMonthError || monthWorkflow.data?.closeSummary.canClose === false) {
      setSubmitError(reviewMonthError ? null : "Resolve imported rows before closing this month.");
      setResult(null);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await applyMonthlyReview({
        reviewMonth,
        notes: notes.trim() || undefined,
      });
      setResult(response);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Monthly review failed.");
      setResult(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleBatchSubmit() {
    const startError = validateFirstDayOfMonth(batchStartMonth, "Start month");
    const endError = validateFirstDayOfMonth(batchEndMonth, "End month");
    const rangeError = !startError && !endError && batchStartMonth > batchEndMonth
      ? "End month must be the same as or after the start month."
      : null;
    const nextErrors = {
      ...fieldErrors,
      batchStartMonth: startError,
      batchEndMonth: endError ?? rangeError,
    };

    setFieldErrors(nextErrors);

    if (startError || endError || rangeError) {
      setSubmitError(null);
      setBatchResult(null);
      return;
    }

    const reviewMonths = buildReviewMonthRange(batchStartMonth, batchEndMonth);

    setIsBatchSubmitting(true);
    setSubmitError(null);

    try {
      const responses = await applyMonthlyReviewsInRange(
        reviewMonths,
        notes.trim() || undefined,
      );
      setBatchResult({
        reviewMonths,
        appliedCount: responses.length,
        totalTransactions: responses.reduce(
          (sum, response) => sum + response.appliedTransactions.length,
          0,
        ),
      });
      setResult(responses[responses.length - 1] ?? null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Mass monthly review failed.");
      setBatchResult(null);
    } finally {
      setIsBatchSubmitting(false);
    }
  }

  return (
    <PageShell
      eyebrow="Closeout"
      title="Monthly Review"
      description={`Close ${activeMonthLabel} with a deliberate review step.`}
    >
      {!isCurrentMonth ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Viewing {activeMonthLabel} - this is a historical snapshot.{" "}
          <button type="button" className="font-medium text-[var(--primary-color)]" onClick={jumpToCurrentMonth}>
            Back to current month
          </button>
        </div>
      ) : null}
      {monthWorkflow.data?.reminderMonth ? <MonthReminderBanner monthKey={monthWorkflow.data.reminderMonth.monthKey} tone="danger" ctaLabel="Close month" /> : null}
      {monthWorkflow.data ? (
        <Card
          title="Month Status"
          subtitle={`${monthWorkflow.data.activeMonthStatus.label} is currently ${monthWorkflow.data.activeMonthStatus.status.replaceAll("_", " ")}.`}
        >
          <div className="grid gap-4 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Income total</p>
              <p className="mt-1 text-xl font-semibold text-raf-ink">{formatCurrency(monthWorkflow.data.closeSummary.incomeTotal)}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Expense total</p>
              <p className="mt-1 text-xl font-semibold text-raf-ink">{formatCurrency(monthWorkflow.data.closeSummary.expenseTotal)}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Debt payments</p>
              <p className="mt-1 text-xl font-semibold text-raf-ink">{formatCurrency(monthWorkflow.data.closeSummary.debtPaymentsTotal)}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Protected and goal contributions</p>
              <p className="mt-1 text-xl font-semibold text-raf-ink">{formatCurrency(monthWorkflow.data.closeSummary.protectedContributionsTotal)}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Remaining surplus or deficit</p>
              <p className="mt-1 text-xl font-semibold text-raf-ink">{formatCurrency(monthWorkflow.data.closeSummary.remainingSurplusOrDeficit)}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Unresolved imported transactions</p>
              <p className="mt-1 text-xl font-semibold text-raf-ink">{monthWorkflow.data.closeSummary.unresolvedImportedTransactions}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Badge tone={monthWorkflow.data.activeMonthStatus.status === "closed" ? "success" : monthWorkflow.data.closeSummary.canClose ? "warning" : "danger"}>
              {monthWorkflow.data.activeMonthStatus.status.replaceAll("_", " ")}
            </Badge>
            {monthWorkflow.data.activeMonthStatus.status === "closed" ? (
              <span className="text-sm text-stone-500">Reviewed in Transactions for this month. Apply is locked.</span>
            ) : null}
            <span className="text-sm text-stone-500">
              Closing a month uses the current surplus suggestion and keeps carry-forward visible through the next month's reserved balances.
            </span>
          </div>
        </Card>
      ) : null}
      <section className="grid gap-4 xl:grid-cols-[1fr,1.1fr]">
        <Card title="Close Month" subtitle="This applies the monthly review and treats the month as closed once the backend saves it.">
          <div className="space-y-4">
            <Input
              label="Review month"
              name="reviewMonth"
              type="date"
              value={reviewMonth}
              error={fieldErrors.reviewMonth}
              onBlur={() => setFieldErrors((current) => ({ ...current, reviewMonth: validateFirstDayOfMonth(reviewMonth, "Review month") }))}
              onChange={(event) => {
                const nextMonth = event.target.value;
                setReviewMonth(nextMonth);
                if (/^\d{4}-\d{2}-\d{2}$/.test(nextMonth)) {
                  setActiveMonth(nextMonth.slice(0, 7));
                }
                setFieldErrors((current) => ({ ...current, reviewMonth: null }));
              }}
            />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-raf-ink">Notes</span>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                placeholder="Optional note for the review record"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
              Confirming this action asks the backend to calculate and persist the monthly review for {activeMonthLabel}.
              The frontend does not distribute surplus itself.
            </div>
            <Button
              disabled={
                isSubmitting
                || isPreviewLoading
                || monthWorkflow.data?.closeSummary.canClose === false
                || monthWorkflow.data?.activeMonthStatus.status === "closed"
              }
              onClick={() => void handleSubmit()}
              type="button"
            >
              {isSubmitting
                ? <LoadingSpinner inline size="sm" label="Closing month..." />
                : monthWorkflow.data?.activeMonthStatus.status === "closed"
                  ? "Month Closed"
                  : "Close Month"}
            </Button>
          </div>
        </Card>

        <Card title="Surplus Suggestions" subtitle="Use this recommendation panel to understand where month-end surplus will be routed.">
          {isPreviewLoading ? <LoadingState label="Loading surplus recommendation..." /> : null}
          {!isPreviewLoading && previewError ? <ErrorState title="Failed to load monthly review preview" message={previewError} /> : null}
          {!isPreviewLoading && !previewError && preview ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-stone-50 p-4">
                <div>
                  <p className="text-sm text-stone-500">Net surplus distributed</p>
                  <p className="mt-1 text-2xl font-semibold text-raf-ink">{formatCurrency(preview.netSurplus)}</p>
                </div>
                <Badge tone={alertTone(preview.alertStatus)}>{preview.alertStatus}</Badge>
              </div>
              <Table headers={["Target", "Amount"]}>
                {preview.distributions.map((distribution) => (
                  <tr key={distribution.slug}>
                    <td className="px-4 py-3 text-sm font-medium text-raf-ink">{distribution.label}</td>
                    <td className="px-4 py-3 text-sm text-stone-600">{formatCurrency(distribution.amount)}</td>
                  </tr>
                ))}
              </Table>
              {preview.targetDebtName ? (
                <p className="text-sm text-stone-500">
                  Debt target: <span className="font-medium text-raf-ink">{preview.targetDebtName}</span>
                </p>
              ) : null}
            </div>
          ) : null}
          {!isPreviewLoading && !previewError && !preview ? (
            <EmptyState
              title="No preview available"
              message="The monthly review preview endpoint returned no usable recommendation for this month."
            />
          ) : null}
        </Card>
      </section>

      <Card title="Mass Apply Review" subtitle="Apply the monthly review across a month range using the same backend apply endpoint.">
        <div className="grid gap-4 lg:grid-cols-[1fr,1fr,auto]">
          <Input
            label="Start month"
            name="batchStartMonth"
            type="date"
            value={batchStartMonth}
            error={fieldErrors.batchStartMonth}
            onBlur={() => setFieldErrors((current) => ({ ...current, batchStartMonth: validateFirstDayOfMonth(batchStartMonth, "Start month") }))}
            onChange={(event) => {
              setBatchStartMonth(event.target.value);
              setFieldErrors((current) => ({ ...current, batchStartMonth: null, batchEndMonth: null }));
            }}
          />
          <Input
            label="End month"
            name="batchEndMonth"
            type="date"
            value={batchEndMonth}
            error={fieldErrors.batchEndMonth}
            onBlur={() => setFieldErrors((current) => ({ ...current, batchEndMonth: validateFirstDayOfMonth(batchEndMonth, "End month") }))}
            onChange={(event) => {
              setBatchEndMonth(event.target.value);
              setFieldErrors((current) => ({ ...current, batchStartMonth: null, batchEndMonth: null }));
            }}
          />
          <div className="flex items-end">
            <Button
              disabled={isBatchSubmitting || isSubmitting}
              onClick={() => void handleBatchSubmit()}
              type="button"
            >
              {isBatchSubmitting ? <LoadingSpinner inline size="sm" label="Applying reviews..." /> : "Mass Apply Review"}
            </Button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
          This applies each month sequentially. If a month already has a saved review, the batch stops on that month and
          returns the backend error.
        </div>
        {batchResult ? (
          <div className="mt-4">
            <SuccessNotice
              title="Mass review applied"
              message={`Applied ${batchResult.appliedCount} month${batchResult.appliedCount === 1 ? "" : "s"} and created ${batchResult.totalTransactions} allocation transaction${batchResult.totalTransactions === 1 ? "" : "s"}.`}
            />
            <p className="mt-3 text-sm text-stone-500">
              Months applied: {batchResult.reviewMonths.join(", ")}
            </p>
          </div>
        ) : null}
      </Card>

      {submitError ? <ErrorState title="Failed to apply monthly review" message={submitError} /> : null}
      {result ? (
        <Card title="Review Applied" subtitle={`Review month ${result.review.reviewMonth}`}>
          <SuccessNotice
            title="Monthly review applied"
            message={`The backend persisted the review and created ${result.appliedTransactions.length} allocation transaction${result.appliedTransactions.length === 1 ? "" : "s"}.`}
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-[0.7fr,1fr]">
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Net surplus</p>
              <p className="mt-1 text-2xl font-semibold text-raf-ink">{formatCurrency(result.review.netSurplus)}</p>
              <div className="mt-3">
                <Badge tone={alertTone(result.review.alertStatus)}>{result.review.alertStatus}</Badge>
              </div>
            </div>
            <Table headers={["Distribution key", "Amount"]}>
              {Object.entries(result.review.distributions).map(([key, amount]) => (
                <tr key={key}>
                  <td className="px-4 py-3 text-sm font-medium text-raf-ink">{key}</td>
                  <td className="px-4 py-3 text-sm text-stone-600">{formatCurrency(amount)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      ) : null}
    </PageShell>
  );
}
