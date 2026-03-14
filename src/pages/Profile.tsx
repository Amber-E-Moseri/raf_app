import { useEffect, useMemo, useState } from "react";

import { getAllocationCategories } from "../api/allocationCategoriesApi";
import { ApiError } from "../api/client";
import { getGoals } from "../api/goalsApi";
import { getMonthlyReviews } from "../api/monthlyReviewApi";
import { getDashboardReport } from "../api/reportsApi";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { PageShell } from "../components/layout/PageShell";
import { usePeriod } from "../components/layout/PeriodProvider";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getGoalAchievementBadges,
  getGoalsAchievedCount,
  readGoalAchievements,
  syncGoalAchievements,
  writeGoalAchievements,
} from "../lib/goalAchievements";
import { formatCurrency } from "../lib/format";
import type { AllocationCategory, Goal, GoalProgress } from "../lib/types";

interface ProfileViewModel {
  categories: AllocationCategory[];
  allocationCount: number;
  activeAllocationCount: number;
  goalCount: number;
  monthlyReviewCount: number;
  goals: Goal[];
  goalProgress: GoalProgress[];
}

interface CompletedGoalSummary {
  goal: Goal;
  progress: GoalProgress;
  completedAt: string;
  categoryLabel: string;
  milestonesCompleted: number;
  badges: Array<{ label: string; tone: "success" | "neutral" }>;
}

function completedMilestones(progressPercent: number) {
  return [25, 50, 100].filter((threshold) => progressPercent >= threshold).length;
}

export function Profile() {
  const { activeRange } = usePeriod();
  const { data, error, isLoading, reload } = useAsyncData<ProfileViewModel>(async () => {
    const currentYear = new Date().getFullYear();
    const [categories, goalsResponse, monthlyReviewsResponse, dashboard] = await Promise.all([
      getAllocationCategories().catch((requestError) => {
        if (requestError instanceof ApiError && requestError.status === 404) {
          return [];
        }

        throw requestError;
      }),
      getGoals(),
      getMonthlyReviews({
        from: `${currentYear}-01-01`,
        to: `${currentYear}-12-01`,
      }),
      getDashboardReport({ from: activeRange.from, to: activeRange.to }),
    ]);

    return {
      categories,
      allocationCount: categories.length,
      activeAllocationCount: categories.filter((item) => item.isActive !== false).length,
      goalCount: goalsResponse.items.length,
      monthlyReviewCount: monthlyReviewsResponse.items.length,
      goals: goalsResponse.items,
      goalProgress: dashboard.goal_progress,
    };
  }, [activeRange.from, activeRange.to]);

  const [goalAchievementState, setGoalAchievementState] = useState(() => readGoalAchievements());

  useEffect(() => {
    if (!data) {
      return;
    }

    const { state } = syncGoalAchievements(data.goalProgress, readGoalAchievements());
    writeGoalAchievements(state);
    setGoalAchievementState(state);
  }, [data]);

  const goalsAchievedCount = data ? getGoalsAchievedCount(data.goals, goalAchievementState) : 0;
  const goalAchievementBadges = data ? getGoalAchievementBadges(data.goals, goalAchievementState) : [];
  const completedGoals = useMemo<CompletedGoalSummary[]>(() => {
    if (!data) {
      return [];
    }

    const categoryLookup = new Map(data.categories.map((category) => [category.id, category.label]));
    const progressLookup = new Map(data.goalProgress.map((progress) => [progress.goal_id, progress]));
    const completedEntries = Object.entries(goalAchievementState)
      .filter(([goalId]) => data.goals.some((goal) => goal.id === goalId))
      .map(([goalId, achievement]) => {
        const goal = data.goals.find((item) => item.id === goalId);
        const progress = progressLookup.get(goalId);

        if (!goal || !progress || progress.progress_percent < 100) {
          return null;
        }

        const goalBadges: Array<{ label: string; tone: "success" | "neutral" }> = [];
        const earliestCompletedGoalId = Object.entries(goalAchievementState)
          .sort((left, right) => left[1].completed_at.localeCompare(right[1].completed_at))[0]?.[0];

        if (goalId === earliestCompletedGoalId) {
          goalBadges.push({ label: "First Goal Completed", tone: "success" });
        }

        if (goal.name.toLowerCase().includes("emergency fund")) {
          goalBadges.push({ label: "Emergency Fund Secured", tone: "neutral" });
        }

        if (!goalBadges.length) {
          goalBadges.push({ label: "Target Reached", tone: "success" });
        }

        return {
          goal,
          progress,
          completedAt: achievement.completed_at,
          categoryLabel: categoryLookup.get(goal.bucket_id) ?? progress.bucket_name ?? goal.bucket_id,
          milestonesCompleted: completedMilestones(progress.progress_percent),
          badges: goalBadges,
        };
      })
      .filter((item): item is CompletedGoalSummary => item !== null)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt));

    return completedEntries;
  }, [data, goalAchievementState]);
  const completedMilestonesCount = completedGoals.reduce((total, item) => total + item.milestonesCompleted, 0);

  return (
    <PageShell
      eyebrow="Profile"
      title="Profile"
      description="Account and planning summary placeholders for future profile features."
    >
      {isLoading ? <LoadingState label="Loading profile overview..." /> : null}
      {!isLoading && error ? (
        <ErrorState
          title="Failed to load profile"
          message={error}
          onRetry={() => void reload()}
        />
      ) : null}
      {!isLoading && !error && data ? (
        <section className="grid gap-4">
          <Card title="User Information" subtitle="Current placeholder content until account profile APIs are connected.">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-raf-ink">Jane Doe</h2>
                <p className="mt-1 text-sm text-stone-500">Local RAF profile placeholder</p>
              </div>
              <Badge tone="neutral">Profile placeholder</Badge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">Household</p>
                <p className="mt-2 text-sm font-medium text-raf-ink">Local RAF Household</p>
                <p className="mt-1 text-sm text-stone-500">Household/account details can be surfaced here when backend profile data exists.</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-stone-500">Account</p>
                <p className="mt-2 text-sm font-medium text-raf-ink">Google-auth account placeholder</p>
                <p className="mt-1 text-sm text-stone-500">Connected user details are not available in the current frontend contract.</p>
              </div>
            </div>
          </Card>

          <section className="grid gap-4 md:grid-cols-3">
            <Card title="Monthly Review" subtitle="Planning summary placeholder.">
              <p className="text-2xl font-bold tracking-tight text-raf-ink">{data.monthlyReviewCount}</p>
              <p className="mt-2 text-sm text-stone-500">Saved monthly reviews this year</p>
            </Card>
            <Card title="Allocations" subtitle="Current allocation setup summary.">
              <p className="text-2xl font-bold tracking-tight text-raf-ink">{data.activeAllocationCount}</p>
              <p className="mt-2 text-sm text-stone-500">{data.allocationCount} total buckets configured</p>
            </Card>
            <Card title="Goals" subtitle="Goal planning placeholder.">
              <p className="text-2xl font-bold tracking-tight text-raf-ink">{data.goalCount}</p>
              <p className="mt-2 text-sm text-stone-500">Active and planned goals currently tracked</p>
            </Card>
          </section>

          <Card title="Goals Achieved" subtitle="Completed goal milestones and unlocked achievements.">
            {completedGoals.length ? (
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-[var(--border-color)] p-4" style={{ background: "var(--surface-plain)" }}>
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Goals achieved</div>
                    <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--text-strong)]">{goalsAchievedCount}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-color)] p-4" style={{ background: "var(--surface-plain)" }}>
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Achievements unlocked</div>
                    <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--text-strong)]">{goalAchievementBadges.length}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-color)] p-4" style={{ background: "var(--surface-plain)" }}>
                    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Milestones completed</div>
                    <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--text-strong)]">{completedMilestonesCount}</div>
                  </div>
                </div>

                <div className="space-y-3">
                  {completedGoals.map((item) => (
                    <div
                      key={item.goal.id}
                      className="rounded-2xl border border-[var(--border-color)] p-4 shadow-sm"
                      style={{ background: "var(--surface-plain)" }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-base font-semibold text-[var(--text-strong)]">{item.goal.name}</div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge tone="neutral">{item.categoryLabel}</Badge>
                            {item.badges.map((badge) => (
                              <Badge key={`${item.goal.id}-${badge.label}`} tone={badge.tone}>{badge.label}</Badge>
                            ))}
                          </div>
                        </div>
                        <Badge tone="success">Target Reached</Badge>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr,1.2fr,0.8fr]">
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Target amount</div>
                          <div className="mt-1 text-lg font-semibold text-[var(--text-strong)]">{formatCurrency(item.goal.target_amount)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Progress achieved</div>
                          <div className="mt-1 text-lg font-semibold text-[var(--text-strong)]">
                            {formatCurrency(item.progress.current_amount)} / {formatCurrency(item.goal.target_amount)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Milestones completed</div>
                          <div className="mt-1 text-lg font-semibold text-[var(--text-strong)]">{item.milestonesCompleted} of 3</div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div
                          className="h-2 overflow-hidden rounded-full"
                          style={{ background: "var(--surface-elevated)" }}
                        >
                          <div
                            className="h-full rounded-full bg-[var(--primary-color)]"
                            style={{ width: `${Math.min(item.progress.progress_percent, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                title="No goals achieved yet"
                message="Complete a savings goal to unlock your first achievement."
              />
            )}
          </Card>
        </section>
      ) : null}
      {!isLoading && !error && !data ? (
        <EmptyState
          title="No profile data yet"
          message="Profile details and planning summaries will appear here as more account data becomes available."
        />
      ) : null}
    </PageShell>
  );
}
