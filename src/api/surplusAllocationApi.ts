import type {
  SurplusAllocationPreference,
  SurplusAllocationPreferencesResponse,
  SurplusAllocationPreferenceWriteItem,
} from "../lib/types";
import { getJson, putJson } from "./client";

const SURPLUS_ENDPOINT = "/household/surplus-splits";

export async function getSurplusAllocationPreferences() {
  const response = await getJson<SurplusAllocationPreferencesResponse>(SURPLUS_ENDPOINT);
  return response.items;
}

export async function saveSurplusAllocationPreferences(items: SurplusAllocationPreferenceWriteItem[]) {
  const response = await putJson<SurplusAllocationPreferencesResponse>(SURPLUS_ENDPOINT, { items });
  return response.items as SurplusAllocationPreference[];
}
