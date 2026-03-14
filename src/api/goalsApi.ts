import type { Goal, GoalCreateRequest, GoalListResponse, GoalUpdateRequest } from "../lib/types";
import { deleteJson, getJson, postJson, putJson } from "./client";

export function getGoals() {
  return getJson<GoalListResponse>("/goals");
}

export function createGoal(input: GoalCreateRequest) {
  return postJson<Goal>("/goals", input);
}

export function updateGoal(goalId: string, input: GoalUpdateRequest) {
  return putJson<Goal>(`/goals/${goalId}`, input);
}

export function deleteGoal(goalId: string) {
  return deleteJson<void>(`/goals/${goalId}`);
}
