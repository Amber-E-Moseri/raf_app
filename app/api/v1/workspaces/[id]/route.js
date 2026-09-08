import { json, getDb, assertWorkspaceParam } from '../../_shared/http.js';
import { deleteWorkspace, MembersError } from '../../../../../lib/collaboration/members.js';

export async function GET(_request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;

  const db = getDb(context);
  const workspaceId = context.params.id;
  const workspace = await db.transaction((tx) => tx.getWorkspace({ workspaceId }));
  if (!workspace) return json({ error: 'Workspace not found.' }, 404);

  return json({
    id: workspace.id,
    name: workspace.name,
    type: workspace.type ?? 'household',
    role: context.role ?? null,
    defaultCurrency: workspace.defaultCurrency ?? 'CAD',
    timezone: workspace.timezone ?? 'America/Toronto',
    country: workspace.country ?? 'CA',
  }, 200);
}

export async function PATCH(request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { name, timezone } = body ?? {};
  const patch = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim().slice(0, 200);
  if (typeof timezone === 'string' && timezone.trim()) patch.timezone = timezone.trim();

  if (Object.keys(patch).length === 0) {
    return json({ error: 'No valid fields to update.' }, 400);
  }

  const db = getDb(context);
  const workspaceId = context.params.id;
  const updated = await db.transaction((tx) => tx.updateWorkspace({ workspaceId, patch }));
  return json({ id: workspaceId, ...patch }, 200);
}

/**
 * DELETE /api/v1/workspaces/:id
 *
 * Permanently deletes the workspace and all associated financial data.
 * Requires workspace owner role.
 *
 * This action is irreversible. All transactions, income, debts, goals,
 * imports, and monthly reviews for this workspace will be permanently removed.
 */
export async function DELETE(_request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;

  const userId = context?.userId;
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const workspaceId = context.params.id;
  const db = getDb(context);

  try {
    await deleteWorkspace({ db, workspaceId, requestingUserId: userId });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof MembersError) {
      return json({ error: error.message }, error.status);
    }
    console.error('[RAF workspace] delete failed', { error: error?.message });
    return json({ error: 'Internal Server Error' }, 500);
  }
}
