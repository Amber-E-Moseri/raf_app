import type { FixedBillListResponse } from "../lib/types";
import { getJson } from "./client";

export function getFixedBills() {
  return getJson<FixedBillListResponse>("/household/fixed-bills");
}
