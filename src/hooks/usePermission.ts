import { useAuth } from "../context/AuthContext";

const WORKSPACE_ROLES = ["owner", "admin", "member", "viewer"] as const;
type Role = (typeof WORKSPACE_ROLES)[number];

const ROLE_RANK: Record<string, number> = {
  viewer: 10,
  member: 20,
  admin: 30,
  owner: 40,
};

const PERMISSIONS_BY_ROLE: Record<string, string[]> = {
  owner: [
    "workspace:read", "workspace:write", "financial:read", "financial:write",
    "reports:read", "members:manage", "subscription:read", "subscription:write",
  ],
  admin: [
    "workspace:read", "workspace:write", "financial:read", "financial:write",
    "reports:read", "members:manage", "subscription:read",
  ],
  member: [
    "workspace:read", "financial:read", "financial:write", "reports:read", "subscription:read",
  ],
  viewer: ["workspace:read", "financial:read", "reports:read", "subscription:read"],
};

export function roleHasPermission(role: string, permission: string): boolean {
  return PERMISSIONS_BY_ROLE[role]?.includes(permission) ?? false;
}

export function roleMeetsMinimum(role: string, minimum: Role): boolean {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[minimum] ?? 0);
}

function activeRole(session: ReturnType<typeof useAuth>["session"]): string {
  if (!session) return "viewer";
  const activeId = session.workspaceId ?? session.householdId;
  return session.workspaces?.find((w) => w.id === activeId)?.role ?? "viewer";
}

export function usePermission(permission: string): boolean {
  const { session } = useAuth();
  return roleHasPermission(activeRole(session), permission);
}

export function useRole(): string {
  const { session } = useAuth();
  return activeRole(session);
}
