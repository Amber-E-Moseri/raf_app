import { json, getDb, assertWorkspaceParam } from '../../../_shared/http.js';
import { leaveWorkspace, MembersError } from '../../../../../../lib/collaboration/members.js';

export async function POST(_request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;
  try {
    const workspaceId = context.params.id;
    const db = getDb(context);
    await leaveWorkspace({ db, workspaceId, userId: context.userId });
    return json({ ok: true }, 200);
  } catch (error) {
    if (error instanceof MembersError) return json({ error: error.message }, error.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
