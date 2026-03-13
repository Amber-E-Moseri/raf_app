import type { ApiErrorPayload } from "../lib/types";

const DEFAULT_API_BASE_PATH = "/api/v1";
const FALLBACK_ORIGIN = "http://localhost:3000";
const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_PATH;
const runtimeOrigin = typeof window !== "undefined" ? window.location.origin : FALLBACK_ORIGIN;
const API_BASE_URL = new URL(rawApiBaseUrl, runtimeOrigin).toString();
const API_ORIGIN = new URL(API_BASE_URL).origin;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  base?: "api" | "origin";
}

function buildUrl(
  path: string,
  params?: Record<string, string | number | null | undefined>,
  options?: RequestOptions,
) {
  const baseUrl = options?.base === "origin"
    ? `${API_ORIGIN}/`
    : (API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`);
  const normalizedPath = path.replace(/^\//, "");
  const url = new URL(normalizedPath, baseUrl);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value == null || value === "") {
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let data: T | ApiErrorPayload = {} as T;

  if (text) {
    try {
      data = JSON.parse(text) as T | ApiErrorPayload;
    } catch {
      throw new ApiError(response.status, "The server returned an unreadable response.");
    }
  }

  if (!response.ok) {
    const message = typeof (data as ApiErrorPayload).error === "string"
      ? (data as ApiErrorPayload).error
      : (data as ApiErrorPayload).error?.message ?? "Request failed";
    throw new ApiError(response.status, message);
  }

  return data as T;
}

async function performRequest(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(0, "Unable to reach the server. Check the API URL and try again.");
  }
}

export async function getJson<T>(
  path: string,
  params?: Record<string, string | number | null | undefined>,
  options?: RequestOptions,
): Promise<T> {
  const response = await performRequest(buildUrl(path, params, options), {
    headers: {
      "Content-Type": "application/json",
    },
  });

  return parseResponse<T>(response);
}

export async function postJson<T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
  options?: RequestOptions,
): Promise<T> {
  const response = await performRequest(buildUrl(path, undefined, options), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return parseResponse<T>(response);
}

export async function putJson<T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
  options?: RequestOptions,
): Promise<T> {
  const response = await performRequest(buildUrl(path, undefined, options), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return parseResponse<T>(response);
}
