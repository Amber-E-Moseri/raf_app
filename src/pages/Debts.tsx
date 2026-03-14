import { useState } from "react";

import { createDebt, getDebts, updateDebt } from "../api/debtsApi";
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
import { formatCurrency, formatIsoDate, percentPaidOff } from "../lib/format";
import { normalizeMoneyInput, validateApr, validateNonNegativeMoney, validatePositiveMoney, validateRequiredText } from "../lib/validation";

function paymentStatusLabel(status?: string) {
  switch (status) {
    case "missed_payment":
      return "Missed payment";
    case "under_minimum":
      return "Under minimum";
    case "at_risk":
      return "At risk";
    case "paying_down":
      return "Paying down";
    case "paid_off":
      return "Paid off";
    default:
      return "Current";
  }
}

function paymentStatusTone(status?: string): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "paid_off":
    case "paying_down":
      return "success";
    case "under_minimum":
    case "at_risk":
      return "warning";
    case "missed_payment":
      return "danger";
    default:
      return "neutral";
  }
}

function payoffEstimateMessage(debt: { currentBalance: string; monthlyPayment: string; estimatedPayoffDate?: string | null; paymentStatus?: string }) {
  if (Number(debt.currentBalance) <= 0) {
    return "Debt has been paid off.";
  }

  if (Number(debt.monthlyPayment ?? "0") <= 0) {
    return "Add a planned payment to estimate payoff.";
  }

  if (!debt.estimatedPayoffDate && debt.paymentStatus === "at_risk") {
    return "Planned payment is too low to reduce principal.";
  }

  if (!debt.estimatedPayoffDate) {
    return "Payoff estimate is unavailable.";
  }

  return null;
}

function paymentTooLowWarning(balance: string, apr: string, monthlyPayment: string) {
  const balanceValue = Number(balance);
  const aprValue = Number(apr);
  const monthlyPaymentValue = Number(monthlyPayment);

  if (!Number.isFinite(balanceValue) || !Number.isFinite(aprValue) || !Number.isFinite(monthlyPaymentValue) || monthlyPaymentValue <= 0) {
    return null;
  }

  const monthlyInterest = balanceValue * (aprValue / 100 / 12);
  return monthlyPaymentValue <= monthlyInterest ? "Payment too low to reduce principal." : null;
}

export function Debts() {
  // Debt balances stay current-only for now; month switching does not backdate debt snapshots yet.
  const { data, error, isLoading, reload } = useAsyncData(() => getDebts(), []);
  const [form, setForm] = useState({
    name: "",
    startingBalance: "",
    apr: "",
    minimumPayment: "",
    monthlyPayment: "",
    statementDay: "",
    paymentDueDay: "",
    lateFeeAmount: "",
    autoPostInterest: false,
    autoPostLateFee: false,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    apr: "",
    minimumPayment: "",
    monthlyPayment: "",
    statementDay: "",
    paymentDueDay: "",
    lateFeeAmount: "",
    autoPostInterest: false,
    autoPostLateFee: false,
    isActive: true,
  });
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string | null>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, { month: boolean; payoff: boolean }>>({});

  function isSectionExpanded(debtId: string, section: "month" | "payoff") {
    return expandedSections[debtId]?.[section] ?? false;
  }

  function toggleSection(debtId: string, section: "month" | "payoff") {
    setExpandedSections((current) => ({
      ...current,
      [debtId]: {
        month: current[debtId]?.month ?? false,
        payoff: current[debtId]?.payoff ?? false,
        [section]: !(current[debtId]?.[section] ?? false),
      },
    }));
  }

  function openEditModal(debt: NonNullable<typeof data>["items"][number]) {
    setEditingDebtId(debt.id);
    setEditError(null);
    setEditFieldErrors({});
    setEditForm({
      name: debt.name,
      apr: String(debt.apr),
      minimumPayment: debt.minimumPayment,
      monthlyPayment: debt.monthlyPayment,
      statementDay: debt.statementDay ? String(debt.statementDay) : "",
      paymentDueDay: debt.paymentDueDay ? String(debt.paymentDueDay) : "",
      lateFeeAmount: debt.lateFeeAmount ?? "",
      autoPostInterest: debt.autoPostInterest === true,
      autoPostLateFee: debt.autoPostLateFee === true,
      isActive: debt.isActive !== false,
    });
  }

  function closeEditModal() {
    setEditingDebtId(null);
    setEditError(null);
    setEditFieldErrors({});
  }

  function validateEditForm() {
    const nextErrors = {
      name: validateRequiredText(editForm.name, "Debt name"),
      apr: validateApr(editForm.apr),
      minimumPayment: validateNonNegativeMoney(editForm.minimumPayment, "Minimum payment"),
      monthlyPayment: validateNonNegativeMoney(editForm.monthlyPayment, "Monthly payment"),
      statementDay: editForm.statementDay && !/^(?:[1-9]|1\d|2[0-8])$/.test(editForm.statementDay) ? "Statement day must be between 1 and 28." : null,
      paymentDueDay: editForm.paymentDueDay && !/^(?:[1-9]|[12]\d|3[01])$/.test(editForm.paymentDueDay) ? "Payment due day must be between 1 and 31." : null,
      lateFeeAmount: editForm.lateFeeAmount ? validateNonNegativeMoney(editForm.lateFeeAmount, "Late fee") : null,
    };

    setEditFieldErrors(nextErrors);
    return !Object.values(nextErrors).some(Boolean);
  }

  async function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDebtId || !validateEditForm()) {
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);

    try {
      await updateDebt(editingDebtId, {
        name: editForm.name.trim(),
        apr: editForm.apr.trim(),
        minimumPayment: normalizeMoneyInput(editForm.minimumPayment) ?? editForm.minimumPayment,
        monthlyPayment: normalizeMoneyInput(editForm.monthlyPayment) ?? editForm.monthlyPayment,
        statementDay: editForm.statementDay ? Number(editForm.statementDay) : undefined,
        paymentDueDay: editForm.paymentDueDay ? Number(editForm.paymentDueDay) : undefined,
        lateFeeAmount: editForm.lateFeeAmount ? (normalizeMoneyInput(editForm.lateFeeAmount) ?? editForm.lateFeeAmount) : undefined,
        autoPostInterest: editForm.autoPostInterest,
        autoPostLateFee: editForm.autoPostLateFee,
        isActive: editForm.isActive,
      });
      setSubmitSuccess("Debt updated.");
      await reload();
      closeEditModal();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Debt could not be updated.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  const editingDebt = data?.items.find((item) => item.id === editingDebtId) ?? null;
  const editPaymentPreviewWarning = editingDebt
    ? paymentTooLowWarning(editingDebt.currentBalance, editForm.apr, editForm.monthlyPayment)
    : null;

  function validateForm() {
    const nextErrors = {
      name: validateRequiredText(form.name, "Debt name"),
      startingBalance: validatePositiveMoney(form.startingBalance, "Starting balance"),
      apr: validateApr(form.apr),
      minimumPayment: validateNonNegativeMoney(form.minimumPayment, "Minimum payment"),
      monthlyPayment: validateNonNegativeMoney(form.monthlyPayment, "Monthly payment"),
      statementDay: form.statementDay && !/^(?:[1-9]|1\d|2[0-8])$/.test(form.statementDay) ? "Statement day must be between 1 and 28." : null,
      paymentDueDay: form.paymentDueDay && !/^(?:[1-9]|[12]\d|3[01])$/.test(form.paymentDueDay) ? "Payment due day must be between 1 and 31." : null,
      lateFeeAmount: form.lateFeeAmount ? validateNonNegativeMoney(form.lateFeeAmount, "Late fee") : null,
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
        statementDay: form.statementDay ? Number(form.statementDay) : undefined,
        paymentDueDay: form.paymentDueDay ? Number(form.paymentDueDay) : undefined,
        lateFeeAmount: form.lateFeeAmount ? (normalizeMoneyInput(form.lateFeeAmount) ?? form.lateFeeAmount) : undefined,
        autoPostInterest: form.autoPostInterest,
        autoPostLateFee: form.autoPostLateFee,
      });

      setSubmitSuccess("Debt account created.");
      setForm({
        name: "",
        startingBalance: "",
        apr: "",
        minimumPayment: "",
        monthlyPayment: "",
        statementDay: "",
        paymentDueDay: "",
        lateFeeAmount: "",
        autoPostInterest: false,
        autoPostLateFee: false,
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
            <div className="grid gap-4 md:grid-cols-3">
              <Input
                label="Statement day"
                name="statementDay"
                inputMode="numeric"
                placeholder="15"
                value={form.statementDay}
                error={fieldErrors.statementDay}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === "" || /^(?:[1-9]|1\d|2[0-8])$/.test(nextValue) || /^(?:[1-2]?\d)?$/.test(nextValue)) {
                    setForm((current) => ({ ...current, statementDay: nextValue }));
                    setFieldErrors((current) => ({ ...current, statementDay: null }));
                  }
                }}
              />
              <Input
                label="Payment due day"
                name="paymentDueDay"
                inputMode="numeric"
                placeholder="28"
                value={form.paymentDueDay}
                error={fieldErrors.paymentDueDay}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === "" || /^(?:[1-9]|[12]\d|3[01])$/.test(nextValue) || /^(?:[1-3]?\d)?$/.test(nextValue)) {
                    setForm((current) => ({ ...current, paymentDueDay: nextValue }));
                    setFieldErrors((current) => ({ ...current, paymentDueDay: null }));
                  }
                }}
              />
              <MoneyInput
                label="Late fee"
                name="lateFeeAmount"
                value={form.lateFeeAmount}
                error={fieldErrors.lateFeeAmount}
                disabled={isSubmitting}
                onBlur={() => setFieldErrors((current) => ({ ...current, lateFeeAmount: form.lateFeeAmount ? validateNonNegativeMoney(form.lateFeeAmount, "Late fee") : null }))}
                onChange={(value) => {
                  setForm((current) => ({ ...current, lateFeeAmount: value }));
                  setFieldErrors((current) => ({ ...current, lateFeeAmount: null }));
                }}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-strong)]">
                <input
                  type="checkbox"
                  checked={form.autoPostInterest}
                  onChange={(event) => setForm((current) => ({ ...current, autoPostInterest: event.target.checked }))}
                />
                Auto-post interest on statement cycle
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-strong)]">
                <input
                  type="checkbox"
                  checked={form.autoPostLateFee}
                  onChange={(event) => setForm((current) => ({ ...current, autoPostLateFee: event.target.checked }))}
                />
                Auto-post late fee on missed cycle
              </label>
            </div>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <LoadingSpinner inline size="sm" label="Saving debt..." /> : "Add Debt"}</Button>
          </form>
        </Card>

        <div className="space-y-4">
          {submitError ? <ErrorState title="Failed to add debt" message={submitError} /> : null}
          {submitSuccess ? <SuccessNotice title="Debt saved" message={submitSuccess} /> : null}
          <Card title="Form Guidance" subtitle="Debt balances stay derived server-side.">
            <ul className="space-y-2 text-sm text-[var(--text-muted)]">
              <li>Starting balance must be greater than zero.</li>
              <li>APR must be between 0 and 100 with up to two decimals.</li>
              <li>Payment fields accept non-negative decimals with two decimal places max.</li>
              <li>Statement day should stay between 1 and 28. Payment due day can be up to 31.</li>
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
              <p className="text-3xl font-semibold text-[var(--text-strong)]">{formatCurrency(data.summary.totalStarting)}</p>
            </Card>
            <Card title="Remaining balance" subtitle="Current backend-derived balance">
              <p className="text-3xl font-semibold text-[var(--text-strong)]">{formatCurrency(data.summary.totalRemaining)}</p>
            </Card>
            <Card title="Paid all time" subtitle="Historical payoff recorded by the backend">
              <p className="text-3xl font-semibold text-[var(--text-strong)]">{formatCurrency(data.summary.totalPaidAllTime)}</p>
            </Card>
          </section>

          {data.items.length ? (
            <section className="grid gap-4 xl:grid-cols-2">
              {data.items.map((debt) => {
                const completion = percentPaidOff(debt.startingBalance, debt.currentBalance) ?? 0;
                const estimateMessage = payoffEstimateMessage(debt);

                return (
                  <Card key={debt.id} title={debt.name} subtitle={`APR ${debt.apr}%`}>
                    <div className="space-y-4">
                      <div className="flex justify-end">
                        <Badge tone={debt.status === "paid_off" ? "success" : "neutral"}>{debt.status === "paid_off" ? "Paid off" : "Open"}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-[var(--text-muted)]">Current balance</p>
                          <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.currentBalance)}</p>
                        </div>
                        <div>
                          <p className="text-[var(--text-muted)]">Opening this month</p>
                          <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.openingBalance ?? debt.currentBalance)}</p>
                        </div>
                        <div>
                          <p className="text-[var(--text-muted)]">Minimum payment</p>
                          <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.minimumPayment)}</p>
                        </div>
                        <div>
                          <p className="text-[var(--text-muted)]">Planned payment</p>
                          <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.monthlyPayment)}</p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface-elevated)]">
                        <button
                          type="button"
                          onClick={() => toggleSection(debt.id, "month")}
                          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
                        >
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">This month</p>
                            <p className="mt-1 text-sm text-[var(--text-muted)]">Actual debt activity from linked payments and posted charges.</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge tone={paymentStatusTone(debt.paymentStatus)}>{paymentStatusLabel(debt.paymentStatus)}</Badge>
                            <span className="text-sm text-[var(--text-muted)]">{isSectionExpanded(debt.id, "month") ? "Hide" : "Show"}</span>
                          </div>
                        </button>
                        {isSectionExpanded(debt.id, "month") ? (
                          <div className="border-t border-[var(--border-color)] px-4 py-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-[var(--text-muted)]">Payments this month</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.paymentsThisMonth ?? "0.00")}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Interest charged</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.interestChargedThisMonth ?? "0.00")}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Fees this month</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.feesThisMonth ?? "0.00")}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Principal reduction</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.principalReductionThisMonth ?? "0.00")}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Next statement</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">{debt.nextStatementDate ? formatIsoDate(debt.nextStatementDate) : "—"}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Next payment due</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">{debt.nextPaymentDueDate ? formatIsoDate(debt.nextPaymentDueDate) : "Set payment due day"}</p>
                              </div>
                            </div>
                            {debt.paymentStatus === "missed_payment" ? (
                              <p className="mt-3 text-sm text-[var(--text-muted)]">No payment recorded this month.</p>
                            ) : null}
                            {debt.paymentStatus === "under_minimum" ? (
                              <p className="mt-3 text-sm text-[var(--text-muted)]">Payment is below the minimum payment.</p>
                            ) : null}
                            {debt.paymentStatus === "at_risk" ? (
                              <p className="mt-3 text-sm text-[var(--text-muted)]">Payment is too low to meaningfully reduce principal.</p>
                            ) : null}
                            {debt.autoPostInterest && Number(debt.interestChargedThisMonth ?? "0") === 0 ? (
                              <p className="mt-3 text-sm text-[var(--text-muted)]">Interest will post on the next statement cycle.</p>
                            ) : null}
                            {Number(debt.feesThisMonth ?? "0") > 0 ? (
                              <p className="mt-3 text-sm text-[var(--text-muted)]">Late fee applied due to missed payment.</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface-elevated)]">
                        <button
                          type="button"
                          onClick={() => toggleSection(debt.id, "payoff")}
                          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
                        >
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Planned payoff</p>
                            <p className="mt-1 text-sm text-[var(--text-muted)]">Forecast based on the planned monthly payment, separate from actual month activity.</p>
                          </div>
                          <span className="text-sm text-[var(--text-muted)]">{isSectionExpanded(debt.id, "payoff") ? "Hide" : "Show"}</span>
                        </button>
                        {isSectionExpanded(debt.id, "payoff") ? (
                          <div className="border-t border-[var(--border-color)] px-4 py-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-[var(--text-muted)]">Planned monthly payment</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.monthlyPayment)}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Estimated payoff</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">
                                  {debt.estimatedPayoffDate ? formatIsoDate(debt.estimatedPayoffDate) : "—"}
                                </p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Months remaining</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">
                                  {debt.monthsRemaining == null ? "—" : debt.monthsRemaining}
                                </p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Interest remaining</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">
                                  {debt.totalInterestRemaining == null ? "—" : formatCurrency(debt.totalInterestRemaining)}
                                </p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Starting balance</p>
                                <p className="mt-1 font-semibold text-[var(--text-strong)]">{formatCurrency(debt.startingBalance)}</p>
                              </div>
                            </div>
                            {estimateMessage ? (
                              <p className="mt-3 text-sm text-[var(--text-muted)]">{estimateMessage}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--text-muted)]">Paid off</span>
                          <span className="font-semibold text-[var(--text-strong)]">{completion.toFixed(0)}%</span>
                        </div>
                        <div className="progress-track h-3 overflow-hidden rounded-full">
                          <div className="h-full rounded-full bg-raf-moss transition-all" style={{ width: `${completion}%` }} />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => openEditModal(debt)}
                          className="rounded-full border border-[var(--border-color)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-strong)] transition hover:bg-[var(--surface-color)]"
                        >
                          Edit debt
                        </button>
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

      {editingDebtId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-8">
          <div className="w-full max-w-3xl rounded-[28px] border border-[var(--border-color)] bg-[var(--surface-color)] shadow-2xl">
            <div className="flex items-start justify-between gap-4 px-6 pt-6">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Debt settings</p>
                <h2 className="mt-2 text-2xl font-semibold text-[var(--text-strong)]">Edit debt</h2>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-full border border-[var(--border-color)] px-3 py-1 text-sm text-[var(--text-muted)] transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-strong)]"
              >
                X
              </button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-6">
                <section className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-strong)]">Debt Basics</h3>
                    <p className="mt-1 text-sm italic text-[var(--text-muted)]">These fields describe the debt itself.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Input
                      label="Debt name"
                      name="editDebtName"
                      value={editForm.name}
                      error={editFieldErrors.name}
                      onChange={(event) => {
                        setEditForm((current) => ({ ...current, name: event.target.value }));
                        setEditFieldErrors((current) => ({ ...current, name: null }));
                      }}
                    />
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium tracking-[0.01em] text-[var(--text-strong)]">Current balance</span>
                      <div className="ui-field flex items-center bg-[var(--surface-elevated)] text-[var(--text-strong)]">{editingDebt ? formatCurrency(editingDebt.currentBalance) : "—"}</div>
                    </label>
                    <div>
                      <Input
                        label="APR"
                        name="editDebtApr"
                        inputMode="decimal"
                        value={editForm.apr}
                        error={editFieldErrors.apr}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue === "" || /^(?:0|[1-9]\d*)(?:\.\d{0,2})?$/.test(nextValue)) {
                            setEditForm((current) => ({ ...current, apr: nextValue }));
                            setEditFieldErrors((current) => ({ ...current, apr: null }));
                          }
                        }}
                      />
                      <p className="mt-2 text-sm italic text-[var(--text-muted)]">Annual interest rate used to calculate monthly interest.</p>
                    </div>
                  </div>
                </section>

                <section className="space-y-4 border-t border-[var(--border-color)] pt-6">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-strong)]">Payment Plan</h3>
                    <p className="mt-1 text-sm italic text-[var(--text-muted)]">These fields power the payoff projection.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <MoneyInput
                        label="Minimum payment"
                        name="editMinimumPayment"
                        value={editForm.minimumPayment}
                        error={editFieldErrors.minimumPayment}
                        disabled={isSavingEdit}
                        onChange={(value) => {
                          setEditForm((current) => ({ ...current, minimumPayment: value }));
                          setEditFieldErrors((current) => ({ ...current, minimumPayment: null }));
                        }}
                      />
                      <p className="mt-2 text-sm italic text-[var(--text-muted)]">Required payment to keep the account current.</p>
                    </div>
                    <div>
                      <MoneyInput
                        label="Planned monthly payment"
                        name="editMonthlyPayment"
                        value={editForm.monthlyPayment}
                        error={editFieldErrors.monthlyPayment}
                        disabled={isSavingEdit}
                        onChange={(value) => {
                          setEditForm((current) => ({ ...current, monthlyPayment: value }));
                          setEditFieldErrors((current) => ({ ...current, monthlyPayment: null }));
                        }}
                      />
                      <p className="mt-2 text-sm italic text-[var(--text-muted)]">Amount you plan to pay each month. Used for payoff projections.</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface-elevated)] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Estimated payoff preview</p>
                    <p className="mt-2 text-sm text-[var(--text-strong)]">
                      {editPaymentPreviewWarning ?? (editingDebt?.estimatedPayoffDate ? `Projected payoff by ${formatIsoDate(editingDebt.estimatedPayoffDate)}.` : "Projection updates when the debt is saved.")}
                    </p>
                  </div>
                </section>

                <section className="space-y-4 border-t border-[var(--border-color)] pt-6">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-strong)]">Statement Cycle</h3>
                    <p className="mt-1 text-sm italic text-[var(--text-muted)]">These fields power automatic interest and fee posting.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <Input
                        label="Statement day"
                        name="editStatementDay"
                        inputMode="numeric"
                        value={editForm.statementDay}
                        error={editFieldErrors.statementDay}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue === "" || /^(?:[1-9]|1\d|2[0-8])$/.test(nextValue) || /^(?:[1-2]?\d)?$/.test(nextValue)) {
                            setEditForm((current) => ({ ...current, statementDay: nextValue }));
                            setEditFieldErrors((current) => ({ ...current, statementDay: null }));
                          }
                        }}
                      />
                      <p className="mt-2 text-sm italic text-[var(--text-muted)]">Day of the month when interest is posted.</p>
                    </div>
                    <div>
                      <Input
                        label="Payment due day"
                        name="editPaymentDueDay"
                        inputMode="numeric"
                        value={editForm.paymentDueDay}
                        error={editFieldErrors.paymentDueDay}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          if (nextValue === "" || /^(?:[1-9]|[12]\d|3[01])$/.test(nextValue) || /^(?:[1-3]?\d)?$/.test(nextValue)) {
                            setEditForm((current) => ({ ...current, paymentDueDay: nextValue }));
                            setEditFieldErrors((current) => ({ ...current, paymentDueDay: null }));
                          }
                        }}
                      />
                      <p className="mt-2 text-sm italic text-[var(--text-muted)]">Day payment must be received to avoid late fees.</p>
                    </div>
                    <MoneyInput
                      label="Late fee"
                      name="editLateFee"
                      value={editForm.lateFeeAmount}
                      error={editFieldErrors.lateFeeAmount}
                      disabled={isSavingEdit}
                      onChange={(value) => {
                        setEditForm((current) => ({ ...current, lateFeeAmount: value }));
                        setEditFieldErrors((current) => ({ ...current, lateFeeAmount: null }));
                      }}
                    />
                  </div>
                </section>

                <section className="space-y-4 border-t border-[var(--border-color)] pt-6">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--text-strong)]">Automation</h3>
                    <p className="mt-1 text-sm italic text-[var(--text-muted)]">Automation settings control how RAF posts cycle activity.</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-strong)]">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={editForm.autoPostInterest}
                          onChange={(event) => setEditForm((current) => ({ ...current, autoPostInterest: event.target.checked }))}
                        />
                        Auto-post interest
                      </span>
                      <span className="mt-2 block text-sm italic text-[var(--text-muted)]">Automatically add monthly interest on the statement day.</span>
                    </label>
                    <label className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-strong)]">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={editForm.autoPostLateFee}
                          onChange={(event) => setEditForm((current) => ({ ...current, autoPostLateFee: event.target.checked }))}
                        />
                        Auto-post late fee
                      </span>
                      <span className="mt-2 block text-sm italic text-[var(--text-muted)]">Apply a late fee when the payment due date passes without sufficient payment.</span>
                    </label>
                    <label className="rounded-2xl border border-[var(--border-color)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-strong)]">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={editForm.isActive}
                          onChange={(event) => setEditForm((current) => ({ ...current, isActive: event.target.checked }))}
                        />
                        Active debt
                      </span>
                    </label>
                  </div>
                </section>
                {editError ? <ErrorState title="Failed to update debt" message={editError} /> : null}
              </div>
              <div className="sticky bottom-0 flex justify-end gap-3 rounded-b-[28px] border-t border-[var(--border-color)] bg-[var(--surface-color)] px-6 py-4">
                <Button type="button" variant="ghost" onClick={closeEditModal}>Cancel</Button>
                <Button type="submit" disabled={isSavingEdit}>{isSavingEdit ? <LoadingSpinner inline size="sm" label="Saving debt..." /> : "Save Debt"}</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}


