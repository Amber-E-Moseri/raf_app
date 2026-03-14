import type { Goal, GoalProgress } from "./types";

export interface GoalAchievementRecord {
  completed_at: string;
  celebration_unseen: boolean;
}

export interface GoalAchievementBadge {
  id: string;
  label: string;
}

const GOAL_ACHIEVEMENTS_STORAGE_KEY = "raf_goal_achievements";

type GoalAchievementState = Record<string, GoalAchievementRecord>;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readGoalAchievements(): GoalAchievementState {
  if (!canUseStorage()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(GOAL_ACHIEVEMENTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as GoalAchievementState;
  } catch {
    return {};
  }
}

export function writeGoalAchievements(state: GoalAchievementState) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(GOAL_ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(state));
}

export function syncGoalAchievements(progressItems: GoalProgress[], existingState: GoalAchievementState) {
  const nextState = { ...existingState };
  const newlyCompletedGoalIds: string[] = [];
  const now = new Date().toISOString();

  for (const progress of progressItems) {
    if ((progress.progress_percent ?? 0) < 100) {
      continue;
    }

    if (!nextState[progress.goal_id]) {
      nextState[progress.goal_id] = {
        completed_at: now,
        celebration_unseen: true,
      };
      newlyCompletedGoalIds.push(progress.goal_id);
    }
  }

  return {
    state: nextState,
    newlyCompletedGoalIds,
  };
}

export function markGoalCelebrationSeen(goalId: string, existingState: GoalAchievementState) {
  if (!existingState[goalId]) {
    return existingState;
  }

  return {
    ...existingState,
    [goalId]: {
      ...existingState[goalId],
      celebration_unseen: false,
    },
  };
}

export function getGoalsAchievedCount(goals: Goal[], achievementState: GoalAchievementState) {
  const goalIds = new Set(goals.map((goal) => goal.id));
  return Object.keys(achievementState).filter((goalId) => goalIds.has(goalId)).length;
}

export function getGoalAchievementBadges(goals: Goal[], achievementState: GoalAchievementState): GoalAchievementBadge[] {
  const completedGoals = goals.filter((goal) => achievementState[goal.id]);
  const badges: GoalAchievementBadge[] = [];

  if (completedGoals.length >= 1) {
    badges.push({ id: "first_goal", label: "First Goal Completed" });
  }

  if (completedGoals.some((goal) => goal.name.toLowerCase().includes("emergency fund"))) {
    badges.push({ id: "emergency_fund", label: "Emergency Fund Secured" });
  }

  if (completedGoals.length >= 5) {
    badges.push({ id: "five_goals", label: "5 Goals Achieved" });
  }

  return badges;
}
