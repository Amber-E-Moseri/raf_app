import type { Debt, DebtAdjustment, DebtCreateRequest, DebtListResponse, DebtPaymentPaceAcknowledgement } from "../lib/types";
import { deleteJson, getJson, patchJson, postJson } from "./client";

export function getDebts() {
  return getJson<DebtListResponse>("/debts");
}

export function createDebt(payload: DebtCreateRequest) {
  return postJson<Debt>("/debts", payload);
}

export function updateDebt(debtId: string, payload: Partial<DebtCreateRequest> & { isActive?: boolean }) {
  return patchJson<Debt>(`/debts/${debtId}`, payload);
}

export function deactivateDebt(debtId: string) {
  return patchJson<Debt>(`/debts/${debtId}`, { isActive: false });
}

export function deleteDebt(debtId: string) {
  return deleteJson<void>(`/debts/${debtId}`);
}

export function getDebtAdjustments(debtId: string) {
  return getJson<{ items: DebtAdjustment[] }>(`/debts/${debtId}/adjustments`);
}

export function createDebtAdjustment(debtId: string, payload: {
  amount: string;
  adjustmentType: string;
  effectiveDate: string;
  note?: string;
}) {
  return postJson<DebtAdjustment>(`/debts/${debtId}/adjustments`, payload);
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
