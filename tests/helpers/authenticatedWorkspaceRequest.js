export function createAuthenticatedWorkspaceHeaders({ token, workspaceId, headers = {} }) {
  if (!token) {
    throw new Error('createAuthenticatedWorkspaceHeaders requires an authenticated token');
  }
  if (!workspaceId) {
    throw new Error('createAuthenticatedWorkspaceHeaders requires a verified workspaceId');
  }

  return {
    authorization: `Bearer ${token}`,
    'x-workspace-id': workspaceId,
    ...headers,
  };
}

export function createTrustedWorkspaceContext({ db, userId, workspaceId, role = 'owner', permissions = [] }) {
  if (!db || !userId || !workspaceId) {
    throw new Error('createTrustedWorkspaceContext requires db, userId, and workspaceId');
  }

  return {
    db,
    userId,
    workspaceId,
    householdId: workspaceId,
    role,
    permissions,
    workspace: {
      userId,
      workspaceId,
      householdId: workspaceId,
      role,
      permissions,
    },
  };
}
