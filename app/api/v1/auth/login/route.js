import { verifyPassword } from '../../../../../lib/auth/password.js';
import { createToken } from '../../../../../lib/auth/jwt.js';
import { ensureUserOnboarded, formatAuthSessionPayload } from '../../../../../lib/auth/onboarding.js';
import { json, getDb } from '../../_shared/http.js';

export async function POST(request, context) {
  const db = getDb(context);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { email, password } = body ?? {};
  if (!email || !password) {
    return json({ error: 'email and password are required' }, 400);
  }

  if (context?.authProvider === 'supabase') {
    try {
      const result = await context.supabaseAuth.signInWithPassword({ email, password });
      if (!result.user || !result.session) {
        return json({ error: 'Invalid email or password' }, 401);
      }

      const onboarded = await ensureUserOnboarded({
        db,
        user: result.user,
      });

      return json(formatAuthSessionPayload({
        user: result.user,
        session: result.session,
        workspaces: onboarded.workspaces,
      }));
    } catch (err) {
      if (err?.status) {
        return json({ error: err.message ?? 'Authentication failed' }, err.status);
      }
      return json({ error: 'Invalid email or password' }, 401);
    }
  }

  const user = await db.transaction((tx) => tx.getUserByEmail({ email }));
  if (!user) {
    return json({ error: 'Invalid email or password' }, 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return json({ error: 'Invalid email or password' }, 401);
  }

  const workspaces = await db.transaction((tx) => {
    if (typeof tx.listWorkspacesForUser === 'function') {
      return tx.listWorkspacesForUser({ userId: user.id });
    }

    return tx.listHouseholdsForUser({ userId: user.id });
  }, { userId: user.id });
  const token = createToken({ userId: user.id, email: user.email });

  return json({
    userId: user.id,
    email: user.email,
    token,
    workspaceId: workspaces[0]?.id ?? null,
    remiTier: user.remiTier ?? 'free',
    households: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, role: workspace.role })),
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      type: workspace.type ?? 'household',
      role: workspace.role,
      status: workspace.status ?? 'active',
    })),
  });
}
