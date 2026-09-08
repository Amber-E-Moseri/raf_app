import { json, getDb } from '../../_shared/http.js';
import { blacklistToken } from '../../../../../lib/auth/jwt.js';

export async function POST(request, context = {}) {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (context?.authProvider === 'supabase') {
    if (token) {
      await context.supabaseAuth.signOut({ accessToken: token, scope: 'local' });
    }
    return json({ message: 'Logged out successfully' });
  }

  if (token) {
    await blacklistToken(token, { db: getDb(context) });
  }
  return json({ message: 'Logged out successfully' });
}
