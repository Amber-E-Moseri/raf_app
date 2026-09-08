import { getJson, postJson } from "./client";

export interface RemiChatResponse {
  reply: string;
  conversationId?: string;
  tier: "free" | "paid";
  tokensUsed: number;
}

export interface RemiConversation {
  id: string;
  title: string;
  createdAt: string;
}

export interface RemiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface RemiSummaryResponse {
  tier: "free" | "paid";
  month: string;
  summary: string;
  tokensUsed?: number;
  metrics: {
    avgMonthlyIncome: string;
    avgMonthlySpending: string;
    savingsRate: number | null;
    debtCount: number;
    goalCount: number;
  };
}

export function sendRemiMessage(message: string, conversationId?: string) {
  return postJson<RemiChatResponse>("remi/chat", { message, conversationId });
}

export function getRemiSummary(month?: string) {
  return getJson<RemiSummaryResponse>("remi/summary", month ? { month } : {});
}

export function listRemiConversations() {
  return getJson<{ conversations: RemiConversation[] }>("remi/conversations");
}

export function getRemiConversation(conversationId: string) {
  return getJson<{ conversation: RemiConversation; messages: RemiMessage[] }>(
    `remi/conversations/${conversationId}`,
  );
}
