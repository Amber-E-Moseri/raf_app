import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { createGoal, deleteGoal, getGoals, updateGoal } from "../api/goalsApi";
import { getImportedTransactions } from "../api/importsApi";
import { getDashboardReport } from "../api/reportsApi";
import { getTransactions } from "../api/transactionsApi";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { SuccessNotice } from "../components/feedback/SuccessNotice";
import { PageShell } from "../components/layout/PageShell";
import { usePeriod } from "../components/layout/PeriodProvider";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { useAsyncData } from "../hooks/useAsyncData";
import { formatCurrency } from "../lib/format";
import type { AllocationCategory, Goal, GoalProgress, ImportedTransaction, Transaction } from "../lib/types";

interface GoalsViewModel {
  categories: AllocationCategory[];
  goals: Goal[];
  progress: GoalProgress[];
  transactions: Transaction[];
  imports: ImportedTransaction[];
}

interface GoalFormState {
  name: string;
  bucketId: string;
  targetAmount: string;
  targetDate: string;
  notes: string;
  active: boolean;
}

interface GoalActivityItem {
  id: string;
  date: string;
  description: string;
  amount: string;
  direction: "credit" | "debit";
  source: "transaction" | "pdf_import";
}

const EMPTY_GOAL_FORM: GoalFormState = {
  name: "",
  bucketId: "",
  targetAmount: "",
  targetDate: "",
  notes: "",
  active: true,
};

const GOAL_REACHED_STORAGE_KEY = "raf_goal_reached_state";

function mapGoalToForm(goal: Goal): GoalFormState {
  return {
    name: goal.name,
    bucketId: goal.bucket_id,
    targetAmount: goal.target_amount,
    targetDate: goal.target_date ?? "",
    notes: goal.notes ?? "",
    active: goal.active !== false,
  };
}

function toGoalPayload(form: GoalFormState) {
  return {
    bucket_id: form.bucketId,
    name: form.name.trim(),
    target_amount: form.targetAmount.trim(),
    target_date: form.targetDate.trim() ? form.targetDate : null,
    notes: form.notes.trim() ? form.notes.trim() : null,
    active: form.active,
  };
}

function goalStatusTone(progress: GoalProgress | null) {
  if (!progress) {
    return "warning";
  }

  const remaining = Number(progress.remaining_amount);
  if (remaining <= 0) {
    return "success";
  }
  if (progress.progress_percent >= 50) {
    return "neutral";
  }

  return "warning";
}

function goalStatusLabel(progress: GoalProgress | null) {
  if (!progress) {
    return "Nothing saved yet";
  }

  const remaining = Number(progress.remaining_amount);
  if (remaining <= 0) {
    return "Target reached";
  }
  if (progress.progress_percent >= 50) {
    return "On the way";
  }
  return "Early progress";
}

export function Goals() {
  const { activeMonthLabel, activeRange } = usePeriod();
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [form, setForm] = useState<GoalFormState>(EMPTY_GOAL_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [celebratingGoalIds, setCelebratingGoalIds] = useState<Record<string, boolean>>({});
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const hasSyncedGoalState = useRef(false);

  const goalsData = useAsyncData<GoalsViewModel>(async () => {
    const [categories, goalsResponse, dashboard, transactions, imports] = await Promise.all([
      getAllocationCategories(),
      getGoals(),
      getDashboardReport({ from: activeRange.from, to: activeRange.to }),
      getTransactions({ from: activeRange.from, to: activeRange.to, limit: 100 }),
      getImportedTransactions(),
    ]);

    return {
      categories: categories.filter((category) => category.isActive !== false),
      goals: goalsResponse.items,
      progress: dashboard.goal_progress,
      transactions: transactions.items,
      imports: imports.items,
    };
  }, [activeRange.from, activeRange.to]);

  const categoryLookup = useMemo(
    () => new Map((goalsData.data?.categories ?? []).map((category) => [category.id, category])),
    [goalsData.data?.categories],
  );

  const progressLookup = useMemo(
    () => new Map((goalsData.data?.progress ?? []).map((progress) => [progress.goal_id, progress])),
    [goalsData.data?.progress],
  );

  const activeGoals = useMemo(
    () => (goalsData.data?.goals ?? []).filter((goal) => goal.active !== false),
    [goalsData.data?.goals],
  );

  const archivedGoals = useMemo(
    () => (goalsData.data?.goals ?? []).filter((goal) => goal.active === false),
    [goalsData.data?.goals],
  );

  const recentActivityByGoalId = useMemo(() => {
    const grouped = new Map<string, GoalActivityItem[]>();
    const importedTransactionIds = new Set(
      (goalsData.data?.imports ?? [])
        .map((item) => item.linked_transaction_id)
        .filter((value): value is string => Boolean(value)),
    );

    for (const transaction of goalsData.data?.transactions ?? []) {
      if (!transaction.categoryId) {
        continue;
      }

      const matchingGoals = activeGoals.filter((goal) => goal.bucket_id === transaction.categoryId);
      if (!matchingGoals.length) {
        continue;
      }

      for (const goal of matchingGoals) {
        const current = grouped.get(goal.id) ?? [];
        current.push({
          id: transaction.id,
          date: transaction.transactionDate,
          description: transaction.description,
          amount: transaction.amount,
          direction: transaction.direction,
          source: importedTransactionIds.has(transaction.id) ? "pdf_import" : "transaction",
        });
        grouped.set(goal.id, current);
      }
    }

    for (const importedRow of goalsData.data?.imports ?? []) {
      if (importedRow.linked_goal_id == null || importedRow.status === "ignored") {
        continue;
      }

      const current = grouped.get(importedRow.linked_goal_id) ?? [];
      if (!importedRow.linked_transaction_id || !current.some((item) => item.id === importedRow.linked_transaction_id)) {
        current.push({
          id: importedRow.id,
          date: importedRow.date,
          description: importedRow.description,
          amount: importedRow.amount,
          direction: Number(importedRow.amount) >= 0 ? "credit" : "debit",
          source: "pdf_import",
        });
        grouped.set(importedRow.linked_goal_id, current);
      }
    }

    for (const [goalId, items] of grouped.entries()) {
      grouped.set(goalId, [...items].sort((left, right) => (
        right.date.localeCompare(left.date) || right.id.localeCompare(left.id)
      )));
    }

    return grouped;
  }, [activeGoals, goalsData.data?.imports, goalsData.data?.transactions]);

  const canSubmit = form.name.trim() && form.bucketId && form.targetAmount.trim();

  useEffect(() => {
    if (!editingGoalId && !form.bucketId && goalsData.data?.categories.length) {
      setForm((current) => ({
        ...current,
        bucketId: current.bucketId || goalsData.data.categories[0].id,
      }));
    }
  }, [editingGoalId, form.bucketId, goalsData.data?.categories]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyPreference = () => setPrefersReducedMotion(mediaQuery.matches);
    applyPreference();
    mediaQuery.addEventListener?.("change", applyPreference);

    return () => {
      mediaQuery.removeEventListener?.("change", applyPreference);
    };
  }, []);

  useEffect(() => {
    if (!goalsData.data) {
      return;
    }

    const currentReachedState = Object.fromEntries(
      activeGoals.map((goal) => {
        const progress = progressLookup.get(goal.id);
        return [goal.id, (progress?.progress_percent ?? 0) >= 100];
      }),
    );

    if (typeof window === "undefined") {
      return;
    }

    let storedReachedState: Record<string, boolean> = {};
    try {
      const raw = window.localStorage.getItem(GOAL_REACHED_STORAGE_KEY);
      if (raw) {
        storedReachedState = JSON.parse(raw) as Record<string, boolean>;
      }
    } catch {
      storedReachedState = {};
    }

    if (!hasSyncedGoalState.current) {
      hasSyncedGoalState.current = true;
      window.localStorage.setItem(
        GOAL_REACHED_STORAGE_KEY,
        JSON.stringify({ ...storedReachedState, ...currentReachedState }),
      );
      return;
    }

    const newlyReachedGoalIds = activeGoals
      .map((goal) => goal.id)
      .filter((goalId) => currentReachedState[goalId] === true && storedReachedState[goalId] !== true);

    if (newlyReachedGoalIds.length && !prefersReducedMotion) {
      setCelebratingGoalIds((current) => ({
        ...current,
        ...Object.fromEntries(newlyReachedGoalIds.map((goalId) => [goalId, true])),
      }));

      const timeoutId = window.setTimeout(() => {
        setCelebratingGoalIds((current) => {
          const next = { ...current };
          newlyReachedGoalIds.forEach((goalId) => {
            delete next[goalId];
          });
          return next;
        });
      }, 1400);

      window.localStorage.setItem(
        GOAL_REACHED_STORAGE_KEY,
        JSON.stringify({ ...storedReachedState, ...currentReachedState }),
      );

      return () => window.clearTimeout(timeoutId);
    }

    window.localStorage.setItem(
      GOAL_REACHED_STORAGE_KEY,
      JSON.stringify({ ...storedReachedState, ...currentReachedState }),
    );

    return undefined;
  }, [activeGoals, goalsData.data, prefersReducedMotion, progressLookup]);

  function resetForm() {
    setEditingGoalId(null);
    setForm({
      ...EMPTY_GOAL_FORM,
      bucketId: goalsData.data?.categories[0]?.id ?? "",
    });
    setSaveError(null);
  }

  function startEdit(goal: Goal) {
    setEditingGoalId(goal.id);
    setForm(mapGoalToForm(goal));
    setSaveError(null);
    setSaveMessage(null);
  }

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      if (editingGoalId) {
        await updateGoal(editingGoalId, toGoalPayload(form));
        setSaveMessage("Goal updated.");
      } else {
        await createGoal(toGoalPayload(form));
        setSaveMessage("Goal created.");
      }
      resetForm();
      await goalsData.reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Goal changes could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleArchive(goalId: string) {
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      await deleteGoal(goalId);
      setSaveMessage("Goal archived.");
      if (editingGoalId === goalId) {
        resetForm();
      }
      await goalsData.reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Goal could not be archived.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnarchive(goalId: string) {
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      await updateGoal(goalId, { active: true });
      setSaveMessage("Goal restored.");
      await goalsData.reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Goal could not be restored.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(goalId: string) {
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      await deleteGoal(goalId);
      setSaveMessage("Goal deleted.");
      if (editingGoalId === goalId) {
        resetForm();
      }
      await goalsData.reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Goal could not be deleted.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <PageShell
      eyebrow="Planning"
      title="Goals"
      description={`Track savings goals for ${activeMonthLabel}.`}
    >
      {goalsData.isLoading ? <LoadingState label="Loading goals..." /> : null}
      {!goalsData.isLoading && goalsData.error ? (
        <ErrorState
          title="Failed to load goals"
          message={goalsData.error}
          onRetry={() => void goalsData.reload()}
        />
      ) : null}
      {saveError ? <ErrorState title="Goal update failed" message={saveError} /> : null}
      {saveMessage ? <SuccessNotice title="Goals updated" message={saveMessage} /> : null}

      {!goalsData.isLoading && !goalsData.error && goalsData.data ? (
        <section className="grid gap-4 xl:grid-cols-[1.4fr,0.9fr]">
          <div className="space-y-4">
            <Card title="Goal Planning" subtitle="Track simple savings targets connected to your planning buckets.">
              {activeGoals.length ? (
                <div className="space-y-3">
                  {activeGoals.map((goal) => {
                    const progress = progressLookup.get(goal.id) ?? null;
                    const category = categoryLookup.get(goal.bucket_id);
                    const recentTransactions = (recentActivityByGoalId.get(goal.id) ?? []).slice(0, 5);
                    const progressPercent = Math.max(0, Math.min(progress?.progress_percent ?? 0, 100));
                    const isReached = (progress?.progress_percent ?? 0) >= 100;
                    const isCelebrating = celebratingGoalIds[goal.id] === true;

                    return (
                      <div
                        key={goal.id}
                        className={`relative overflow-hidden rounded-[1.5rem] border p-5 ${isReached ? "goal-reached-card" : ""}`}
                        style={{ background: "var(--surface-plain)", borderColor: "var(--border-color)" }}
                      >
                        {isCelebrating ? (
                          <div className="goal-celebration" aria-hidden="true">
                            {Array.from({ length: 10 }).map((_, index) => (
                              <span
                                // eslint-disable-next-line react/no-array-index-key
                                key={index}
                                className="goal-burst"
                                style={{
                                  "--goal-angle": `${index * 36}deg`,
                                  "--goal-delay": `${index * 0.03}s`,
                                } as CSSProperties}
                              />
                            ))}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-semibold text-[var(--text-strong)]">{goal.name}</h3>
                              <Badge tone={goalStatusTone(progress)}>{goalStatusLabel(progress)}</Badge>
                            </div>
                            <p className="mt-2 text-sm text-[var(--text-muted)]">
                              Linked bucket: {category?.label ?? progress?.bucket_name ?? goal.bucket_id}
                            </p>
                            {progress?.bucket_balance ? (
                              <p className="mt-1 text-sm text-[var(--text-muted)]">Bucket balance: {formatCurrency(progress.bucket_balance)}</p>
                            ) : null}
                            {goal.target_date ? (
                              <p className="mt-1 text-sm text-[var(--text-muted)]">Target date: {goal.target_date}</p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="secondary" onClick={() => startEdit(goal)}>
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              className="bg-[var(--surface-plain)] text-[var(--text-muted)] hover:bg-[var(--surface-elevated)]"
                              disabled={isSaving}
                              onClick={() => void handleArchive(goal.id)}
                            >
                              Archive
                            </Button>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-[var(--border-color)] p-4" style={{ background: "var(--surface-plain)" }}>
                            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Target amount</div>
                            <div className="mt-2 text-xl font-semibold text-[var(--text-strong)]">{formatCurrency(goal.target_amount)}</div>
                          </div>
                          <div className="rounded-2xl border border-[var(--border-color)] p-4" style={{ background: "var(--surface-plain)" }}>
                            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Paid so far</div>
                            <div className="mt-2 text-xl font-semibold text-[var(--text-strong)]">
                              {formatCurrency(progress?.current_amount ?? "0.00")}
                            </div>
                          </div>
                        </div>

                        <div className="mt-5">
                          <div className="mb-2 flex items-center justify-between text-sm text-[var(--text-muted)]">
                            <span>Progress</span>
                            <span>{progressPercent.toFixed(0)}%</span>
                          </div>
                          <div
                            className="h-2 overflow-hidden rounded-full"
                            style={{ background: "var(--surface-elevated)" }}
                          >
                            <div
                              className="h-full rounded-full bg-[var(--primary-color)] transition-[width] duration-200"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        </div>

                        <div className="mt-5 rounded-2xl border border-[var(--border-color)] p-4" style={{ background: "var(--surface-plain)" }}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Recent transactions</div>
                            <div className="text-xs text-[var(--text-muted)]">Latest 5 in this bucket</div>
                          </div>
                          {recentTransactions.length ? (
                            <div className="mt-3 space-y-2">
                              {recentTransactions.map((transaction) => (
                                <div
                                  key={transaction.id}
                                  className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] pb-2 last:border-b-0 last:pb-0"
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-[var(--text-strong)]">{transaction.description}</div>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                                      <span>{transaction.date}</span>
                                      {transaction.source === "pdf_import" ? <span>PDF import</span> : null}
                                    </div>
                                  </div>
                                  <div className={`shrink-0 text-sm font-semibold ${transaction.direction === "credit" ? "text-emerald-700" : "text-rose-700"}`}>
                                    {transaction.direction === "credit" ? "+" : "-"}
                                    {formatCurrency(transaction.amount)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-sm text-[var(--text-muted)]">No transactions in this bucket for {activeMonthLabel}.</p>
                          )}
                        </div>

                        {goal.notes ? (
                          <p className="mt-4 text-sm italic text-[var(--text-muted)]">{goal.notes}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : goalsData.data.categories.length ? (
                <EmptyState
                  title="No goals yet"
                  message="Create a goal to track progress toward a savings target."
                />
              ) : (
                <EmptyState
                  title="Set up allocation first"
                  message="Goals are linked to allocation buckets, so add at least one active bucket before creating a goal."
                />
              )}
            </Card>

            {archivedGoals.length ? (
              <Card title="Archived Goals" subtitle="Archived goals stay visible for reference but are no longer part of active planning.">
                <div className="space-y-3">
                  {archivedGoals.map((goal) => {
                    const category = categoryLookup.get(goal.bucket_id);
                    return (
                      <div key={goal.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-color)] px-4 py-3" style={{ background: "var(--surface-plain)" }}>
                        <div>
                          <div className="font-medium text-[var(--text-strong)]">{goal.name}</div>
                          <div className="mt-1 text-sm text-[var(--text-muted)]">
                            Linked bucket: {category?.label ?? goal.bucket_id} - Target {formatCurrency(goal.target_amount)}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="neutral">Archived</Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-8 rounded-full bg-[var(--badge-neutral-bg)] px-3 py-1 text-xs text-[var(--badge-neutral-text)] ring-1 ring-[var(--badge-neutral-ring)] hover:bg-[var(--badge-neutral-bg)]"
                            disabled={isSaving}
                            onClick={() => void handleUnarchive(goal.id)}
                          >
                            Unarchive
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="min-h-8 rounded-full px-3 py-1 text-xs text-rose-600 hover:bg-rose-50"
                            disabled={isSaving}
                            onClick={() => void handleDelete(goal.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ) : null}
          </div>

          <div className="space-y-4">
            <Card
              title={editingGoalId ? "Edit Goal" : "Create Goal"}
              subtitle={editingGoalId
                ? "Update the target, linked bucket, or notes for this goal."
                : "Create a simple savings target linked to one planning bucket."}
            >
              {goalsData.data.categories.length ? (
                <div className="space-y-4">
                  <Input
                    label="Goal name"
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Vacation Fund"
                  />

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium tracking-[0.01em] text-[var(--text-strong)]">Linked bucket</span>
                    <select
                      className="ui-field"
                      value={form.bucketId}
                      onChange={(event) => setForm((current) => ({ ...current, bucketId: event.target.value }))}
                    >
                      <option value="" disabled>Select a bucket</option>
                      {goalsData.data.categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.label}</option>
                      ))}
                    </select>
                  </label>

                  <Input
                    label="Target amount"
                    value={form.targetAmount}
                    onChange={(event) => setForm((current) => ({ ...current, targetAmount: event.target.value }))}
                    placeholder="2500.00"
                    inputMode="decimal"
                  />

                  <Input
                    label="Target date"
                    type="date"
                    value={form.targetDate}
                    onChange={(event) => setForm((current) => ({ ...current, targetDate: event.target.value }))}
                  />

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium tracking-[0.01em] text-[var(--text-strong)]">Notes</span>
                    <textarea
                      className="ui-field min-h-28 resize-y"
                      value={form.notes}
                      onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Optional planning note or reminder."
                    />
                  </label>

                  <label className="flex items-center justify-between rounded-2xl border border-[var(--border-color)] px-4 py-3 text-sm text-[var(--text-strong)]" style={{ background: "var(--surface-plain)" }}>
                    <span>Keep this goal active</span>
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                    />
                  </label>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={resetForm}>
                      {editingGoalId ? "Cancel" : "Clear"}
                    </Button>
                    <Button type="button" disabled={!canSubmit || isSaving} onClick={() => void handleSubmit()}>
                      {isSaving ? "Saving..." : editingGoalId ? "Save Goal" : "Create Goal"}
                    </Button>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="No active buckets available"
                  message="Goals can be created after allocation buckets are configured."
                />
              )}
            </Card>

            <Card title="Planning Notes" subtitle="Goals help you track savings progress without moving money outside RAF.">
              <div className="space-y-3 text-sm text-[var(--text-muted)]">
                <p>Saved so far reflects how much is currently sitting in the linked bucket for this snapshot.</p>
                <p>If the bucket grows past the target, the goal stays at 100% and the extra money simply remains in that bucket.</p>
                <p>Use goals as simple savings targets connected to your allocation plan.</p>
              </div>
            </Card>
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
