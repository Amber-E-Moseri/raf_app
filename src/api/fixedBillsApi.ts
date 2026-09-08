import type { FixedBillListResponse } from "../lib/types";
import { getJson, postJson } from "./client";

type FixedBillCreateRequest = {
  name: string;
  category_slug: string;
  expected_amount: string;
  due_day_of_month: number;
  active?: boolean;
};

type FixedBillResponse = FixedBillListResponse["items"][number];

export function getFixedBills() {
  return getJson<FixedBillListResponse>("/household/fixed-bills");
}

export function createFixedBill(payload: FixedBillCreateRequest) {
  return postJson<FixedBillResponse>("/household/fixed-bills", payload);
}
