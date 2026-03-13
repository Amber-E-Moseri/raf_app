import { useEffect, useMemo, useState } from "react";

import { createMonthlyReview } from "../api/monthlyReviewApi";
import { getSurplusRecommendations } from "../api/reportsApi";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingSpinner } from "../components/feedback/LoadingSpinner";
import { LoadingState } from "../components/feedback/LoadingState";
import { SuccessNotice } from "../components/feedback/SuccessNotice";
import { PageShell } from "../components/layout/PageShell";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { Table } from "../components/ui/Table";
import { formatCurrency } from "../lib/format";
import { validateFirstDayOfMonth } from "../lib/validation";
import type { MonthlyReviewResponse, SurplusRecommendationsReport } from "../lib/types";

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

export function MonthlyReview() {
  const initialMonth = useMemo(() => defaultReviewMonth(), []);
  const [reviewMonth, setReviewMonth] = useState(initialMonth);
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [preview, setPreview] = useState<SurplusRecommendationsReport | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<MonthlyReviewResponse | null>(null);

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

    if (reviewMonthError) {
      setSubmitError(null);
      setResult(null);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await createMonthlyReview({
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

  return (
    <PageShell
      eyebrow="Closeout"
      title="Monthly Review"
      description="Review the backend's surplus recommendation first, then apply the monthly review with a deliberate confirmation step."
    >
      <section className="grid gap-6 xl:grid-cols-[1fr,1.1fr]">
        <Card title="Apply Monthly Review" subtitle="This posts to the backend monthly review create endpoint.">
          <div className="space-y-4">
            <Input
              label="Review month"
              name="reviewMonth"
              type="date"
              value={reviewMonth}
              error={fieldErrors.reviewMonth}
              onBlur={() => setFieldErrors((current) => ({ ...current, reviewMonth: validateFirstDayOfMonth(reviewMonth, "Review month") }))}
              onChange={(event) => {
                setReviewMonth(event.target.value);
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
              Confirming this action asks the backend to calculate and persist the monthly review. The frontend does not
              distribute surplus itself.
            </div>
            <Button disabled={isSubmitting || isPreviewLoading} onClick={() => void handleSubmit()} type="button">
              {isSubmitting ? <LoadingSpinner inline size="sm" label="Applying review..." /> : "Apply Monthly Review"}
            </Button>
          </div>
        </Card>

        <Card title="Surplus Preview" subtitle="A read-only recommendation from the report endpoint before submission.">
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

      {submitError ? <ErrorState title="Failed to apply monthly review" message={submitError} /> : null}
      {result ? (
        <Card title="Review Applied" subtitle={`Review month ${result.reviewMonth}`}>
          <SuccessNotice
            title="Monthly review created"
            message="The backend returned the persisted distribution set below."
          />
          <div className="mt-4 grid gap-4 lg:grid-cols-[0.7fr,1fr]">
            <div className="rounded-2xl bg-stone-50 p-4">
              <p className="text-sm text-stone-500">Net surplus</p>
              <p className="mt-1 text-2xl font-semibold text-raf-ink">{formatCurrency(result.netSurplus)}</p>
              <div className="mt-3">
                <Badge tone={alertTone(result.alertStatus)}>{result.alertStatus}</Badge>
              </div>
            </div>
            <Table headers={["Distribution key", "Amount"]}>
              {Object.entries(result.distributions).map(([key, amount]) => (
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
