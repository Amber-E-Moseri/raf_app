import { json, getDb, assertWorkspaceParam } from '../../../../_shared/http.js';
import { updateMemberRole, removeMember, MembersError } from '../../../../../../../lib/collaboration/members.js';

export async function PATCH(request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;
  try {
    const workspaceId = context.params.id;
    const targetUserId = context.params?.uid;
    const db = getDb(context);
    const body = await request.json();
    const result = await updateMemberRole({
      db,
      workspaceId,
      targetUserId,
      newRole: body.role,
      requestingUserId: context.userId,
      requestingRole: context.workspace?.role ?? context.role,
    });
    return json(result, 200);
  } catch (error) {
    if (error instanceof MembersError) return json({ error: error.message }, error.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}

export async function DELETE(_request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;
  try {
    const workspaceId = context.params.id;
    const targetUserId = context.params?.uid;
    const db = getDb(context);
    await removeMember({
      db,
      workspaceId,
      targetUserId,
      requestingUserId: context.userId,
      requestingRole: context.workspace?.role ?? context.role,
    });
    return json({ ok: true }, 200);
  } catch (error) {
    if (error instanceof MembersError) return json({ error: error.message }, error.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
