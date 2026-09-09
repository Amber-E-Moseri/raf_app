import crypto from 'node:crypto';
import { hashPassword } from '../../../../../lib/auth/password.js';
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

  const { email, password, householdName } = body ?? {};
  if (!email || !password) {
    return json({ error: 'email and password are required' }, 400);
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return json({ error: 'Invalid email address' }, 400);
  }

  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }

  if (context?.authProvider === 'supabase') {
    try {
      const result = await context.supabaseAuth.signUp({ email, password });
      const authUser = result.user;
      if (!authUser) {
        return json({ error: 'Unable to create account' }, 400);
      }

      const onboarded = await ensureUserOnboarded({
        db,
        user: authUser,
        workspaceName: householdName ?? 'Personal',
      });

      return json({
        ...formatAuthSessionPayload({
          user: authUser,
          session: result.session,
          workspaces: onboarded.workspaces,
        }),
        emailVerificationRequired: !result.session,
      }, 201);
    } catch (err) {
      return json({ error: err.message ?? 'Unable to create account' }, err.status ?? 400);
    }
  }

  let user, workspace, member;
  try {
    const passwordHash = await hashPassword(password);
    const userId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();

    const result = await db.transaction(async (tx) => {
      const newUser = await tx.createUser({ id: userId, email, passwordHash });
      const newWorkspace = await tx.createWorkspaceRecord({
        id: workspaceId,
        ownerUserId: userId,
        name: householdName ?? 'My Household',
        type: 'household',
      });
      const newMember = await tx.createWorkspaceMember({
        workspaceId,
        userId,
        role: 'owner',
        status: 'active',
      });
      await tx.initializeWorkspaceDefaults({ workspace: newWorkspace });
      return { user: newUser, workspace: newWorkspace, member: newMember };
    }, { userId, workspaceId });

    user = result.user;
    workspace = result.workspace;
    member = result.member;
  } catch (err) {
    if (err.message === 'EMAIL_TAKEN') {
      return json({ error: 'An account with that email already exists' }, 409);
    }
    throw err;
  }

  const token = createToken({ userId: user.id, email: user.email });

  return json({
    userId: user.id,
    email: user.email,
    token,
    household: {
      id: workspace.id,
      name: workspace.name,
      role: member.role,
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      type: workspace.type ?? 'household',
      role: member.role,
      status: member.status ?? 'active',
    },
    workspaces: [{
      id: workspace.id,
      name: workspace.name,
      type: workspace.type ?? 'household',
      role: member.role,
      status: member.status ?? 'active',
    }],
  }, 201);
}
