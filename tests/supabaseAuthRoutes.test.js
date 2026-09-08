import test from 'node:test';
import assert from 'node:assert/strict';

import { POST as signup } from '../app/api/v1/auth/signup/route.js';
import { POST as login } from '../app/api/v1/auth/login/route.js';
import { POST as refresh } from '../app/api/v1/auth/refresh/route.js';
import { POST as forgotPassword } from '../app/api/v1/auth/forgot-password/route.js';
import { POST as resetPassword } from '../app/api/v1/auth/reset-password/route.js';
import { GET as verifyEmail } from '../app/api/v1/auth/verify-email/route.js';
import { POST as logout } from '../app/api/v1/auth/logout/route.js';
import { DELETE as deleteAccount } from '../app/api/v1/auth/account/route.js';
import { createInMemoryDb } from '../lib/server/inMemoryDb.js';

function jsonRequest(pathname, body, headers = {}) {
  return new Request(`http://localhost/api/v1${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function fakeSession(user) {
  return {
    access_token: `access-${user.id}`,
    refresh_token: `refresh-${user.id}`,
    expires_at: 1790000000,
  };
}

function createFakeSupabaseAuth() {
  const calls = {
    signOut: [],
    passwordReset: [],
    updatePassword: [],
    deleteUser: [],
  };
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'amber@example.com',
    email_confirmed_at: '2026-09-03T00:00:00.000Z',
  };

  return {
    calls,
    async signUp() {
      return { user, session: fakeSession(user) };
    },
    async signInWithPassword() {
      return { user, session: fakeSession(user) };
    },
    async refreshSession() {
      return { user, session: fakeSession(user) };
    },
    async sendPasswordReset({ email }) {
      calls.passwordReset.push(email);
    },
    async updatePassword({ accessToken, password }) {
      calls.updatePassword.push({ accessToken, password });
      return { user };
    },
    async signOut({ accessToken, scope }) {
      calls.signOut.push({ accessToken, scope });
    },
    async deleteUser({ userId }) {
      calls.deleteUser.push(userId);
    },
    async getUser(accessToken) {
      return accessToken === 'valid-access' || accessToken === `access-${user.id}` ? user : null;
    },
  };
}

function context(db, supabaseAuth) {
  return {
    db,
    authProvider: 'supabase',
    supabaseAuth,
  };
}

test('Supabase signup onboards an app user into a Personal workspace with owner membership', async () => {
  const db = createInMemoryDb();
  const supabaseAuth = createFakeSupabaseAuth();

  const response = await signup(jsonRequest('/auth/signup', {
    email: 'amber@example.com',
    password: 'StrongPass123!',
    householdName: 'Amber Personal',
  }), context(db, supabaseAuth));

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.userId, '11111111-1111-4111-8111-111111111111');
  assert.equal(payload.workspace.type, 'personal');
  assert.equal(payload.workspace.role, 'owner');
  assert.equal(payload.accessToken, 'access-11111111-1111-4111-8111-111111111111');

  const workspaces = await db.transaction((tx) => tx.listWorkspacesForUser({ userId: payload.userId }));
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].type, 'personal');
  assert.equal(workspaces[0].role, 'owner');
});

test('Supabase login and refresh return RAF workspace memberships', async () => {
  const db = createInMemoryDb();
  const supabaseAuth = createFakeSupabaseAuth();
  await signup(jsonRequest('/auth/signup', {
    email: 'amber@example.com',
    password: 'StrongPass123!',
  }), context(db, supabaseAuth));

  const loginResponse = await login(jsonRequest('/auth/login', {
    email: 'amber@example.com',
    password: 'StrongPass123!',
  }), context(db, supabaseAuth));
  assert.equal(loginResponse.status, 200);
  const loginPayload = await loginResponse.json();
  assert.equal(loginPayload.workspaces.length, 1);
  assert.equal(loginPayload.refreshToken, 'refresh-11111111-1111-4111-8111-111111111111');

  const refreshResponse = await refresh(jsonRequest('/auth/refresh', {
    refreshToken: loginPayload.refreshToken,
  }), context(db, supabaseAuth));
  assert.equal(refreshResponse.status, 200);
  const refreshPayload = await refreshResponse.json();
  assert.equal(refreshPayload.accessToken, loginPayload.accessToken);
});

test('Supabase onboarding rejects legacy email matches with a different user id', async () => {
  const db = createInMemoryDb();
  const supabaseAuth = createFakeSupabaseAuth();
  await db.transaction((tx) => tx.createUser({
    id: '22222222-2222-4222-8222-222222222222',
    email: 'amber@example.com',
    passwordHash: 'legacy-hash',
  }));

  const response = await login(jsonRequest('/auth/login', {
    email: 'amber@example.com',
    password: 'StrongPass123!',
  }), context(db, supabaseAuth));

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.equal(payload.error, 'Supabase account must be linked to the existing RAF user before login.');
});

test('Supabase recovery, verification, logout, reset, and account deletion are routed through server auth', async () => {
  const db = createInMemoryDb();
  const supabaseAuth = createFakeSupabaseAuth();
  await signup(jsonRequest('/auth/signup', {
    email: 'amber@example.com',
    password: 'StrongPass123!',
  }), context(db, supabaseAuth));

  const forgot = await forgotPassword(jsonRequest('/auth/forgot-password', { email: 'amber@example.com' }), context(db, supabaseAuth));
  assert.equal(forgot.status, 200);
  assert.deepEqual(supabaseAuth.calls.passwordReset, ['amber@example.com']);

  const reset = await resetPassword(jsonRequest('/auth/reset-password', { password: 'NewStrongPass123!' }, {
    authorization: 'Bearer valid-access',
  }), context(db, supabaseAuth));
  assert.equal(reset.status, 200);
  assert.deepEqual(supabaseAuth.calls.updatePassword, [{ accessToken: 'valid-access', password: 'NewStrongPass123!' }]);

  const verified = await verifyEmail(new Request('http://localhost/api/v1/auth/verify-email', {
    headers: { authorization: 'Bearer valid-access' },
  }), context(db, supabaseAuth));
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).verified, true);

  const logoutResponse = await logout(new Request('http://localhost/api/v1/auth/logout', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-access' },
  }), context(db, supabaseAuth));
  assert.equal(logoutResponse.status, 200);
  assert.deepEqual(supabaseAuth.calls.signOut, [{ accessToken: 'valid-access', scope: 'local' }]);

  const accountDelete = await deleteAccount(new Request('http://localhost/api/v1/auth/account', { method: 'DELETE' }), {
    ...context(db, supabaseAuth),
    userId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(accountDelete.status, 204);
  assert.deepEqual(supabaseAuth.calls.deleteUser, ['11111111-1111-4111-8111-111111111111']);

  const remainingWorkspaces = await db.transaction((tx) => tx.listWorkspacesForUser({ userId: '11111111-1111-4111-8111-111111111111' }));
  assert.equal(remainingWorkspaces.length, 0);
});
