import { json, getDb } from '../../../_shared/http.js';
import { declineInvitation, InvitationError } from '../../../../../../lib/collaboration/invitations.js';

// Public: no auth required to decline
export async function POST(_request, context = {}) {
  try {
    const token = context.params?.token;
    const db = getDb(context);
    await declineInvitation({ db, token });
    return json({ ok: true }, 200);
  } catch (error) {
    if (error instanceof InvitationError) return json({ error: error.message }, error.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
