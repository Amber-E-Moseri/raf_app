import { getJson, postJson, patchJson, deleteJson } from "./client";

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  status: string;
  email: string | null;
  name: string | null;
  joinedAt: string;
}

export interface ActivityEntry {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface InvitationPreview {
  invitation: { id: string; email: string; role: string; expiresAt: string };
  workspace: { id: string; name: string };
}

export function listMembers(workspaceId: string) {
  return getJson<{ items: WorkspaceMember[] }>(`workspaces/${workspaceId}/members`).then((r) => r.items);
}

export function updateMemberRole(workspaceId: string, userId: string, role: string) {
  return patchJson<{ userId: string; role: string }>(`workspaces/${workspaceId}/members/${userId}`, { role });
}

export function removeMember(workspaceId: string, userId: string) {
  return deleteJson<{ ok: boolean }>(`workspaces/${workspaceId}/members/${userId}`);
}

export function leaveWorkspace(workspaceId: string) {
  return postJson<{ ok: boolean }>(`workspaces/${workspaceId}/leave`, {});
}

export function transferOwnership(workspaceId: string, toUserId: string) {
  return postJson<{ ok: boolean }>(`workspaces/${workspaceId}/transfer-ownership`, { toUserId });
}

export function listPendingInvitations(workspaceId: string) {
  return getJson<{ items: WorkspaceInvitation[] }>(`workspaces/${workspaceId}/invitations`).then((r) => r.items);
}

export function sendInvitation(workspaceId: string, email: string, role: string) {
  return postJson<{ invitation: WorkspaceInvitation }>(`workspaces/${workspaceId}/invitations`, { email, role });
}

export function revokeInvitation(workspaceId: string, invitationId: string) {
  return deleteJson<{ ok: boolean }>(`workspaces/${workspaceId}/invitations/${invitationId}`);
}

export function resolveInvitation(token: string) {
  return getJson<InvitationPreview>(`invitations/${token}`);
}

export function acceptInvitation(token: string) {
  return postJson<{ workspaceId: string; role: string }>(`invitations/${token}/accept`, {});
}

export function declineInvitation(token: string) {
  return postJson<{ ok: boolean }>(`invitations/${token}/decline`, {});
}

export function listWorkspaceActivity(workspaceId: string, params?: { limit?: number; before?: string }) {
  return getJson<{ items: ActivityEntry[] }>(`workspaces/${workspaceId}/activity`, params as Record<string, string>).then((r) => r.items);
}
