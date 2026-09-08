import { json, getDb } from '../../_shared/http.js';
import { resolveInvitation, InvitationError } from '../../../../../lib/collaboration/invitations.js';

// Public: no auth required — returns workspace name + role for the invitation accept page
export async function GET(_request, context = {}) {
  try {
    const token = context.params?.token;
    const db = getDb(context);
    const { invitation, workspace } = await resolveInvitation({ db, token });
    return json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
      workspace: {
        id: workspace?.id,
        name: workspace?.name,
      },
    }, 200);
  } catch (error) {
    if (error instanceof InvitationError) return json({ error: error.message }, error.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
