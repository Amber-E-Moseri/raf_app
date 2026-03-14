import type { Debt, DebtCreateRequest, DebtListResponse } from "../lib/types";
import { getJson, patchJson, postJson } from "./client";

export function getDebts() {
  return getJson<DebtListResponse>("/debts");
}

export function createDebt(payload: DebtCreateRequest) {
  return postJson<Debt>("/debts", payload);
}

export function updateDebt(debtId: string, payload: Partial<DebtCreateRequest> & { isActive?: boolean }) {
  return patchJson<Debt>(`/debts/${debtId}`, payload);
}
