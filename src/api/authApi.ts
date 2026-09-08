import { deleteJson, getJson, postJson } from "./client";
import type { AuthSession } from "../context/AuthContext";

interface LoginResponse {
  userId: string;
  email: string;
  token: string | null;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number | null;
  households: Array<{ id: string; name: string; role: string }>;
  workspaces?: Array<{ id: string; name: string; type: string; role: string; status?: string }>;
}

interface SignupResponse {
  userId: string;
  email: string;
  token: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
  emailVerificationRequired?: boolean;
  household: { id: string; name: string; role: string };
  workspace?: { id: string; name: string; type: string; role: string; status?: string } | null;
  workspaces?: Array<{ id: string; name: string; type: string; role: string; status?: string }>;
}

export async function apiLogin(email: string, password: string): Promise<AuthSession> {
  const res = await postJson<LoginResponse>("/auth/login", { email, password });
  const workspaces = res.workspaces?.length ? res.workspaces : res.households.map((h) => ({ ...h, type: "household" }));
  const workspace = workspaces[0];
  if (!workspace) throw new Error("Account has no household. Contact support.");
  return {
    token: (res.accessToken ?? res.token) as string,
    accessToken: res.accessToken ?? undefined,
    refreshToken: res.refreshToken ?? undefined,
    expiresAt: res.expiresAt ?? undefined,
    userId: res.userId,
    email: res.email,
    householdId: workspace.id,
    householdName: workspace.name,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaces,
  };
}

export async function apiSignup(email: string, password: string, householdName?: string): Promise<AuthSession> {
  const res = await postJson<SignupResponse>("/auth/signup", { email, password, householdName });
  const accessToken = res.accessToken ?? res.token;
  if (!accessToken) {
    throw new Error("Check your email to verify your account, then sign in.");
  }
  const workspace = res.workspace ?? { ...res.household, type: "personal" };
  return {
    token: accessToken,
    accessToken,
    refreshToken: res.refreshToken ?? undefined,
    expiresAt: res.expiresAt ?? undefined,
    userId: res.userId,
    email: res.email,
    householdId: workspace.id,
    householdName: workspace.name,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaces: res.workspaces ?? [workspace],
  };
}

export async function apiLogout(token: string): Promise<void> {
  await postJson("/auth/logout", {}, { Authorization: `Bearer ${token}` });
}

export async function apiRefreshSession(refreshToken: string): Promise<AuthSession> {
  const res = await postJson<LoginResponse>("/auth/refresh", { refreshToken });
  const workspaces = res.workspaces?.length ? res.workspaces : res.households.map((h) => ({ ...h, type: "household" }));
  const workspace = workspaces[0];
  if (!workspace) throw new Error("Account has no household. Contact support.");
  return {
    token: (res.accessToken ?? res.token) as string,
    accessToken: res.accessToken ?? undefined,
    refreshToken: res.refreshToken ?? undefined,
    expiresAt: res.expiresAt ?? undefined,
    userId: res.userId,
    email: res.email,
    householdId: workspace.id,
    householdName: workspace.name,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaces,
  };
}

export function apiForgotPassword(email: string) {
  return postJson<{ message: string }>("/auth/forgot-password", { email });
}

export function apiResetPassword(password: string, accessToken: string) {
  return postJson<{ message: string }>("/auth/reset-password", { password }, { Authorization: `Bearer ${accessToken}` });
}

export function apiVerifyEmail() {
  return getJson<{ verified: boolean; email: string | null }>("/auth/verify-email");
}

export function apiDeleteAccount() {
  return deleteJson<void>("/auth/account");
}
