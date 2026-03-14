import { useEffect, useMemo, useState } from "react";

import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { createGoal, deleteGoal, getGoals, updateGoal } from "../api/goalsApi";
import { getDashboardReport } from "../api/reportsApi";
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
import type { AllocationCategory, Goal, GoalProgress } from "../lib/types";

interface GoalsViewModel {
  categories: AllocationCategory[];
  goals: Goal[];
  progress: GoalProgress[];
}

interface GoalFormState {
  name: string;
  bucketId: string;
  targetAmount: string;
  targetDate: string;
  notes: string;
  active: boolean;
}

const EMPTY_GOAL_FORM: GoalFormState = {
  name: "",
  bucketId: "",
  targetAmount: "",
  targetDate: "",
  notes: "",
  active: true,
};

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
    return "No reserved balance";
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

  const goalsData = useAsyncData<GoalsViewModel>(async () => {
    const [categories, goalsResponse, dashboard] = await Promise.all([
      getAllocationCategories(),
      getGoals(),
      getDashboardReport({ from: activeRange.from, to: activeRange.to }),
    ]);

    return {
      categories: categories.filter((category) => category.isActive !== false),
      goals: goalsResponse.items,
      progress: dashboard.goal_progress,
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

  const canSubmit = form.name.trim() && form.bucketId && form.targetAmount.trim();

  useEffect(() => {
    if (!editingGoalId && !form.bucketId && goalsData.data?.categories.length) {
      setForm((current) => ({
        ...current,
        bucketId: current.bucketId || goalsData.data.categories[0].id,
      }));
    }
  }, [editingGoalId, form.bucketId, goalsData.data?.categories]);

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

  return (
    <PageShell
      eyebrow="Planning"
      title="Goals"
      description={`Track reserved progress toward goals for ${activeMonthLabel}.`}
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
            <Card title="Goal Planning" subtitle="Goals are targets layered on top of allocation buckets. Reserved balances show how much is currently set aside toward each target.">
              {activeGoals.length ? (
                <div className="space-y-3">
                  {activeGoals.map((goal) => {
                    const progress = progressLookup.get(goal.id) ?? null;
                    const category = categoryLookup.get(goal.bucket_id);
                    const progressPercent = Math.max(0, Math.min(progress?.progress_percent ?? 0, 100));

                    return (
                      <div key={goal.id} className="rounded-[1.5rem] border border-[var(--border-color)] p-5" style={{ background: "var(--surface-plain)" }}>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-semibold text-[var(--text-strong)]">{goal.name}</h3>
                              <Badge tone={goalStatusTone(progress)}>{goalStatusLabel(progress)}</Badge>
                            </div>
                            <p className="mt-2 text-sm text-[var(--text-muted)]">
                              Linked bucket: {category?.label ?? progress?.bucket_name ?? goal.bucket_id}
                            </p>
                            {goal.target_date ? (
                              <p className="mt-1 text-sm text-[var(--text-muted)]">Target date: {goal.target_date}</p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="secondary" onClick={() => startEdit(goal)}>
                              Edit
                            </Button>
                            <Button type="button" variant="ghost" disabled={isSaving} onClick={() => void handleArchive(goal.id)}>
                              Archive
                            </Button>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-[var(--border-color)] p-4" style={{ background: "var(--surface-plain)" }}>
                            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Target amount</div>
                            <div className="mt-2 text-xl font-semibold text-[var(--text-strong)]">{formatCurrency(goal.target_amount)}</div>
                          </div>
                          <div className="rounded-2xl border border-[var(--border-color)] p-4" style={{ background: "var(--surface-plain)" }}>
                            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Reserved toward goal</div>
                            <div className="mt-2 text-xl font-semibold text-[var(--text-strong)]">{formatCurrency(progress?.reserved_amount ?? "0.00")}</div>
                          </div>
                          <div className="rounded-2xl border border-[var(--border-color)] p-4" style={{ background: "var(--surface-plain)" }}>
                            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Remaining</div>
                            <div className="mt-2 text-xl font-semibold text-[var(--text-strong)]">{formatCurrency(progress?.remaining_amount ?? goal.target_amount)}</div>
                          </div>
                        </div>

                        <div className="mt-5">
                          <div className="mb-2 flex items-center justify-between text-sm text-[var(--text-muted)]">
                            <span>Progress</span>
                            <span>{progressPercent.toFixed(0)}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-stone-200">
                            <div
                              className="h-full rounded-full bg-[var(--primary-color)] transition-[width] duration-200"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
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
                  message="Create a goal to track how much of a bucket is currently reserved toward a target."
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
                            {category?.label ?? goal.bucket_id} - Target {formatCurrency(goal.target_amount)}
                          </div>
                        </div>
                        <Badge tone="neutral">Archived</Badge>
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
                ? "Update the target, bucket link, or notes for this planning goal."
                : "Create a planning target on top of an allocation bucket."}
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

            <Card title="Planning Notes" subtitle="Goals track what is reserved inside RAF buckets.">
              <div className="space-y-3 text-sm text-[var(--text-muted)]">
                <p>Reserved toward goal reflects money currently sitting in the linked bucket for the selected period snapshot.</p>
                <p>It does not imply money was transferred outside RAF unless actual transactions show that movement.</p>
                <p>Use goals to track targets layered on top of your allocation plan, not as separate transfer accounts.</p>
              </div>
            </Card>
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
