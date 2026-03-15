import type {
  ApplyMonthlyReviewResponse,
  DeleteMonthlyReviewResponse,
  MonthlyReviewListResponse,
  MonthlyReviewRequest,
  MonthlyReviewResponse,
} from "../lib/types";
import { deleteJson, getJson, postJson } from "./client";

export function createMonthlyReview(payload: MonthlyReviewRequest) {
  return postJson<MonthlyReviewResponse>("/monthly-reviews", payload);
}

export function applyMonthlyReview(payload: MonthlyReviewRequest) {
  return postJson<ApplyMonthlyReviewResponse>("/monthly-reviews/apply", payload);
}

export async function applyMonthlyReviewsInRange(
  reviewMonths: string[],
  notes?: string,
) {
  const results = [];

  for (const reviewMonth of reviewMonths) {
    const result = await applyMonthlyReview({
      reviewMonth,
      notes,
    });
    results.push(result);
  }

  return results;
}

export function getMonthlyReviews(params: { from: string; to: string }) {
  return getJson<MonthlyReviewListResponse>("/monthly-reviews", params);
}

export function deleteMonthlyReview(reviewId: string) {
  return deleteJson<DeleteMonthlyReviewResponse>(`/monthly-reviews/${reviewId}`);
}
