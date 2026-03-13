import type { HealthResponse } from "../lib/types";
import { getJson } from "./client";

export function getHealth() {
  return getJson<HealthResponse>("/health", undefined, { base: "origin" });
}
