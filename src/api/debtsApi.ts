import type { Debt, DebtCreateRequest, DebtListResponse } from "../lib/types";
import { getJson, postJson } from "./client";

export function getDebts() {
  return getJson<DebtListResponse>("/debts");
}

export function createDebt(payload: DebtCreateRequest) {
  return postJson<Debt>("/debts", payload);
}
