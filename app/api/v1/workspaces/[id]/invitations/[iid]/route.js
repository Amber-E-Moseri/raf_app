import { json, getDb, assertWorkspaceParam } from '../../../../_shared/http.js';
import { revokeInvitation, InvitationError } from '../../../../../../../lib/collaboration/invitations.js';

export async function DELETE(_request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;
  try {
    const workspaceId = context.params.id;
    const invitationId = context.params?.iid;
    const db = getDb(context);
    await revokeInvitation({
      db,
      invitationId,
      workspaceId,
      requestingUserId: context.userId,
      requestingRole: context.workspace?.role ?? context.role,
    });
    return json({ ok: true }, 200);
  } catch (error) {
    if (error instanceof InvitationError) return json({ error: error.message }, error.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
