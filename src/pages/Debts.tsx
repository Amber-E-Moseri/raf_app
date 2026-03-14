import { useState } from "react";

import { createDebt, getDebts } from "../api/debtsApi";
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
import { MoneyInput } from "../components/ui/MoneyInput";
import { useAsyncData } from "../hooks/useAsyncData";
import { formatCurrency, percentPaidOff } from "../lib/format";
import { normalizeMoneyInput, validateApr, validateNonNegativeMoney, validatePositiveMoney, validateRequiredText } from "../lib/validation";

export function Debts() {
  // Debt balances stay current-only for now; month switching does not backdate debt snapshots yet.
  const { data, error, isLoading, reload } = useAsyncData(() => getDebts(), []);
  const [form, setForm] = useState({
    name: "",
    startingBalance: "",
    apr: "",
    minimumPayment: "",
    monthlyPayment: "",
    sortOrder: "0",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validateForm() {
    const nextErrors = {
      name: validateRequiredText(form.name, "Debt name"),
      startingBalance: validatePositiveMoney(form.startingBalance, "Starting balance"),
      apr: validateApr(form.apr),
      minimumPayment: validateNonNegativeMoney(form.minimumPayment, "Minimum payment"),
      monthlyPayment: validateNonNegativeMoney(form.monthlyPayment, "Monthly payment"),
    };

    setFieldErrors(nextErrors);
    return !Object.values(nextErrors).some(Boolean);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateForm()) {
      setSubmitError(null);
      setSubmitSuccess(null);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await createDebt({
        name: form.name.trim(),
        startingBalance: normalizeMoneyInput(form.startingBalance) ?? form.startingBalance,
        apr: form.apr.trim(),
        minimumPayment: normalizeMoneyInput(form.minimumPayment) ?? form.minimumPayment,
        monthlyPayment: normalizeMoneyInput(form.monthlyPayment) ?? form.monthlyPayment,
        sortOrder: Number(form.sortOrder || "0"),
      });

      setSubmitSuccess("Debt account created.");
      setForm({
        name: "",
        startingBalance: "",
        apr: "",
        minimumPayment: "",
        monthlyPayment: "",
        sortOrder: "0",
      });
      setFieldErrors({});
      await reload();
    } catch (createError) {
      setSubmitSuccess(null);
      setSubmitError(createError instanceof Error ? createError.message : "Debt could not be created.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PageShell
      eyebrow="Liabilities"
      title="Debts"
      description="Current balances come straight from the backend. The client only renders what the API provides."
    >
      <section className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
        <Card title="Add Debt" subtitle="Client-side validation checks format only and leaves derived balances to the backend.">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              label="Debt name"
              name="name"
              value={form.name}
              error={fieldErrors.name}
              onBlur={() => setFieldErrors((current) => ({ ...current, name: validateRequiredText(form.name, "Debt name") }))}
              onChange={(event) => {
                setForm((current) => ({ ...current, name: event.target.value }));
                setFieldErrors((current) => ({ ...current, name: null }));
              }}
            />
            <MoneyInput
              label="Starting balance"
              name="startingBalance"
              value={form.startingBalance}
              error={fieldErrors.startingBalance}
              disabled={isSubmitting}
              onBlur={() => setFieldErrors((current) => ({ ...current, startingBalance: validatePositiveMoney(form.startingBalance, "Starting balance") }))}
              onChange={(value) => {
                setForm((current) => ({ ...current, startingBalance: value }));
                setFieldErrors((current) => ({ ...current, startingBalance: null }));
              }}
            />
            <Input
              label="APR"
              name="apr"
              inputMode="decimal"
              placeholder="19.99"
              value={form.apr}
              error={fieldErrors.apr}
              onBlur={() => setFieldErrors((current) => ({ ...current, apr: validateApr(form.apr) }))}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === "" || /^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/.test(nextValue)) {
                  setForm((current) => ({ ...current, apr: nextValue }));
                  setFieldErrors((current) => ({ ...current, apr: null }));
                }
              }}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <MoneyInput
                label="Minimum payment"
                name="minimumPayment"
                value={form.minimumPayment}
                error={fieldErrors.minimumPayment}
                disabled={isSubmitting}
                onBlur={() => setFieldErrors((current) => ({ ...current, minimumPayment: validateNonNegativeMoney(form.minimumPayment, "Minimum payment") }))}
                onChange={(value) => {
                  setForm((current) => ({ ...current, minimumPayment: value }));
                  setFieldErrors((current) => ({ ...current, minimumPayment: null }));
                }}
              />
              <MoneyInput
                label="Monthly payment"
                name="monthlyPayment"
                value={form.monthlyPayment}
                error={fieldErrors.monthlyPayment}
                disabled={isSubmitting}
                onBlur={() => setFieldErrors((current) => ({ ...current, monthlyPayment: validateNonNegativeMoney(form.monthlyPayment, "Monthly payment") }))}
                onChange={(value) => {
                  setForm((current) => ({ ...current, monthlyPayment: value }));
                  setFieldErrors((current) => ({ ...current, monthlyPayment: null }));
                }}
              />
            </div>
            <Input
              label="Sort order"
              name="sortOrder"
              inputMode="numeric"
              value={form.sortOrder}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === "" || /^\d+$/.test(nextValue)) {
                  setForm((current) => ({ ...current, sortOrder: nextValue }));
                }
              }}
            />
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <LoadingSpinner inline size="sm" label="Saving debt..." /> : "Add Debt"}</Button>
          </form>
        </Card>

        <div className="space-y-4">
          {submitError ? <ErrorState title="Failed to add debt" message={submitError} /> : null}
          {submitSuccess ? <SuccessNotice title="Debt saved" message={submitSuccess} /> : null}
          <Card title="Form Guidance" subtitle="Debt balances stay derived server-side.">
            <ul className="space-y-2 text-sm text-stone-600">
              <li>Starting balance must be greater than zero.</li>
              <li>APR must be between 0 and 100 with up to two decimals.</li>
              <li>Payment fields accept non-negative decimals with two decimal places max.</li>
            </ul>
          </Card>
        </div>
      </section>

      {isLoading ? <LoadingState label="Loading debt accounts..." /> : null}
      {!isLoading && error ? <ErrorState title="Failed to fetch debts" message={error} onRetry={() => void reload()} /> : null}
      {!isLoading && !error && data ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card title="Total starting" subtitle="Original starting balances">
              <p className="text-3xl font-semibold text-raf-ink">{formatCurrency(data.summary.totalStarting)}</p>
            </Card>
            <Card title="Remaining balance" subtitle="Current backend-derived balance">
              <p className="text-3xl font-semibold text-raf-ink">{formatCurrency(data.summary.totalRemaining)}</p>
            </Card>
            <Card title="Paid all time" subtitle="Historical payoff recorded by the backend">
              <p className="text-3xl font-semibold text-raf-ink">{formatCurrency(data.summary.totalPaidAllTime)}</p>
            </Card>
          </section>

          {data.items.length ? (
            <section className="grid gap-4 xl:grid-cols-2">
              {data.items.map((debt) => {
                const completion = percentPaidOff(debt.startingBalance, debt.currentBalance) ?? 0;

                return (
                  <Card key={debt.id} title={debt.name} subtitle={`APR ${debt.apr}%`}>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-stone-500">Starting balance</p>
                          <p className="mt-1 font-semibold text-raf-ink">{formatCurrency(debt.startingBalance)}</p>
                        </div>
                        <div>
                          <p className="text-stone-500">Current balance</p>
                          <p className="mt-1 font-semibold text-raf-ink">{formatCurrency(debt.currentBalance)}</p>
                        </div>
                        <div>
                          <p className="text-stone-500">Monthly payment</p>
                          <p className="mt-1 font-semibold text-raf-ink">{formatCurrency(debt.monthlyPayment)}</p>
                        </div>
                        <div>
                          <p className="text-stone-500">Minimum payment</p>
                          <p className="mt-1 font-semibold text-raf-ink">{formatCurrency(debt.minimumPayment)}</p>
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                          <span className="text-stone-500">Paid off</span>
                          <span className="font-semibold text-raf-ink">{completion.toFixed(0)}%</span>
                        </div>
                        <div className="progress-track h-3 overflow-hidden rounded-full">
                          <div className="h-full rounded-full bg-raf-moss transition-all" style={{ width: `${completion}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-stone-500">Status</span>
                        <Badge tone={debt.status === "active" ? "success" : "neutral"}>{debt.status}</Badge>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </section>
          ) : (
            <EmptyState
              title="No debts configured"
              message="Debt accounts will appear here when the backend has active debt records to report."
            />
          )}
        </>
      ) : null}
    </PageShell>
  );
}
