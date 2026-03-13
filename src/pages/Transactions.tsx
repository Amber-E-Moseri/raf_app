import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { ApiError } from "../api/client";
import { getDebts } from "../api/debtsApi";
import { getImportedTransactions, ignoreImportedTransaction, importBankStatement } from "../api/importsApi";
import { createTransaction, getTransactions } from "../api/transactionsApi";
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
import { Table } from "../components/ui/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { DEFAULT_PAGE_SIZE } from "../lib/constants";
import { formatCurrency, formatIsoDate, monthRange } from "../lib/format";
import { normalizeMoneyInput, validateIsoDate, validatePositiveMoney, validateRequiredText } from "../lib/validation";
import type { AllocationCategory, Debt, ImportedTransaction, Transaction, TransactionListResponse } from "../lib/types";

interface TransactionsViewModel {
  transactions: TransactionListResponse;
  debts: Debt[];
  categories: AllocationCategory[];
  imports: ImportedTransaction[];
}

type SortKey = "transactionDate" | "description" | "category" | "amount" | "direction";
type SortDirection = "asc" | "desc";

function directionTone(direction: "debit" | "credit") {
  return direction === "credit" ? "success" : "warning";
}

function amountClassName(direction: "debit" | "credit") {
  return direction === "credit" ? "text-emerald-700" : "text-rose-700";
}

function categoryTone(label: string) {
  const tones: Array<"neutral" | "success" | "warning" | "danger"> = ["neutral", "success", "warning", "danger"];
  const hash = [...label].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[hash % tones.length];
}

function importedStatusTone(status: string) {
  if (status === "unreviewed") {
    return "warning";
  }

  if (status === "classified") {
    return "success";
  }

  if (status === "ignored") {
    return "neutral";
  }

  return "neutral";
}

function sortIndicator(active: boolean, direction: SortDirection) {
  if (!active) {
    return "Sort";
  }

  return direction === "asc" ? "Asc" : "Desc";
}

function compareValues(left: string | number, right: string | number, direction: SortDirection) {
  const normalized = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right));

  return direction === "asc" ? normalized : -normalized;
}

export function Transactions() {
  const { from: initialFrom, to: initialTo } = useMemo(() => monthRange(), []);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [fromDate, setFromDate] = useState(initialFrom);
  const [toDate, setToDate] = useState(initialTo);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("transactionDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [form, setForm] = useState({
    transactionDate: initialTo,
    description: "",
    merchant: "",
    amount: "",
    direction: "debit" as "debit" | "credit",
    categoryId: "",
    linkedDebtId: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportsExpanded, setIsImportsExpanded] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const [reviewPendingId, setReviewPendingId] = useState<string | null>(null);
  const cursor = cursorHistory[cursorHistory.length - 1];

  const { data, error, isLoading, reload } = useAsyncData<TransactionsViewModel>(async () => {
    const [transactions, debts, imports] = await Promise.all([
      getTransactions({
        from: fromDate,
        to: toDate,
        categoryId: categoryFilter || undefined,
        cursor: cursor ?? undefined,
        limit: DEFAULT_PAGE_SIZE,
      }),
      getDebts(),
      getImportedTransactions(),
    ]);

    let categories: AllocationCategory[] = [];

    try {
      categories = await getAllocationCategories();
    } catch (loadError) {
      if (!(loadError instanceof ApiError) || loadError.status !== 404) {
        throw loadError;
      }
    }

    return {
      transactions,
      debts: debts.items,
      categories,
      imports: imports.items,
    };
  }, [categoryFilter, cursor, fromDate, toDate]);

  const debtLookup = new Map(data?.debts.map((debt) => [debt.id, debt.name]) ?? []);
  const categoryLookup = new Map(data?.categories.map((category) => [category.id, category.label]) ?? []);

  const visibleTransactions = useMemo(() => {
    const filtered = (data?.transactions.items ?? []).filter((transaction) => (
      transaction.description.toLowerCase().includes(searchTerm.trim().toLowerCase())
    ));

    return [...filtered].sort((left, right) => {
      if (sortKey === "amount") {
        return compareValues(Number(left.amount), Number(right.amount), sortDirection);
      }

      if (sortKey === "category") {
        const leftCategory = left.categoryId ? categoryLookup.get(left.categoryId) ?? left.categoryId : "Unassigned";
        const rightCategory = right.categoryId ? categoryLookup.get(right.categoryId) ?? right.categoryId : "Unassigned";
        return compareValues(leftCategory, rightCategory, sortDirection);
      }

      return compareValues(left[sortKey], right[sortKey], sortDirection);
    });
  }, [categoryLookup, data?.transactions.items, searchTerm, sortDirection, sortKey]);

  const importsSummary = useMemo(() => {
    const imports = data?.imports ?? [];
    const unreviewed = imports.filter((item) => item.status === "unreviewed").length;
    const dates = imports.map((item) => item.date).filter(Boolean).sort();

    return {
      total: imports.length,
      unreviewed,
      earliestDate: dates[0] ?? null,
      latestDate: dates.at(-1) ?? null,
    };
  }, [data?.imports]);

  function setSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(nextKey);
    setSortDirection("asc");
  }

  function sortableHeader(label: string, key: SortKey): ReactNode {
    const active = sortKey === key;

    return (
      <button
        type="button"
        className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${active ? "text-raf-ink" : "text-stone-500"}`}
        onClick={() => setSort(key)}
      >
        <span>{label}</span>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] normal-case">{sortIndicator(active, sortDirection)}</span>
      </button>
    );
  }

  function validateForm() {
    const nextErrors: Record<string, string | null> = {
      transactionDate: validateIsoDate(form.transactionDate, "Transaction date"),
      description: validateRequiredText(form.description, "Description"),
      amount: validatePositiveMoney(form.amount, "Amount"),
      linkedDebtId: null,
    };

    if (form.linkedDebtId && form.direction !== "debit") {
      nextErrors.linkedDebtId = "Linked debt requires a debit transaction";
    }

    setFieldErrors(nextErrors);
    return !Object.values(nextErrors).some(Boolean);
  }

  async function handleCreateTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateForm()) {
      setSubmitError(null);
      setSubmitSuccess(null);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await createTransaction({
        transactionDate: form.transactionDate,
        description: form.description.trim(),
        merchant: form.merchant.trim() || null,
        amount: normalizeMoneyInput(form.amount) ?? form.amount,
        direction: form.direction,
        categoryId: form.categoryId || null,
        linkedDebtId: form.linkedDebtId || null,
      });

      setSubmitSuccess("Transaction created.");
      setForm({
        transactionDate: toDate,
        description: "",
        merchant: "",
        amount: "",
        direction: "debit",
        categoryId: "",
        linkedDebtId: "",
      });
      setFieldErrors({});
      await reload();
    } catch (requestError) {
      setSubmitSuccess(null);
      setSubmitError(requestError instanceof Error ? requestError.message : "Transaction could not be created.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleImportUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedImportFile) {
      setImportError("Select a PDF statement before uploading.");
      setImportSuccess(null);
      return;
    }

    if (selectedImportFile.type !== "application/pdf" && !selectedImportFile.name.toLowerCase().endsWith(".pdf")) {
      setImportError("Only PDF bank statements are supported.");
      setImportSuccess(null);
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const result = await importBankStatement(selectedImportFile);
      setImportSuccess(`Imported ${result.extracted} row${result.extracted === 1 ? "" : "s"} for review.`);
      setSelectedImportFile(null);
      setIsImportsExpanded(true);
      await reload();
    } catch (requestError) {
      setImportError(requestError instanceof Error ? requestError.message : "Bank statement import failed.");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleIgnoreImportedRow(importId: string) {
    setReviewPendingId(importId);
    setReviewError(null);
    setReviewSuccess(null);

    try {
      await ignoreImportedTransaction(importId, "Reviewed in Transactions");
      setReviewSuccess("Imported row marked ignored.");
      await reload();
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : "Imported row review failed.");
    } finally {
      setReviewPendingId(null);
    }
  }

  return (
    <PageShell
      eyebrow="Ledger"
      title="Transactions"
      description="Search, sort, and filter the transaction ledger while keeping cursor pagination intact."
      actions={
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={cursorHistory.length <= 1 || isLoading}
            onClick={() => setCursorHistory((history) => history.slice(0, -1))}
          >
            Previous
          </Button>
          <Button
            type="button"
            disabled={isLoading || !data?.transactions.nextCursor}
            onClick={() => {
              if (data?.transactions.nextCursor) {
                setCursorHistory((history) => [...history, data.transactions.nextCursor]);
              }
            }}
          >
            Next
          </Button>
        </div>
      }
    >
      <section className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
        <Card title="Create Transaction" subtitle="Format checks only. Ledger rules remain backend-owned.">
          <form className="space-y-4" onSubmit={handleCreateTransaction}>
            <Input
              label="Transaction date"
              name="transactionDate"
              type="date"
              value={form.transactionDate}
              error={fieldErrors.transactionDate}
              onBlur={() => setFieldErrors((current) => ({ ...current, transactionDate: validateIsoDate(form.transactionDate, "Transaction date") }))}
              onChange={(event) => {
                setForm((current) => ({ ...current, transactionDate: event.target.value }));
                setFieldErrors((current) => ({ ...current, transactionDate: null }));
              }}
            />
            <Input
              label="Description"
              name="description"
              placeholder="Groceries"
              value={form.description}
              error={fieldErrors.description}
              onBlur={() => setFieldErrors((current) => ({ ...current, description: validateRequiredText(form.description, "Description") }))}
              onChange={(event) => {
                setForm((current) => ({ ...current, description: event.target.value }));
                setFieldErrors((current) => ({ ...current, description: null }));
              }}
            />
            <Input
              label="Merchant"
              name="merchant"
              placeholder="Optional"
              value={form.merchant}
              onChange={(event) => setForm((current) => ({ ...current, merchant: event.target.value }))}
            />
            <MoneyInput
              label="Amount"
              name="amount"
              value={form.amount}
              error={fieldErrors.amount}
              disabled={isSubmitting}
              placeholder="125.00"
              onBlur={() => setFieldErrors((current) => ({ ...current, amount: validatePositiveMoney(form.amount, "Amount") }))}
              onChange={(value) => {
                setForm((current) => ({ ...current, amount: value }));
                setFieldErrors((current) => ({ ...current, amount: null }));
              }}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-raf-ink">Direction</span>
                <select
                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                  value={form.direction}
                  onChange={(event) => {
                    const nextDirection = event.target.value as "debit" | "credit";
                    setForm((current) => ({ ...current, direction: nextDirection }));
                    setFieldErrors((current) => ({
                      ...current,
                      linkedDebtId: current.linkedDebtId && nextDirection !== "debit" ? "Linked debt requires a debit transaction" : null,
                    }));
                  }}
                >
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-raf-ink">Linked debt</span>
                <select
                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                  value={form.linkedDebtId}
                  onChange={(event) => {
                    const linkedDebtId = event.target.value;
                    setForm((current) => ({ ...current, linkedDebtId }));
                    setFieldErrors((current) => ({
                      ...current,
                      linkedDebtId: linkedDebtId && form.direction !== "debit" ? "Linked debt requires a debit transaction" : null,
                    }));
                  }}
                >
                  <option value="">None</option>
                  {(data?.debts ?? []).map((debt) => (
                    <option key={debt.id} value={debt.id}>{debt.name}</option>
                  ))}
                </select>
                {fieldErrors.linkedDebtId ? <span className="mt-2 block text-sm text-rose-600">{fieldErrors.linkedDebtId}</span> : null}
              </label>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-raf-ink">Category</span>
              <select
                className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                value={form.categoryId}
                onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
              >
                <option value="">Unassigned</option>
                {(data?.categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? <LoadingSpinner inline size="sm" label="Saving transaction..." /> : "Create Transaction"}</Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          {submitError ? <ErrorState title="Failed to record transaction" message={submitError} /> : null}
          {submitSuccess ? <SuccessNotice title="Transaction saved" message={submitSuccess} /> : null}
          <Card title="Filter Ledger" subtitle="Date and category filters query the API. Search and sorting are applied to the current page.">
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="From date"
                name="fromDate"
                type="date"
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  setCursorHistory([null]);
                }}
              />
              <Input
                label="To date"
                name="toDate"
                type="date"
                value={toDate}
                onChange={(event) => {
                  setToDate(event.target.value);
                  setCursorHistory([null]);
                }}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-[1.2fr,0.8fr]">
              <Input
                label="Search description"
                name="search"
                placeholder="Search current page"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-raf-ink">Filter by category</span>
                <select
                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                  value={categoryFilter}
                  onChange={(event) => {
                    setCategoryFilter(event.target.value);
                    setCursorHistory([null]);
                  }}
                >
                  <option value="">All categories</option>
                  {(data?.categories ?? []).map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </Card>
        </div>
      </section>

      <Card
        title="Import Bank Statement"
        subtitle="Upload a PDF bank statement to import transactions for review."
        actions={(
          <Button type="button" variant="secondary" disabled={isLoading || isImporting} onClick={() => void reload()}>
            Refresh imports
          </Button>
        )}
      >
        <form className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]" onSubmit={handleImportUpload}>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-raf-ink">Statement PDF</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                disabled={isImporting}
                className="block w-full rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm text-stone-600 file:mr-4 file:rounded-full file:border-0 file:bg-raf-moss file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-raf-ink disabled:cursor-not-allowed disabled:opacity-60"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSelectedImportFile(file);
                  setImportError(null);
                  setImportSuccess(null);
                }}
              />
            </label>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
              {selectedImportFile
                ? `Selected file: ${selectedImportFile.name}`
                : "Select a PDF file to prepare an import."}
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!selectedImportFile || isImporting}>
                {isImporting ? <LoadingSpinner inline size="sm" label="Uploading statement..." /> : "Upload PDF"}
              </Button>
            </div>
          </div>
          <div className="space-y-3 rounded-3xl border border-stone-200 bg-stone-50/80 p-5">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Import Summary</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">Imported rows stay separate from ledger transactions until you review them.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{importsSummary.total} total</Badge>
              <Badge tone={importsSummary.unreviewed > 0 ? "warning" : "success"}>{importsSummary.unreviewed} unreviewed</Badge>
            </div>
            <p className="text-sm text-stone-500">
              {importsSummary.earliestDate && importsSummary.latestDate
                ? `Current import range: ${formatIsoDate(importsSummary.earliestDate)} to ${formatIsoDate(importsSummary.latestDate)}`
                : "No imported statement rows yet."}
            </p>
          </div>
        </form>
        <div className="mt-4 space-y-3">
          {importError ? <ErrorState title="Import failed" message={importError} /> : null}
          {importSuccess ? <SuccessNotice title="Import complete" message={importSuccess} /> : null}
        </div>
      </Card>

      <Card
        title="Imported Rows Review"
        subtitle="Review imported bank rows without overwhelming the main ledger view."
        actions={(
          <div className="flex items-center gap-3">
            <Badge tone={importsSummary.unreviewed > 0 ? "warning" : "neutral"}>{importsSummary.unreviewed} unreviewed</Badge>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIsImportsExpanded((current) => !current)}
            >
              {isImportsExpanded ? "Hide review" : "Review imports"}
              <span className="ml-2 text-xs">{isImportsExpanded ? "▴" : "▾"}</span>
            </Button>
          </div>
        )}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Imported rows</div>
              <div className="mt-1 text-lg font-semibold text-raf-ink">{importsSummary.total}</div>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Unreviewed rows</div>
              <div className="mt-1 text-lg font-semibold text-raf-ink">{importsSummary.unreviewed}</div>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Import range</div>
              <div className="mt-1 text-sm font-medium text-raf-ink">
                {importsSummary.earliestDate && importsSummary.latestDate
                  ? `${formatIsoDate(importsSummary.earliestDate)} to ${formatIsoDate(importsSummary.latestDate)}`
                  : "No rows imported"}
              </div>
            </div>
          </div>

          {reviewError ? <ErrorState title="Review action failed" message={reviewError} /> : null}
          {reviewSuccess ? <SuccessNotice title="Imported row updated" message={reviewSuccess} /> : null}

          <div className="rounded-2xl border border-stone-200 bg-stone-50/70 px-4 py-3 text-sm text-stone-600">
            Persistent “mark reviewed” support is not available in the backend yet. The current UI supports the existing persisted action: mark an imported row as ignored.
          </div>

          {!isImportsExpanded ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm text-stone-600">
              Imported rows review is collapsed. Expand it to inspect and action imported bank statement rows.
            </div>
          ) : isLoading ? (
            <LoadingState label="Loading imported rows..." />
          ) : !error && data ? (
            data.imports.length ? (
              <Table
                headers={["Date", "Description", "Amount", "Balance After", "Status", "Review Action"]}
                footer={(
                  <div className="flex items-center justify-between gap-4 text-sm text-stone-500">
                    <span>{data.imports.length} imported row(s) loaded for review</span>
                    <span>Only persisted action currently available: ignore</span>
                  </div>
                )}
              >
                {data.imports.map((item) => {
                  const isInflow = Number(item.amount) > 0;
                  const isPending = reviewPendingId === item.id;

                  return (
                    <tr key={item.id} className="hover:bg-stone-50/80">
                      <td className="px-4 py-3 text-sm text-stone-600">{formatIsoDate(item.date)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-raf-ink">{item.description}</td>
                      <td className={`px-4 py-3 text-sm font-semibold ${isInflow ? "text-emerald-700" : "text-rose-700"}`}>
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-4 py-3 text-sm text-stone-600">
                        {item.balance_after_transaction ? formatCurrency(item.balance_after_transaction) : "N/A"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge tone={importedStatusTone(item.status)}>{item.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled
                            title="Backend mark reviewed endpoint not available yet"
                          >
                            Mark reviewed
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={item.status !== "unreviewed" || isPending}
                            onClick={() => void handleIgnoreImportedRow(item.id)}
                          >
                            {isPending ? <LoadingSpinner inline size="sm" label="Ignoring..." /> : "Ignore"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            ) : (
              <EmptyState
                title="No imported rows yet"
                message="Upload a PDF bank statement to import transactions for review alongside the ledger."
              />
            )
          ) : null}
        </div>
      </Card>

      <Card title="Transactions Table" subtitle={`Showing transactions from ${formatIsoDate(fromDate)} to ${formatIsoDate(toDate)}.`}>
        {isLoading ? <LoadingState label="Loading transactions..." /> : null}
        {!isLoading && error ? <ErrorState title="Failed to fetch transactions" message={error} onRetry={() => void reload()} /> : null}
        {!isLoading && !error && data ? (
          visibleTransactions.length ? (
            <Table
              headers={[
                sortableHeader("Date", "transactionDate"),
                sortableHeader("Description", "description"),
                sortableHeader("Category", "category"),
                sortableHeader("Amount", "amount"),
                sortableHeader("Direction", "direction"),
              ]}
              footer={(
                <div className="flex items-center justify-between gap-4 text-sm text-stone-500">
                  <span>{visibleTransactions.length} item(s) on this page after search and sort</span>
                  <span>{data.transactions.nextCursor ? "More pages available" : "End of results"}</span>
                </div>
              )}
            >
              {visibleTransactions.map((transaction: Transaction) => {
                const categoryLabel = transaction.categoryId
                  ? categoryLookup.get(transaction.categoryId) ?? transaction.categoryId
                  : "Unassigned";

                return (
                  <tr key={transaction.id} className="hover:bg-stone-50/80">
                    <td className="px-4 py-3 text-sm text-stone-600">{formatIsoDate(transaction.transactionDate)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-raf-ink">{transaction.description}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge tone={categoryTone(categoryLabel)}>{categoryLabel}</Badge>
                    </td>
                    <td className={`px-4 py-3 text-sm font-semibold ${amountClassName(transaction.direction)}`}>
                      {formatCurrency(transaction.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Badge tone={directionTone(transaction.direction)}>{transaction.direction}</Badge>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <EmptyState
              title="No transactions match these filters"
              message="Adjust the date range, category filter, or description search to widen the current view."
            />
          )
        ) : null}
      </Card>
    </PageShell>
  );
}
