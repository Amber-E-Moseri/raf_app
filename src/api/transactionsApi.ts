import type { Transaction, TransactionCreateRequest, TransactionListResponse } from "../lib/types";
import { getJson, postJson } from "./client";

export interface TransactionsQuery {
  from: string;
  to: string;
  categoryId?: string | null;
  cursor?: string | null;
  limit?: number;
}

export function getTransactions(query: TransactionsQuery) {
  return getJson<TransactionListResponse>("/transactions", query);
}

export function createTransaction(payload: TransactionCreateRequest) {
  return postJson<Transaction>("/transactions", payload);
}
