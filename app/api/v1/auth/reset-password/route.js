import { json } from '../../_shared/http.js';

export async function POST(request, context = {}) {
  if (context?.authProvider !== 'supabase') {
    return json({ error: 'Password reset is available only with Supabase Auth' }, 404);
  }

  const authHeader = request.headers.get('authorization') ?? '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    return json({ error: 'Authorization token is required' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const password = body?.password;
  if (!password || typeof password !== 'string' || password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }

  await context.supabaseAuth.updatePassword({ accessToken, password });
  return json({ message: 'Password updated successfully' });
}
