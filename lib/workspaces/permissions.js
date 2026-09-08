export const WORKSPACE_TYPES = Object.freeze(['personal', 'household']);
export const WORKSPACE_ROLES = Object.freeze(['owner', 'admin', 'member', 'viewer']);
export const WORKSPACE_MEMBER_STATUSES = Object.freeze(['active', 'invited', 'suspended']);

const ROLE_RANK = Object.freeze({
  viewer: 10,
  member: 20,
  admin: 30,
  owner: 40,
});

const PERMISSIONS_BY_ROLE = Object.freeze({
  owner: new Set([
    'workspace:read',
    'workspace:update',
    'members:manage',
    'financial:read',
    'financial:write',
    'imports:read',
    'imports:write',
    'reports:read',
    'remi:invoke',
    'subscription:read',
    'subscription:write',
  ]),
  admin: new Set([
    'workspace:read',
    'workspace:update',
    'members:manage',
    'financial:read',
    'financial:write',
    'imports:read',
    'imports:write',
    'reports:read',
    'remi:invoke',
    'subscription:read',
  ]),
  member: new Set([
    'workspace:read',
    'financial:read',
    'financial:write',
    'imports:read',
    'imports:write',
    'reports:read',
    'remi:invoke',
    'subscription:read',
  ]),
  viewer: new Set([
    'workspace:read',
    'financial:read',
    'imports:read',
    'reports:read',
    'subscription:read',
  ]),
});

export function normalizeWorkspaceType(type) {
  return WORKSPACE_TYPES.includes(type) ? type : 'household';
}

export function normalizeWorkspaceRole(role) {
  return WORKSPACE_ROLES.includes(role) ? role : 'member';
}

export function normalizeWorkspaceMemberStatus(status) {
  return WORKSPACE_MEMBER_STATUSES.includes(status) ? status : 'active';
}

export function roleMeetsMinimum(role, minimumRole) {
  const actualRank = ROLE_RANK[normalizeWorkspaceRole(role)] ?? 0;
  const requiredRank = ROLE_RANK[normalizeWorkspaceRole(minimumRole)] ?? 0;
  return actualRank >= requiredRank;
}

export function roleHasPermission(role, permission) {
  return PERMISSIONS_BY_ROLE[normalizeWorkspaceRole(role)]?.has(permission) === true;
}

export function buildWorkspaceContext({ workspace, membership, userId }) {
  if (!workspace || !membership || membership.status !== 'active') {
    return null;
  }

  const role = normalizeWorkspaceRole(membership.role);
  return {
    userId,
    workspaceId: workspace.id,
    householdId: workspace.householdId ?? workspace.id,
    role,
    permissions: [...(PERMISSIONS_BY_ROLE[role] ?? [])],
    workspace: {
      id: workspace.id,
      name: workspace.name,
      type: normalizeWorkspaceType(workspace.type),
      ownerUserId: workspace.ownerUserId,
      defaultCurrency: workspace.defaultCurrency ?? 'CAD',
      timezone: workspace.timezone ?? 'America/Toronto',
      country: workspace.country ?? 'CA',
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
  };
}

export function requireWorkspace(context) {
  if (!context?.workspace) {
    const error = new Error('Workspace context is required');
    error.status = 401;
    throw error;
  }

  return context.workspace;
}

export function requireWorkspaceRole(context, minimumRole) {
  const workspace = requireWorkspace(context);
  if (!roleMeetsMinimum(workspace.role, minimumRole)) {
    const error = new Error('Insufficient workspace role');
    error.status = 403;
    throw error;
  }

  return workspace;
}

export function requireWorkspacePermission(context, permission) {
  const workspace = requireWorkspace(context);
  if (!roleHasPermission(workspace.role, permission)) {
    const error = new Error('Insufficient workspace permission');
    error.status = 403;
    throw error;
  }

  return workspace;
}
