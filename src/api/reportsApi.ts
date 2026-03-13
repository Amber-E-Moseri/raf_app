import type {
  DashboardReport,
  FinancialHealthReport,
  SurplusRecommendationsReport,
} from "../lib/types";
import { getJson } from "./client";

export function getDashboardReport(params: { from: string; to: string }) {
  return getJson<DashboardReport>("/reports/dashboard", params);
}

export function getFinancialHealthReport() {
  return getJson<FinancialHealthReport>("/reports/financial-health");
}

export function getSurplusRecommendations(month: string) {
  return getJson<SurplusRecommendationsReport>("/reports/surplus-recommendations", { month });
}
