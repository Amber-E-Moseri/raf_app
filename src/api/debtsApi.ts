import type { Debt, DebtCreateRequest, DebtListResponse, DebtPaymentPaceAcknowledgement } from "../lib/types";
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

export function acknowledgePaceInsight(
  debtId: string,
  payload: {
    action: DebtPaymentPaceAcknowledgement["action"];
    paymentPeriodMonth: string;
    newMonthlyPayment?: string;
  },
) {
  return postJson<{ acknowledged: boolean; acknowledgement: DebtPaymentPaceAcknowledgement; debt: Debt }>(
    `/debts/${debtId}/pace-acknowledgement`,
    payload,
  );
}
