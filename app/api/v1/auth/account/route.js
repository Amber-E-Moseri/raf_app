import { json, getDb } from '../../_shared/http.js';

export async function DELETE(_request, context = {}) {
  if (context?.authProvider !== 'supabase') {
    return json({ error: 'Account deletion is available only with Supabase Auth' }, 404);
  }

  const userId = context?.userId;
  if (!userId) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const db = getDb(context);
  await db.transaction(async (tx) => {
    const workspaces = typeof tx.listWorkspacesForUser === 'function'
      ? await tx.listWorkspacesForUser({ userId })
      : await tx.listHouseholdsForUser({ userId });

    if (typeof tx.deleteUserOwnedWorkspaces === 'function') {
      await tx.deleteUserOwnedWorkspaces({ userId });
    } else {
      for (const workspace of workspaces) {
        if (workspace.role === 'owner') {
          await tx.deleteHousehold?.({ householdId: workspace.householdId ?? workspace.id });
        }
      }
    }

    if (typeof tx.deleteUser === 'function') {
      await tx.deleteUser({ userId });
    }
  });

  await context.supabaseAuth.deleteUser({ userId });
  return new Response(null, { status: 204 });
}
