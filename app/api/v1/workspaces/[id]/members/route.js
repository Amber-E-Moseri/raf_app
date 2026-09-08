import { json, getDb, assertWorkspaceParam } from '../../../_shared/http.js';
import { listMembers } from '../../../../../../lib/collaboration/members.js';

export async function GET(_request, context = {}) {
  const guard = assertWorkspaceParam(context, context.params);
  if (guard) return guard;
  try {
    const workspaceId = context.params.id;
    const db = getDb(context);
    const items = await listMembers({ db, workspaceId });
    return json({ items }, 200);
  } catch {
    return json({ error: 'Internal Server Error' }, 500);
  }
}
