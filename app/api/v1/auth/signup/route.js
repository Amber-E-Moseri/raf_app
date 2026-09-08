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

  let user, household, userHousehold;
  try {
    const passwordHash = await hashPassword(password);

    const result = await db.transaction(async (tx) => {
      const newUser = await tx.createUser({ email, passwordHash });
      const newHousehold = await tx.createHousehold({
        ownerUserId: newUser.id,
        name: householdName ?? 'My Household',
      });
      const link = await tx.createUserHousehold({
        userId: newUser.id,
        householdId: newHousehold.id,
        role: 'owner',
      });
      return { user: newUser, household: newHousehold, link };
    });

    user = result.user;
    household = result.household;
    userHousehold = result.link;
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
      id: household.id,
      name: household.name,
      role: userHousehold.role,
    },
    workspace: {
      id: household.id,
      name: household.name,
      type: household.type ?? 'household',
      role: userHousehold.role,
      status: userHousehold.status ?? 'active',
    },
    workspaces: [{
      id: household.id,
      name: household.name,
      type: household.type ?? 'household',
      role: userHousehold.role,
      status: userHousehold.status ?? 'active',
    }],
  }, 201);
}
