export async function ensureUserOnboarded({ db, user, workspaceName = null }) {
  if (!db?.transaction) {
    throw new Error('Auth onboarding requires a DB adapter.');
  }

  return db.transaction(async (tx) => {
    let appUser = await tx.getUserById({ userId: user.id });
    if (!appUser) {
      const existingByEmail = user.email ? await tx.getUserByEmail({ email: user.email }) : null;
      if (existingByEmail && existingByEmail.id !== user.id) {
        const error = new Error('Supabase account must be linked to the existing RAF user before login.');
        error.status = 409;
        throw error;
      }

      appUser = existingByEmail ?? await tx.createUser({
        id: user.id,
        email: user.email,
        passwordHash: null,
      });
    }

    let workspaces = typeof tx.listWorkspacesForUser === 'function'
      ? await tx.listWorkspacesForUser({ userId: appUser.id })
      : await tx.listHouseholdsForUser({ userId: appUser.id });

    if (workspaces.length === 0) {
      const workspace = typeof tx.createWorkspace === 'function'
        ? await tx.createWorkspace({
          ownerUserId: appUser.id,
          name: workspaceName ?? 'Personal',
          type: 'personal',
        })
        : await tx.createHousehold({
          ownerUserId: appUser.id,
          name: workspaceName ?? 'Personal',
        });

      if (typeof tx.createWorkspaceMember === 'function') {
        await tx.createWorkspaceMember({
          workspaceId: workspace.id,
          userId: appUser.id,
          role: 'owner',
          status: 'active',
        });
      }

      await tx.createUserHousehold({
        userId: appUser.id,
        householdId: workspace.householdId ?? workspace.id,
        role: 'owner',
      });
    }

    workspaces = typeof tx.listWorkspacesForUser === 'function'
      ? await tx.listWorkspacesForUser({ userId: appUser.id })
      : await tx.listHouseholdsForUser({ userId: appUser.id });

    return {
      user: appUser,
      workspaces,
    };
  });
}

export function formatAuthSessionPayload({ user, session, workspaces }) {
  const active = workspaces[0] ?? null;
  return {
    userId: user.id,
    email: user.email,
    token: session?.access_token ?? null,
    accessToken: session?.access_token ?? null,
    refreshToken: session?.refresh_token ?? null,
    expiresAt: session?.expires_at ?? null,
    household: active ? {
      id: active.id,
      name: active.name,
      role: active.role,
    } : null,
    households: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      role: workspace.role,
    })),
    workspace: active ? {
      id: active.id,
      name: active.name,
      type: active.type ?? 'household',
      role: active.role,
      status: active.status ?? 'active',
    } : null,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      type: workspace.type ?? 'household',
      role: workspace.role,
      status: workspace.status ?? 'active',
    })),
  };
}
