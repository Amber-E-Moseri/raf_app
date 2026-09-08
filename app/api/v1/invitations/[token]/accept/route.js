import { json, getDb } from '../../../_shared/http.js';
import { acceptInvitation, InvitationError } from '../../../../../../lib/collaboration/invitations.js';

// Auth optional at middleware level — we enforce it here and check email identity.
export async function POST(_request, context = {}) {
  try {
    const token = context.params?.token;
    if (!context.userId || !context.email) {
      return json({ error: 'You must be signed in to accept an invitation.' }, 401);
    }
    const db = getDb(context);
    const result = await acceptInvitation({
      db,
      token,
      acceptingUserId: context.userId,
      acceptingUserEmail: context.email,  // from verified JWT/Supabase claim, never from client body
    });
    return json(result, 200);
  } catch (error) {
    if (error instanceof InvitationError) return json({ error: error.message }, error.status);
    return json({ error: 'Internal Server Error' }, 500);
  }
}
