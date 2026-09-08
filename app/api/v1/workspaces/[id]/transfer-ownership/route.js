import { json, getDb, assertWorkspaceParam } from '../../../_shared/http.js';
import { transferOwnership, MembersError } from '../../../../../../lib/collaboration/members.js';

export async function POST(request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;
  try {
    const workspaceId = context.params.id;
    const db = getDb(context);
    const body = await request.json();

    if (!body.toUserId) {
      return json({ error: 'toUserId is required.' }, 400);
    }

    // Server-side owner check (service also validates, but explicit here for early return)
    if ((context.workspace?.role ?? context.role) !== 'owner') {
      return json({ error: 'Only the owner can transfer ownership.' }, 403);
    }

    await transferOwnership({
      db,
      workspaceId,
      toUserId: body.toUserId,
      fromUserId: context.userId,
    });
    return json({ ok: true }, 200);
  } catch (error) {
    if (error instanceof MembersError) return json({ error: error.message }, error.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
