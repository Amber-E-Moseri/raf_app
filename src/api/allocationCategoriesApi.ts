import type {
  AllocationCategoriesResponse,
  AllocationCategoriesWriteResponse,
  AllocationCategoryWriteItem,
} from "../lib/types";
import { SUPPORTED_CATEGORY_ENDPOINTS, SUPPORTED_CATEGORY_UPDATE_ENDPOINTS } from "../lib/constants";
import { ApiError, getJson, putJson } from "./client";

export async function getAllocationCategories() {
  let lastError: unknown = null;

  for (const endpoint of SUPPORTED_CATEGORY_ENDPOINTS) {
    try {
      const response = await getJson<AllocationCategoriesResponse>(endpoint);
      return response.items;
    } catch (error) {
      lastError = error;
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
    }
  }

  if (lastError instanceof ApiError) {
    throw lastError;
  }

  return [];
}

export async function saveAllocationCategories(items: AllocationCategoryWriteItem[]) {
  let lastError: unknown = null;

  for (const endpoint of SUPPORTED_CATEGORY_UPDATE_ENDPOINTS) {
    try {
      const response = await putJson<AllocationCategoriesWriteResponse>(endpoint, { items });
      return response.items;
    } catch (error) {
      lastError = error;
      if (!(error instanceof ApiError) || error.status !== 404) {
        throw error;
      }
    }
  }

  if (lastError instanceof ApiError) {
    throw lastError;
  }

  throw new Error("Allocation category update endpoint is not available.");
}
