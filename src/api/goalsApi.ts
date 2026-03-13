import type { GoalListResponse } from "../lib/types";
import { getJson } from "./client";

export function getGoals() {
  return getJson<GoalListResponse>("/goals");
}
