import { DEFAULT_HOUSEHOLD_ID } from "../lib/constants";
import type {
  BankStatementImportResponse,
  ImportedTransaction,
  ImportedTransactionListResponse,
  ImportClassificationPayload,
} from "../lib/types";
import { getJson, postForm, postJson } from "./client";

const importHeaders = {
  "x-household-id": DEFAULT_HOUSEHOLD_ID,
};

export function getImportedTransactions() {
  return getJson<ImportedTransactionListResponse>("/imports", undefined, {
    headers: importHeaders,
  });
}

export function importBankStatement(file: File) {
  const formData = new FormData();
  formData.set("file", file);

  return postForm<BankStatementImportResponse>("/imports/bank-statement", formData, undefined, {
    headers: importHeaders,
  });
}

export function ignoreImportedTransaction(importId: string, reviewNote?: string) {
  return postJson<ImportedTransaction>(`/imports/${importId}/ignore`, { review_note: reviewNote ?? "" }, undefined, {
    headers: importHeaders,
  });
}

export function classifyImportedTransaction(importId: string, payload: ImportClassificationPayload) {
  return postJson<ImportedTransaction>(`/imports/${importId}/classify`, payload, undefined, {
    headers: importHeaders,
  });
}
