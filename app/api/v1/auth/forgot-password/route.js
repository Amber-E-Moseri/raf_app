import { json } from '../../_shared/http.js';

export async function POST(request, context = {}) {
  if (context?.authProvider !== 'supabase') {
    return json({ error: 'Password recovery is available only with Supabase Auth' }, 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = body?.email;
  if (!email || typeof email !== 'string') {
    return json({ error: 'email is required' }, 400);
  }

  await context.supabaseAuth.sendPasswordReset({ email });
  return json({ message: 'If an account exists, a reset email has been sent.' });
}
