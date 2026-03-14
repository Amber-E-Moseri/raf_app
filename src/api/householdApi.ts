import type { HouseholdSettings, HouseholdSettingsUpdateRequest } from "../lib/types";
import { getJson, patchJson } from "./client";

export function getHouseholdSettings() {
  return getJson<HouseholdSettings>("/household");
}

export function updateHouseholdSettings(payload: HouseholdSettingsUpdateRequest) {
  return patchJson<HouseholdSettings>("/household", payload);
}
