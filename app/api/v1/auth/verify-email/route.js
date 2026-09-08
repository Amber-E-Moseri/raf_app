import { json } from '../../_shared/http.js';

export async function GET(request, context = {}) {
  if (context?.authProvider !== 'supabase') {
    return json({ error: 'Email verification is available only with Supabase Auth' }, 404);
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    return json({ verified: false }, 200);
  }

  const user = await context.supabaseAuth.getUser(accessToken);
  return json({
    verified: user?.email_confirmed_at != null || user?.confirmed_at != null,
    email: user?.email ?? null,
  });
}
