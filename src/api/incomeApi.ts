import type {
  IncomeAllocationReport,
  IncomeCreateRequest,
  IncomeCreateResponse,
  IncomeListResponse,
} from "../lib/types";
import { getJson, postJson } from "./client";

export function createIncome(payload: IncomeCreateRequest, idempotencyKey?: string) {
  return postJson<IncomeCreateResponse>("/income", payload, idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined);
}

export function getIncome(params: { from: string; to: string }) {
  return getJson<IncomeListResponse>("/income", params);
}

export function getIncomeAllocations(incomeId: string) {
  return getJson<IncomeAllocationReport>("/reports/income-allocations", { incomeId });
}
