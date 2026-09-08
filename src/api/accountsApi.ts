import type {
  AccountReconciliation,
  AccountReconciliationListResponse,
  FinancialAccount,
  FinancialAccountCreateRequest,
  FinancialAccountListResponse,
} from "../lib/types";
import { getJson, patchJson, postJson } from "./client";

export function getFinancialAccounts() {
  return getJson<FinancialAccountListResponse>("/financial-accounts");
}

export function createFinancialAccount(payload: FinancialAccountCreateRequest) {
  return postJson<FinancialAccount>("/financial-accounts", payload);
}

export function updateFinancialAccount(accountId: string, payload: Partial<FinancialAccountCreateRequest>) {
  return patchJson<FinancialAccount>(`/financial-accounts/${accountId}`, payload);
}

export function getAccountReconciliations(accountId: string) {
  return getJson<AccountReconciliationListResponse>(`/financial-accounts/${accountId}/reconciliations`);
}

export function createAccountReconciliation(
  accountId: string,
  payload: { reportedBalance: string; reportedAsOf?: string; source?: string; note?: string | null },
) {
  return postJson<AccountReconciliation>(`/financial-accounts/${accountId}/reconciliations`, payload);
}

export function resolveAccountReconciliation(
  accountId: string,
  reconciliationId: string,
  payload: { action: "accept_reported_balance" | "keep_recorded_balance" | "mark_reviewed"; note?: string | null },
) {
  return patchJson<AccountReconciliation>(
    `/financial-accounts/${accountId}/reconciliations/${reconciliationId}`,
    payload,
  );
}
