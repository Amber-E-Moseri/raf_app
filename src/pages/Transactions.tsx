import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { ApiError } from "../api/client";
import { getDebts } from "../api/debtsApi";
import { getFixedBills } from "../api/fixedBillsApi";
import { getGoals } from "../api/goalsApi";
import {
  classifyImportedTransaction,
  getImportedTransactions,
  importBankStatement,
} from "../api/importsApi";
import { createTransaction, getTransactions } from "../api/transactionsApi";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingSpinner } from "../components/feedback/LoadingSpinner";
import { LoadingState } from "../components/feedback/LoadingState";
import { SuccessNotice } from "../components/feedback/SuccessNotice";
import { PageShell } from "../components/layout/PageShell";
import { usePeriod } from "../components/layout/PeriodProvider";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { MoneyInput } from "../components/ui/MoneyInput";
import { Table } from "../components/ui/Table";
import { useAsyncData } from "../hooks/useAsyncData";
import { DEFAULT_PAGE_SIZE } from "../lib/constants";
import { formatCurrency, formatIsoDate } from "../lib/format";
import { defaultReviewDateForMonth, getMonthKeyFromDate } from "../lib/period";
import {
  normalizeMoneyInput,
  validateIsoDate,
  validatePositiveMoney,
  validateRequiredText,
} from "../lib/validation";
import type {
  AllocationCategory,
  Debt,
  FixedBill,
  Goal,
  ImportedTransaction,
  ImportClassificationPayload,
  Transaction,
  TransactionListResponse,
} from "../lib/types";

interface TransactionsViewModel {
  transactions: TransactionListResponse;
  debts: Debt[];
  categories: AllocationCategory[];
  fixedBills: FixedBill[];
  goals: Goal[];
  imports: ImportedTransaction[];
}

interface ImportReviewDraft {
  classificationType: ImportClassificationPayload["classification_type"];
  categoryId: string;
  debtId: string;
  fixedBillId: string;
  goalId: string;
  reviewNote: string;
  rememberChoice: boolean;
  autoApplyRule: boolean;
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

function importedStatusTone(item: ImportedTransaction) {
  if (item.status === "unreviewed") {
    return "warning";
  }

  if (item.classification_type === "duplicate" || item.classification_type === "transfer") {
    return "neutral";
  }

  if (item.status === "ignored") {
    return "neutral";
  }

  return "success";
}

function importedStatusLabel(item: ImportedTransaction) {
  if (item.status === "unreviewed") {
    return "Needs review";
  }
  if (item.classification_type === "ignore") {
    return "Ignored";
  }
  if (item.classification_type === "duplicate") {
    return "Duplicate";
  }
  if (item.classification_type === "transfer") {
    return "Transfer";
  }
  if (item.classification_type === "goal_funding") {
    return "Goal linked";
  }
  if (item.classification_type === "debt_payment") {
    return "Debt payment";
  }
  if (item.classification_type === "fixed_bill_payment") {
    return "Fixed bill";
  }
  if (item.classification_type === "transaction") {
    return "Approved";
  }
  return item.status;
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

function buildDraftFromImportedRow(item: ImportedTransaction): ImportReviewDraft {
  return {
    classificationType: (item.suggestion?.classification_type as ImportClassificationPayload["classification_type"]) ?? "transaction",
    categoryId: item.suggestion?.category_id ?? "",
    debtId: item.suggestion?.linked_debt_id ?? "",
    fixedBillId: item.suggestion?.linked_fixed_bill_id ?? "",
    goalId: item.suggestion?.linked_goal_id ?? "",
    reviewNote: "",
    rememberChoice: item.suggestion != null,
    autoApplyRule: item.suggestion?.auto_apply ?? false,
  };
}

function requiresCategorySelection(classificationType: ImportClassificationPayload["classification_type"]) {
  return classificationType === "transaction";
}

function requiresDebtSelection(classificationType: ImportClassificationPayload["classification_type"]) {
  return classificationType === "debt_payment";
}

function requiresFixedBillSelection(classificationType: ImportClassificationPayload["classification_type"]) {
  return classificationType === "fixed_bill_payment";
}

function requiresGoalSelection(classificationType: ImportClassificationPayload["classification_type"]) {
  return classificationType === "goal_funding";
}

function primaryReviewLabel(classificationType: ImportClassificationPayload["classification_type"]) {
  return classificationType === "transaction" ? "Approve" : "Apply";
}

function importRowStatus(item: ImportedTransaction, draft: ImportReviewDraft) {
  if (item.status !== "unreviewed") {
    return { label: "Approved", tone: "success" as const };
  }

  if (requiresCategorySelection(draft.classificationType) && !draft.categoryId) {
    return { label: "Needs bucket", tone: "warning" as const };
  }

  return { label: "Ready to approve", tone: "neutral" as const };
}

export function Transactions() {
  const { activeMonth, activeMonthLabel, activeRange } = usePeriod();
  const { from: initialFrom, to: initialTo } = activeRange;
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [fromDate, setFromDate] = useState(initialFrom);
  const [toDate, setToDate] = useState(initialTo);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("transactionDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [quickFilter, setQuickFilter] = useState<"all" | "spend" | "income" | "transfer" | "debt">("all");
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
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ImportReviewDraft>>({});
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const [reviewPendingIds, setReviewPendingIds] = useState<string[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([]);
  const [importsView, setImportsView] = useState<"needs_review" | "processed">("needs_review");
  const [expandedImportIds, setExpandedImportIds] = useState<Record<string, boolean>>({});
  const [bulkBucketId, setBulkBucketId] = useState("");
  const [isBulkReviewing, setIsBulkReviewing] = useState(false);
  const [openImportMenuId, setOpenImportMenuId] = useState<string | null>(null);
  const cursor = cursorHistory[cursorHistory.length - 1];

  useEffect(() => {
    setFromDate(activeRange.from);
    setToDate(activeRange.to);
    setCursorHistory([null]);
    setForm((current) => ({
      ...current,
      transactionDate: defaultReviewDateForMonth(activeMonth),
    }));
  }, [activeMonth, activeRange.from, activeRange.to]);

  useEffect(() => {
    setSelectedImportIds([]);
    setExpandedImportIds({});
    setBulkBucketId("");
    setImportsView("needs_review");
    setOpenImportMenuId(null);
  }, [activeMonth]);

  const { data, error, isLoading, reload } = useAsyncData<TransactionsViewModel>(async () => {
    const [transactions, debts, imports, fixedBills, goals] = await Promise.all([
      getTransactions({
        from: fromDate,
        to: toDate,
        categoryId: categoryFilter || undefined,
        cursor: cursor ?? undefined,
        limit: DEFAULT_PAGE_SIZE,
      }),
      getDebts(),
      getImportedTransactions(),
      getFixedBills(),
      getGoals(),
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
      fixedBills: fixedBills.items,
      goals: goals.items,
      imports: imports.items,
    };
  }, [categoryFilter, cursor, fromDate, toDate]);

  const debtLookup = new Map(data?.debts.map((debt) => [debt.id, debt.name]) ?? []);
  const categoryLookup = new Map(data?.categories.map((category) => [category.id, category.label]) ?? []);
  const fixedBillLookup = new Map(data?.fixedBills.map((bill) => [bill.id, bill.name]) ?? []);
  const goalLookup = new Map(data?.goals.map((goal) => [goal.id, goal.name]) ?? []);

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
    const imports = (data?.imports ?? []).filter((item) => getMonthKeyFromDate(item.date) === activeMonth);
    const unreviewed = imports.filter((item) => item.status === "unreviewed").length;
    const dates = imports.map((item) => item.date).filter(Boolean).sort();

    return {
      total: imports.length,
      unreviewed,
      earliestDate: dates[0] ?? null,
      latestDate: dates.at(-1) ?? null,
    };
  }, [activeMonth, data?.imports]);

  const visibleImports = useMemo(
    () => (data?.imports ?? []).filter((item) => getMonthKeyFromDate(item.date) === activeMonth),
    [activeMonth, data?.imports],
  );

  const needsReviewImports = useMemo(
    () => visibleImports.filter((item) => item.status === "unreviewed"),
    [visibleImports],
  );

  const processedImports = useMemo(
    () => visibleImports.filter((item) => item.status !== "unreviewed"),
    [visibleImports],
  );

  const importsInView = importsView === "needs_review" ? needsReviewImports : processedImports;

  const selectedNeedsReviewItems = useMemo(
    () => needsReviewImports.filter((item) => selectedImportIds.includes(item.id)),
    [needsReviewImports, selectedImportIds],
  );

  const hasSelectedNeedsReview = selectedNeedsReviewItems.length > 0;

  useEffect(() => {
    const validIds = new Set(needsReviewImports.map((item) => item.id));
    setSelectedImportIds((current) => current.filter((id) => validIds.has(id)));
  }, [needsReviewImports]);

  function getReviewDraft(item: ImportedTransaction) {
    return reviewDrafts[item.id] ?? buildDraftFromImportedRow(item);
  }

  function updateReviewDraft(item: ImportedTransaction, patch: Partial<ImportReviewDraft>) {
    setReviewDrafts((current) => ({
      ...current,
      [item.id]: {
        ...(current[item.id] ?? buildDraftFromImportedRow(item)),
        ...patch,
      },
    }));
  }

  function toggleImportSelection(importId: string) {
    setSelectedImportIds((current) => (
      current.includes(importId)
        ? current.filter((id) => id !== importId)
        : [...current, importId]
    ));
  }

  function toggleSelectAllImports() {
    if (!needsReviewImports.length) {
      return;
    }

    setSelectedImportIds((current) => (
      current.length === needsReviewImports.length
        ? []
        : needsReviewImports.map((item) => item.id)
    ));
  }

  function toggleImportDetails(importId: string) {
    setExpandedImportIds((current) => ({
      ...current,
      [importId]: !current[importId],
    }));
  }

  function toggleImportMenu(importId: string) {
    setOpenImportMenuId((current) => current === importId ? null : importId);
  }

  function applySuggestion(item: ImportedTransaction) {
    if (!item.suggestion) {
      return;
    }

    setReviewDrafts((current) => ({
      ...current,
      [item.id]: buildDraftFromImportedRow(item),
    }));
  }

  function getBucketLabel(item: ImportedTransaction) {
    const draft = getReviewDraft(item);
    const bucketId = draft.categoryId || item.suggestion?.category_id || "";

    if (bucketId) {
      return categoryLookup.get(bucketId) ?? bucketId;
    }

    if (draft.classificationType === "debt_payment") {
      return "Debt payoff";
    }

    if (draft.classificationType === "fixed_bill_payment") {
      return "Via fixed bill";
    }

    if (draft.classificationType === "goal_funding") {
      return "Via goal";
    }

    if (item.classification_type === "duplicate") {
      return "Duplicate";
    }

    if (item.classification_type === "transfer") {
      return "Transfer";
    }

    if (item.classification_type === "ignore" || item.status === "ignored") {
      return "Ignored";
    }

    if (item.classification_type === "transaction") {
      return "Approved";
    }

    return "Select bucket";
  }

  function getLinkedLabel(item: ImportedTransaction) {
    const draft = getReviewDraft(item);

    if (draft.classificationType === "debt_payment") {
      return draft.debtId ? debtLookup.get(draft.debtId) ?? draft.debtId : "Select debt";
    }

    if (draft.classificationType === "fixed_bill_payment") {
      return draft.fixedBillId ? fixedBillLookup.get(draft.fixedBillId) ?? draft.fixedBillId : "Select fixed bill";
    }

    if (draft.classificationType === "goal_funding") {
      return draft.goalId ? goalLookup.get(draft.goalId) ?? draft.goalId : "Select goal";
    }

    if (item.classification_type === "debt_payment" && item.linked_debt_id) {
      return debtLookup.get(item.linked_debt_id) ?? item.linked_debt_id;
    }

    if (item.classification_type === "fixed_bill_payment" && item.linked_fixed_bill_id) {
      return fixedBillLookup.get(item.linked_fixed_bill_id) ?? item.linked_fixed_bill_id;
    }

    if (item.classification_type === "goal_funding" && item.linked_goal_id) {
      return goalLookup.get(item.linked_goal_id) ?? item.linked_goal_id;
    }

    return "None";
  }

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
        transactionDate: defaultReviewDateForMonth(activeMonth),
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

  function buildImportClassificationPayload(item: ImportedTransaction) {
    const draft = getReviewDraft(item);
    if (requiresCategorySelection(draft.classificationType) && !draft.categoryId) {
      throw new Error("Select an allocation bucket before approving this imported row.");
    }

    const payload: ImportClassificationPayload = {
      classification_type: draft.classificationType,
      review_note: draft.reviewNote.trim() || null,
      remember_choice: draft.rememberChoice,
      auto_apply_rule: draft.rememberChoice ? draft.autoApplyRule : false,
    };

    if (requiresCategorySelection(draft.classificationType)) {
      payload.category_id = draft.categoryId || null;
    }

    if (requiresDebtSelection(draft.classificationType)) {
      payload.debt_id = draft.debtId || null;
    }

    if (requiresFixedBillSelection(draft.classificationType)) {
      payload.fixed_bill_id = draft.fixedBillId || null;
    }

    if (requiresGoalSelection(draft.classificationType)) {
      payload.goal_id = draft.goalId || null;
    }

    return payload;
  }

  async function submitImportedReview(item: ImportedTransaction, payload: ImportClassificationPayload) {
    setReviewPendingIds((current) => [...current, item.id]);
    setReviewError(null);
    setReviewSuccess(null);

    try {
      await classifyImportedTransaction(item.id, payload);
    } catch (requestError) {
      throw requestError instanceof Error ? requestError : new Error("Imported row review failed.");
    } finally {
      setReviewPendingIds((current) => current.filter((id) => id !== item.id));
    }
  }

  async function handleReviewImportedRow(item: ImportedTransaction) {
    try {
      const payload = buildImportClassificationPayload(item);
      await submitImportedReview(item, payload);
      setReviewSuccess("Imported row reviewed and saved.");
      await reload();
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : "Imported row review failed.");
      setReviewSuccess(null);
    }
  }

  async function handleIgnoreImportedRow(item: ImportedTransaction) {
    const currentDraft = getReviewDraft(item);

    setReviewDrafts((current) => ({
      ...current,
      [item.id]: {
        ...currentDraft,
        classificationType: "ignore",
      },
    }));

    try {
      await submitImportedReview(item, {
        classification_type: "ignore",
        review_note: currentDraft.reviewNote.trim() || null,
        remember_choice: false,
        auto_apply_rule: false,
      });
      setReviewSuccess("Imported row ignored.");
      setOpenImportMenuId(null);
      await reload();
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : "Ignore action failed.");
      setReviewSuccess(null);
    }
  }

  function handleBulkAssignBucket() {
    if (!bulkBucketId || !selectedNeedsReviewItems.length) {
      return;
    }

    selectedNeedsReviewItems.forEach((item) => {
      updateReviewDraft(item, { categoryId: bulkBucketId });
    });
    setReviewSuccess(`Assigned ${selectedNeedsReviewItems.length} selected row${selectedNeedsReviewItems.length === 1 ? "" : "s"} to a bucket.`);
    setReviewError(null);
  }

  function handleBulkApplyRememberedRule() {
    const itemsWithSuggestions = selectedNeedsReviewItems.filter((item) => item.suggestion);
    if (!itemsWithSuggestions.length) {
      setReviewError("No remembered rules are available for the selected rows.");
      setReviewSuccess(null);
      return;
    }

    itemsWithSuggestions.forEach((item) => applySuggestion(item));
    setReviewSuccess(`Applied remembered suggestions to ${itemsWithSuggestions.length} selected row${itemsWithSuggestions.length === 1 ? "" : "s"}.`);
    setReviewError(null);
  }

  async function handleBulkReview(action: "approve" | "ignore") {
    if (!selectedNeedsReviewItems.length) {
      return;
    }

    setIsBulkReviewing(true);
    setReviewError(null);
    setReviewSuccess(null);

    try {
      for (const item of selectedNeedsReviewItems) {
        const payload = action === "ignore"
          ? {
            classification_type: "ignore" as const,
            review_note: getReviewDraft(item).reviewNote.trim() || null,
            remember_choice: false,
            auto_apply_rule: false,
          }
          : buildImportClassificationPayload(item);

        await submitImportedReview(item, payload);
      }

      setSelectedImportIds([]);
      setReviewSuccess(`${action === "approve" ? "Approved" : "Ignored"} ${selectedNeedsReviewItems.length} imported row${selectedNeedsReviewItems.length === 1 ? "" : "s"}.`);
      await reload();
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : "Bulk review failed.");
    } finally {
      setIsBulkReviewing(false);
    }
  }

  function applyQuickFilter(nextFilter: "all" | "spend" | "income" | "transfer" | "debt") {
    setQuickFilter(nextFilter);

    if (nextFilter === "all") {
      setSearchTerm("");
      return;
    }

    if (nextFilter === "spend") {
      setSearchTerm("shop");
      return;
    }

    if (nextFilter === "income") {
      setSearchTerm("income");
      return;
    }

    if (nextFilter === "transfer") {
      setSearchTerm("transfer");
      return;
    }

    setSearchTerm("debt");
  }

  return (
    <PageShell
      eyebrow="Ledger"
      title="Transactions"
      description={`${activeMonthLabel} transactions, imports, and review flow.`}
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
              <span className="mb-2 block text-sm font-medium text-raf-ink">Allocation bucket</span>
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
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <LoadingSpinner inline size="sm" label="Saving transaction..." /> : "Create Transaction"}
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          {submitError ? <ErrorState title="Failed to record transaction" message={submitError} /> : null}
          {submitSuccess ? <SuccessNotice title="Transaction saved" message={submitSuccess} /> : null}
          <Card title="Filter Ledger" subtitle="Date and bucket filters query the API. Search and sorting are applied to the current page.">
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
                <span className="mb-2 block text-sm font-medium text-raf-ink">Filter by bucket</span>
                <select
                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                  value={categoryFilter}
                  onChange={(event) => {
                    setCategoryFilter(event.target.value);
                    setCursorHistory([null]);
                  }}
                >
                  <option value="">All buckets</option>
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
        subtitle="Upload a PDF bank statement to create imported rows for review. Nothing becomes a completed RAF transaction until you approve it."
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
              <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Review queue</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">Imported rows stay separate from the ledger until you classify them into RAF buckets, debt payments, fixed bills, goals, duplicates, or transfers.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{importsSummary.total} total</Badge>
              <Badge tone={importsSummary.unreviewed > 0 ? "warning" : "success"}>{importsSummary.unreviewed} unreviewed</Badge>
            </div>
            <p className="text-sm text-stone-500">
              {importsSummary.earliestDate && importsSummary.latestDate
                ? `${activeMonthLabel} import range: ${formatIsoDate(importsSummary.earliestDate)} to ${formatIsoDate(importsSummary.latestDate)}`
                : `No imported statement rows for ${activeMonthLabel}.`}
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
        subtitle="Work through the review queue quickly with compact rows, bulk tools, and editable suggestions."
        actions={(
          <div className="flex items-center gap-3">
            <Badge tone={importsSummary.unreviewed > 0 ? "warning" : "neutral"}>{importsSummary.unreviewed} needs review</Badge>
            <Button type="button" variant="ghost" onClick={() => setIsImportsExpanded((current) => !current)}>
              {isImportsExpanded ? "Collapse review" : "Expand review"}
            </Button>
          </div>
        )}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                  importsView === "needs_review"
                    ? "border-transparent bg-[var(--primary-color)] text-[var(--primary-contrast)]"
                    : "border-[var(--border-color)] bg-[var(--surface-color)] text-stone-600"
                }`}
                onClick={() => setImportsView("needs_review")}
              >
                Needs review ({needsReviewImports.length})
              </button>
              <button
                type="button"
                className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                  importsView === "processed"
                    ? "border-transparent bg-[var(--primary-color)] text-[var(--primary-contrast)]"
                    : "border-[var(--border-color)] bg-[var(--surface-color)] text-stone-600"
                }`}
                onClick={() => setImportsView("processed")}
              >
                Processed ({processedImports.length})
              </button>
            </div>
            <div className="text-sm text-stone-500">
              {importsSummary.earliestDate && importsSummary.latestDate
                ? `${formatIsoDate(importsSummary.earliestDate)} to ${formatIsoDate(importsSummary.latestDate)}`
                : `No imported rows in ${activeMonthLabel}`}
            </div>
          </div>

          {reviewError ? <ErrorState title="Review action failed" message={reviewError} /> : null}
          {reviewSuccess ? <SuccessNotice title="Imported row updated" message={reviewSuccess} /> : null}

          {!isImportsExpanded ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm text-stone-600">
              Imported rows review is collapsed. Expand it to process the review queue and bulk-approve similar imports.
            </div>
          ) : isLoading ? (
            <LoadingState label="Loading imported rows..." />
          ) : !error && data ? (
            importsInView.length ? (
              <div className="space-y-3">
                {importsView === "needs_review" ? (
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <label className="inline-flex items-center gap-3 text-sm font-medium text-raf-ink">
                        <input
                          type="checkbox"
                          checked={needsReviewImports.length > 0 && selectedImportIds.length === needsReviewImports.length}
                          onChange={toggleSelectAllImports}
                        />
                        <span>Select all</span>
                      </label>
                      {hasSelectedNeedsReview ? (
                        <div className="flex flex-wrap items-center gap-3">
                          <Badge tone="warning">{selectedNeedsReviewItems.length} selected</Badge>
                          <label className="flex items-center gap-2 text-sm text-stone-600">
                            <span>Assign bucket</span>
                            <select
                              className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                              value={bulkBucketId}
                              onChange={(event) => setBulkBucketId(event.target.value)}
                            >
                              <option value="">Choose bucket</option>
                              {data.categories.map((category) => (
                                <option key={category.id} value={category.id}>{category.label}</option>
                              ))}
                            </select>
                          </label>
                          <Button type="button" variant="secondary" disabled={!bulkBucketId || isBulkReviewing} onClick={handleBulkAssignBucket}>
                            Assign bucket
                          </Button>
                          <Button type="button" disabled={isBulkReviewing} onClick={() => void handleBulkReview("approve")}>
                            {isBulkReviewing ? <LoadingSpinner inline size="sm" label="Approving..." /> : "Approve Selected"}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-sm text-stone-500">Select rows to assign, approve, ignore, or prefill from remembered rules.</span>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="overflow-hidden rounded-2xl border border-stone-200">
                  <div className="hidden bg-stone-50 px-4 py-2.5 text-xs font-semibold text-stone-500 lg:grid lg:grid-cols-[36px,88px,minmax(0,320px),112px,132px,132px,112px,44px] lg:gap-3">
                    <span />
                    <span>Date</span>
                    <span>Description</span>
                    <span>Amount</span>
                    <span>Bucket</span>
                    <span>Linked type</span>
                    <span>Primary action</span>
                    <span />
                  </div>
                  <div className="divide-y divide-stone-200 bg-white">
                    {importsInView.map((item) => {
                      const isInflow = Number(item.amount) > 0;
                      const isPending = reviewPendingIds.includes(item.id);
                      const draft = getReviewDraft(item);
                      const status = importRowStatus(item, draft);
                      const isExpanded = expandedImportIds[item.id] ?? false;
                      const needsReview = item.status === "unreviewed";
                      const isMenuOpen = openImportMenuId === item.id;

                      return (
                        <div key={item.id}>
                          <div className="grid gap-2 px-4 py-2.5 lg:grid-cols-[36px,88px,minmax(0,320px),112px,132px,132px,112px,44px] lg:items-start">
                            <div className="flex items-center justify-center">
                              {needsReview ? (
                                <input
                                  type="checkbox"
                                  checked={selectedImportIds.includes(item.id)}
                                  onChange={() => toggleImportSelection(item.id)}
                                />
                              ) : (
                                <span className="text-xs text-stone-400">-</span>
                              )}
                            </div>
                            <div className="min-w-0 text-sm text-stone-600 lg:pt-1">{formatIsoDate(item.date)}</div>
                            <div className="min-w-0 max-w-[320px]">
                              <div className="break-words text-sm font-medium leading-5 text-raf-ink" title={item.description}>
                                {item.description}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <Badge tone={status.tone}>{status.label}</Badge>
                                {!needsReview ? <Badge tone={importedStatusTone(item)}>{importedStatusLabel(item)}</Badge> : null}
                                {item.suggestion ? <Badge tone="success">Suggested</Badge> : null}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                                {item.review_note ? <span>Note: {item.review_note}</span> : null}
                              </div>
                            </div>
                            <div className="min-w-0 rounded-xl bg-stone-50 px-3 py-2 text-right lg:bg-transparent lg:px-0 lg:py-1">
                              <div className="text-[11px] font-semibold text-stone-500 lg:hidden">Amount</div>
                              <div className={`text-sm font-semibold ${isInflow ? "text-emerald-700" : "text-rose-700"}`}>
                                {formatCurrency(item.amount)}
                              </div>
                            </div>
                            <div className="min-w-0 lg:pt-0.5">
                              {needsReview && requiresCategorySelection(draft.classificationType) ? (
                                <select
                                  className="w-full rounded-xl border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700 outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                                  value={draft.categoryId}
                                  disabled={isPending || isBulkReviewing}
                                  onChange={(event) => updateReviewDraft(item, { categoryId: event.target.value })}
                                >
                                  <option value="">Select bucket</option>
                                  {data.categories.map((category) => (
                                    <option key={category.id} value={category.id}>{category.label}</option>
                                  ))}
                                </select>
                              ) : (
                                <div className="truncate text-sm text-stone-600">{getBucketLabel(item)}</div>
                              )}
                            </div>
                            <div className="min-w-0 truncate text-sm text-stone-600 lg:pt-0.5">{getLinkedLabel(item)}</div>
                            <div className="min-w-0 lg:pt-0.5">
                              {needsReview ? (
                                <Button
                                  type="button"
                                  className="min-h-9 rounded-full px-3 py-1.5 text-xs"
                                  disabled={isPending || isBulkReviewing}
                                  onClick={() => void handleReviewImportedRow(item)}
                                >
                                  {isPending ? <LoadingSpinner inline size="sm" label="Saving..." /> : primaryReviewLabel(draft.classificationType)}
                                </Button>
                              ) : (
                                <div className="text-sm text-stone-500">Processed</div>
                              )}
                            </div>
                            <div className="relative flex justify-end">
                              <Button type="button" variant="ghost" className="min-h-9 rounded-full px-2 py-1.5 text-base leading-none" onClick={() => toggleImportMenu(item.id)}>
                                ...
                              </Button>
                              {isMenuOpen ? (
                                <div className="absolute right-0 top-10 z-10 min-w-[140px] rounded-2xl border border-stone-200 bg-white p-2 shadow-lg">
                                  <button
                                    type="button"
                                    className="block w-full rounded-xl px-3 py-2 text-left text-sm text-raf-ink hover:bg-stone-50"
                                    onClick={() => {
                                      setExpandedImportIds((current) => ({ ...current, [item.id]: true }));
                                      setOpenImportMenuId(null);
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="block w-full rounded-xl px-3 py-2 text-left text-sm text-raf-ink hover:bg-stone-50"
                                    onClick={() => {
                                      toggleImportDetails(item.id);
                                      setOpenImportMenuId(null);
                                    }}
                                  >
                                    View details
                                  </button>
                                  {needsReview ? (
                                    <button
                                      type="button"
                                      className="block w-full rounded-xl px-3 py-2 text-left text-sm text-rose-700 hover:bg-stone-50"
                                      onClick={() => void handleIgnoreImportedRow(item)}
                                    >
                                      Ignore
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {isExpanded ? (
                            <div className="border-t border-stone-100 bg-stone-50 px-4 py-4">
                              {item.suggestion ? (
                                <div className="mb-4 rounded-2xl border border-stone-200 bg-white px-4 py-3">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-sm text-stone-600">
                                      Remembered from a prior review of "{item.normalized_description ?? item.description.toLowerCase()}".
                                    </div>
                                    {needsReview ? (
                                      <Button type="button" variant="secondary" onClick={() => applySuggestion(item)}>
                                        Use suggestion
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}

                              {needsReview ? (
                                <div className="grid gap-4 lg:grid-cols-[220px,220px,220px,1fr]">
                                  <label className="block">
                                    <span className="mb-2 block text-sm font-medium text-raf-ink">Review action</span>
                                    <select
                                      className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                                      value={draft.classificationType}
                                      disabled={isPending || isBulkReviewing}
                                      onChange={(event) => updateReviewDraft(item, {
                                        classificationType: event.target.value as ImportClassificationPayload["classification_type"],
                                        categoryId: "",
                                        debtId: "",
                                        fixedBillId: "",
                                        goalId: "",
                                      })}
                                    >
                                      <option value="transaction">Approve as transaction</option>
                                      <option value="debt_payment">Link to debt payment</option>
                                      <option value="fixed_bill_payment">Link to fixed bill</option>
                                      <option value="goal_funding">Link to goal funding</option>
                                      <option value="duplicate">Mark duplicate</option>
                                      <option value="transfer">Mark transfer</option>
                                      <option value="ignore">Ignore</option>
                                    </select>
                                  </label>

                                  {requiresDebtSelection(draft.classificationType) ? (
                                    <label className="block">
                                      <span className="mb-2 block text-sm font-medium text-raf-ink">Debt</span>
                                      <select
                                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                                        value={draft.debtId}
                                        disabled={isPending || isBulkReviewing}
                                        onChange={(event) => updateReviewDraft(item, { debtId: event.target.value })}
                                      >
                                        <option value="">Select debt</option>
                                        {data.debts.map((debt) => (
                                          <option key={debt.id} value={debt.id}>{debt.name}</option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}

                                  {requiresFixedBillSelection(draft.classificationType) ? (
                                    <label className="block">
                                      <span className="mb-2 block text-sm font-medium text-raf-ink">Fixed bill</span>
                                      <select
                                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                                        value={draft.fixedBillId}
                                        disabled={isPending || isBulkReviewing}
                                        onChange={(event) => updateReviewDraft(item, { fixedBillId: event.target.value })}
                                      >
                                        <option value="">Select fixed bill</option>
                                        {data.fixedBills.map((bill) => (
                                          <option key={bill.id} value={bill.id}>{bill.name}</option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}

                                  {requiresGoalSelection(draft.classificationType) ? (
                                    <label className="block">
                                      <span className="mb-2 block text-sm font-medium text-raf-ink">Goal</span>
                                      <select
                                        className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-raf-ink outline-none transition focus:border-raf-moss focus:ring-2 focus:ring-raf-sage"
                                        value={draft.goalId}
                                        disabled={isPending || isBulkReviewing}
                                        onChange={(event) => updateReviewDraft(item, { goalId: event.target.value })}
                                      >
                                        <option value="">Select goal</option>
                                        {data.goals.map((goal) => (
                                          <option key={goal.id} value={goal.id}>{goal.name}</option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : null}

                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                                      <input
                                        type="checkbox"
                                        className="mt-1 size-4 rounded border-stone-300 text-raf-moss"
                                        checked={draft.rememberChoice}
                                        disabled={isPending || isBulkReviewing}
                                        onChange={(event) => updateReviewDraft(item, { rememberChoice: event.target.checked })}
                                      />
                                      <span>
                                        <span className="block font-medium text-raf-ink">Remember this choice</span>
                                        <span className="mt-1 block text-stone-500">Keep this review decision ready as a suggestion next time.</span>
                                      </span>
                                    </label>

                                    <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                                      <input
                                        type="checkbox"
                                        className="mt-1 size-4 rounded border-stone-300 text-raf-moss"
                                        checked={draft.autoApplyRule}
                                        disabled={!draft.rememberChoice || isPending || isBulkReviewing}
                                        onChange={(event) => updateReviewDraft(item, { autoApplyRule: event.target.checked })}
                                      />
                                      <span>
                                        <span className="block font-medium text-raf-ink">Allow auto-apply later</span>
                                        <span className="mt-1 block text-stone-500">Store this rule as auto-applicable for future imports without using it silently today.</span>
                                      </span>
                                    </label>
                                  </div>

                                  <Input
                                    label="Review note"
                                    name={`review-note-${item.id}`}
                                    placeholder="Optional note"
                                    value={draft.reviewNote}
                                    onChange={(event) => updateReviewDraft(item, { reviewNote: event.target.value })}
                                  />
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {item.linked_transaction_id ? <Badge tone="neutral">Transaction linked</Badge> : null}
                                  {item.linked_debt_id ? <Badge tone="warning">{debtLookup.get(item.linked_debt_id) ?? "Debt linked"}</Badge> : null}
                                  {item.linked_fixed_bill_id ? <Badge tone="neutral">{fixedBillLookup.get(item.linked_fixed_bill_id) ?? "Fixed bill linked"}</Badge> : null}
                                  {item.linked_goal_id ? <Badge tone="success">{goalLookup.get(item.linked_goal_id) ?? "Goal linked"}</Badge> : null}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                title={importsView === "needs_review" ? "No rows need review" : "No processed imports yet"}
                message={importsView === "needs_review"
                  ? "Upload a PDF bank statement or switch months to review imported rows for a different period."
                  : "Approved, ignored, duplicate, and transfer rows will move here once they leave the review queue."}
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
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {[
                  ["all", "All"],
                  ["spend", "Spend"],
                  ["income", "Income"],
                  ["transfer", "Transfer"],
                  ["debt", "Debt Payoff"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                      quickFilter === value
                        ? "border-transparent bg-[var(--primary-color)] text-[var(--primary-contrast)]"
                        : "border-[var(--border-color)] bg-[var(--surface-color)] text-stone-600"
                    }`}
                    onClick={() => applyQuickFilter(value as "all" | "spend" | "income" | "transfer" | "debt")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Table
                tableClassName="table-fixed"
              headers={[
                <span className="inline-block w-20">Date</span>,
                sortableHeader("Description", "description"),
                <span className="inline-block w-[120px]">Category</span>,
                <span className="inline-block w-[100px]">Type</span>,
                <span className="inline-block w-[88px]">Amount</span>,
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
                    <td className="w-20 px-4 py-3 text-sm text-stone-600">{formatIsoDate(transaction.transactionDate)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-raf-ink">
                      <div className="truncate">{transaction.description}</div>
                    </td>
                    <td className="w-[120px] px-4 py-3 text-sm">
                      <Badge tone={categoryTone(categoryLabel)}>{categoryLabel}</Badge>
                    </td>
                    <td className="w-[100px] px-4 py-3 text-sm">
                      <Badge tone={directionTone(transaction.direction)}>{transaction.direction}</Badge>
                    </td>
                    <td className={`w-[88px] px-4 py-3 text-right text-sm font-semibold ${amountClassName(transaction.direction)}`}>
                      {formatCurrency(transaction.amount)}
                    </td>
                  </tr>
                );
              })}
              </Table>
            </>
          ) : (
            <EmptyState
              title="No transactions match these filters"
              message="Adjust the date range, bucket filter, or description search to widen the current view."
            />
          )
        ) : null}
      </Card>
    </PageShell>
  );
}
