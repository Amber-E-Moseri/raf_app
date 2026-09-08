import { json, getDb, assertWorkspaceParam } from '../../../_shared/http.js';
import { roleHasPermission } from '../../../../../../lib/workspaces/permissions.js';

export async function GET(request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;
  try {
    const workspaceId = context.params.id;
    const db = getDb(context);
    const role = context.workspace?.role ?? context.role ?? 'viewer';
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
    const before = searchParams.get('before') ?? null;

    // Members and viewers see only their own activity; owners/admins see all
    const canSeeAll = roleHasPermission(role, 'members:manage');
    const actorUserId = canSeeAll ? null : context.userId;

    const items = await db.transaction((tx) =>
      tx.listWorkspaceActivity({ workspaceId, actorUserId, limit, before }),
    );

    return json({ items }, 200);
  } catch {
    return json({ error: 'Internal Server Error' }, 500);
  }
}
