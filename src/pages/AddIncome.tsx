import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { ApiError } from "../api/client";
import { createIncome } from "../api/incomeApi";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingSpinner } from "../components/feedback/LoadingSpinner";
import { LoadingState } from "../components/feedback/LoadingState";
import { SuccessNotice } from "../components/feedback/SuccessNotice";
import { PageShell } from "../components/layout/PageShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { MoneyInput } from "../components/ui/MoneyInput";
import { Table } from "../components/ui/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { formatCurrency, formatIsoDate } from "../lib/format";
import { normalizeMoneyInput, validateIsoDate, validatePositiveMoney, validateRequiredText } from "../lib/validation";
import type { AllocationCategory, IncomeCreateResponse } from "../lib/types";

const initialForm = {
  sourceName: "",
  amount: "",
  receivedDate: "",
  notes: "",
};

export function AddIncome() {
  const [form, setForm] = useState(initialForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<IncomeCreateResponse | null>(null);
  const { data: categories, error: categoriesError, isLoading: categoriesLoading, reload: reloadCategories } = useAsyncData<AllocationCategory[]>(async () => {
    try {
      return await getAllocationCategories();
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 404) {
        return [];
      }

      throw loadError;
    }
  }, []);

  function validateForm() {
    const nextErrors = {
      sourceName: validateRequiredText(form.sourceName, "Source name"),
      amount: validatePositiveMoney(form.amount, "Amount"),
      receivedDate: validateIsoDate(form.receivedDate, "Received date"),
    };

    setFieldErrors(nextErrors);
    return !Object.values(nextErrors).some(Boolean);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateForm()) {
      setError(null);
      setSuccess(null);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const normalizedAmount = normalizeMoneyInput(form.amount);
      const response = await createIncome(
        {
          sourceName: form.sourceName.trim(),
          amount: normalizedAmount ?? form.amount,
          receivedDate: form.receivedDate,
          notes: form.notes.trim() || undefined,
        },
        crypto.randomUUID(),
      );

      setSuccess(response);
      setForm(initialForm);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Income could not be created.");
      setSuccess(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <PageShell
      eyebrow="Income"
      title="Add Income"
      description="Record a new deposit and let the backend return the allocation split it actually created."
      actions={<Link className="text-sm font-semibold text-raf-moss" to="/dashboard">Back to Dashboard</Link>}
    >
      <section className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <Card title="New Deposit" subtitle="Required fields match the backend contract.">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <Input
              label="Source name"
              name="sourceName"
              placeholder="Payroll"
              required
              error={fieldErrors.sourceName}
              value={form.sourceName}
              onBlur={() => setFieldErrors((current) => ({ ...current, sourceName: validateRequiredText(form.sourceName, "Source name") }))}
              onChange={(event) => {
                setForm((current) => ({ ...current, sourceName: event.target.value }));
                setFieldErrors((current) => ({ ...current, sourceName: null }));
              }}
            />
            <MoneyInput
              label="Amount"
              name="amount"
              placeholder="5000.00"
              error={fieldErrors.amount}
              disabled={isSubmitting}
              value={form.amount}
              onBlur={() => setFieldErrors((current) => ({ ...current, amount: validatePositiveMoney(form.amount, "Amount") }))}
              onChange={(value) => {
                setForm((current) => ({ ...current, amount: value }));
                setFieldErrors((current) => ({ ...current, amount: null }));
              }}
            />
            <Input
              label="Received date"
              name="receivedDate"
              type="date"
              required
              error={fieldErrors.receivedDate}
              value={form.receivedDate}
              onBlur={() => setFieldErrors((current) => ({ ...current, receivedDate: validateIsoDate(form.receivedDate, "Received date") }))}
              onChange={(event) => {
                setForm((current) => ({ ...current, receivedDate: event.target.value }));
                setFieldErrors((current) => ({ ...current, receivedDate: null }));
              }}
            />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-raf-ink">Notes</span>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition placeholder:text-stone-400 focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                name="notes"
                placeholder="Optional context for this deposit"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? <LoadingSpinner inline size="sm" label="Recording deposit..." /> : "Create income"}
              </Button>
              <Button
                disabled={isSubmitting}
                type="button"
                variant="secondary"
                onClick={() => {
                  setForm(initialForm);
                  setError(null);
                  setSuccess(null);
                }}
              >
                Reset
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          <Card title="Current Allocation Preferences" subtitle="Loaded from the allocation category API when available.">
            {categoriesLoading ? <LoadingState label="Loading allocation preferences..." /> : null}
            {!categoriesLoading && categoriesError ? <ErrorState title="Failed to load allocation preferences" message={categoriesError} onRetry={() => void reloadCategories()} /> : null}
            {!categoriesLoading && !categoriesError && categories?.length ? (
              <Table headers={["Category", "Percentage", "Status"]}>
                {categories.map((category) => (
                  <tr key={category.id}>
                    <td className="px-4 py-3 text-sm font-medium text-raf-ink">{category.label}</td>
                    <td className="px-4 py-3 text-sm text-stone-600">{(Number(category.allocationPercent) * 100).toFixed(2)}%</td>
                    <td className="px-4 py-3 text-sm text-stone-600">{category.isActive ? "Active" : "Inactive"}</td>
                  </tr>
                ))}
              </Table>
            ) : null}
            {!categoriesLoading && !categoriesError && !categories?.length ? (
              <EmptyState
                title="Preferences endpoint unavailable"
                message="This runtime does not currently expose allocation category routes, so the backend is still the only source of truth for configured allocation percentages."
              />
            ) : null}
          </Card>
          {error ? <ErrorState title="Failed to record income" message={error} /> : null}
          {success ? (
            <Card title="Deposit Recorded" subtitle={`Income ID: ${success.incomeId}`}>
              <SuccessNotice
                title="Backend accepted the deposit"
                message="The allocation breakdown below is the persisted split returned by the API."
              />
              <div className="mt-4">
                <Table headers={["Category", "Allocated amount"]}>
                  {success.allocations.map((allocation) => (
                    <tr key={allocation.slug}>
                      <td className="px-4 py-3 text-sm font-medium text-raf-ink">{allocation.category}</td>
                      <td className="px-4 py-3 text-sm text-stone-600">{formatCurrency(allocation.amount)}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </Card>
          ) : (
            <Card title="What happens next" subtitle="The frontend does not compute any splits itself.">
              <ul className="space-y-3 text-sm text-stone-600">
                <li>The backend validates the payload and records the deposit.</li>
                <li>Allocation rows are created server-side using deterministic rounding.</li>
                <li>The response comes back with the real allocation snapshot for this deposit.</li>
                <li>Use today&apos;s date in ISO format, for example {formatIsoDate(new Date().toISOString())}.</li>
              </ul>
            </Card>
          )}
        </div>
      </section>
    </PageShell>
  );
}
