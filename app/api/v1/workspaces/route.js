import { getDb, json } from '../_shared/http.js';

function formatWorkspace(workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    type: workspace.type ?? 'household',
    role: workspace.role,
    status: workspace.status ?? 'active',
    defaultCurrency: workspace.defaultCurrency ?? 'CAD',
    timezone: workspace.timezone ?? 'America/Toronto',
    country: workspace.country ?? 'CA',
  };
}

export async function GET(_request, context = {}) {
  const userId = context?.userId;
  if (!userId) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const db = getDb(context);
  const workspaces = await db.transaction((tx) => {
    if (typeof tx.listWorkspacesForUser === 'function') {
      return tx.listWorkspacesForUser({ userId });
    }

    return tx.listHouseholdsForUser({ userId });
  });

  return json({ items: workspaces.map(formatWorkspace) }, 200);
}
