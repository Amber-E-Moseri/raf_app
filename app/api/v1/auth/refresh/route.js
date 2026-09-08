import { ensureUserOnboarded, formatAuthSessionPayload } from '../../../../../lib/auth/onboarding.js';
import { json, getDb } from '../../_shared/http.js';

export async function POST(request, context = {}) {
  if (context?.authProvider !== 'supabase') {
    return json({ error: 'Session refresh is available only with Supabase Auth' }, 404);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const refreshToken = body?.refreshToken ?? body?.refresh_token;
  if (!refreshToken || typeof refreshToken !== 'string') {
    return json({ error: 'refreshToken is required' }, 400);
  }

  try {
    const result = await context.supabaseAuth.refreshSession({ refreshToken });
    if (!result.user || !result.session) {
      return json({ error: 'Invalid refresh token' }, 401);
    }

    const onboarded = await ensureUserOnboarded({
      db: getDb(context),
      user: result.user,
    });

    return json(formatAuthSessionPayload({
      user: result.user,
      session: result.session,
      workspaces: onboarded.workspaces,
    }));
  } catch {
    return json({ error: 'Invalid refresh token' }, 401);
  }
}
