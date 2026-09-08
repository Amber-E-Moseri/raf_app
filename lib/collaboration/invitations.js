import crypto from 'node:crypto';

import { roleHasPermission, roleMeetsMinimum, normalizeWorkspaceRole } from '../workspaces/permissions.js';
import { logActivity, ACTIONS } from './activityLogger.js';

// Roles that can be assigned via invitation (owner is transfer-only)
const INVITABLE_ROLES = new Set(['admin', 'member', 'viewer']);

const ROLE_RANK = Object.freeze({ viewer: 10, member: 20, admin: 30, owner: 40 });

const INVITATION_TTL_DAYS = 7;

function generateToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function expiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + INVITATION_TTL_DAYS);
  return d.toISOString();
}

export class InvitationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function createInvitation({ db, workspaceId, invitedByUserId, invitedByRole, email, role }) {
  if (!email || !email.includes('@')) {
    throw new InvitationError('A valid email address is required.');
  }

  const normalizedRole = normalizeWorkspaceRole(role);

  if (!roleHasPermission(invitedByRole, 'members:manage')) {
    throw new InvitationError('Only admins and owners can send invitations.', 403);
  }

  // Owner role may only be granted via transferOwnership, never via invitation
  if (!INVITABLE_ROLES.has(normalizedRole)) {
    throw new InvitationError('Cannot invite someone directly as owner. Use transfer ownership instead.', 400);
  }

  // Inviter must have STRICTLY HIGHER rank than the invited role.
  // Admin (30) cannot invite admin (30); only owner (40) can invite admin (30).
  if ((ROLE_RANK[invitedByRole] ?? 0) <= (ROLE_RANK[normalizedRole] ?? 0)) {
    throw new InvitationError('You cannot invite someone to a role equal to or higher than your own.', 403);
  }

  return db.transaction(async (tx) => {
    // Check if already a member by email lookup
    const existingUser = await tx.getUserByEmail({ email }).catch(() => null);
    if (existingUser) {
      const membership = await tx.getWorkspaceMember({ workspaceId, userId: existingUser.id });
      if (membership && membership.status === 'active') {
        throw new InvitationError('This person is already a member of the household.', 409);
      }
    }

    const { raw: rawToken, hash: tokenHash } = generateToken();
    const invitation = await tx.createWorkspaceInvitation({
      workspaceId,
      invitedBy: invitedByUserId,
      email,
      role: normalizedRole,
      token: tokenHash,   // only the hash is stored; raw token travels in the email URL only
      expiresAt: expiresAt(),
    });

    await tx.logWorkspaceActivity({
      workspaceId,
      actorUserId: invitedByUserId,
      action: ACTIONS.MEMBER_INVITED,
      entityType: 'invitation',
      entityId: invitation.id,
      metadata: { email, role: normalizedRole },   // no token in log
    });

    // Return the raw token so the caller can put it in the invitation URL/email.
    // It is NOT persisted and must never be logged.
    return { ...invitation, rawToken };
  });
}

export async function resolveInvitation({ db, token }) {
  const invitation = await db.transaction((tx) => tx.getWorkspaceInvitationByToken({ token: hashToken(token) }));
  if (!invitation) {
    throw new InvitationError('Invitation not found or already used.', 404);
  }
  if (invitation.status !== 'pending') {
    throw new InvitationError(`This invitation has already been ${invitation.status}.`, 410);
  }
  if (new Date(invitation.expiresAt) < new Date()) {
    await db.transaction((tx) => tx.updateWorkspaceInvitation({ invitationId: invitation.id, patch: { status: 'expired' } }));
    throw new InvitationError('This invitation has expired.', 410);
  }

  return db.transaction(async (tx) => {
    const workspace = await tx.getWorkspace({ workspaceId: invitation.workspaceId });
    return { invitation, workspace };
  });
}

export async function acceptInvitation({ db, token, acceptingUserId, acceptingUserEmail }) {
  const invitation = await db.transaction((tx) => tx.getWorkspaceInvitationByToken({ token: hashToken(token) }));
  if (!invitation) {
    throw new InvitationError('Invitation not found.', 404);
  }
  if (invitation.status !== 'pending') {
    throw new InvitationError(`This invitation has already been ${invitation.status}.`, 410);
  }
  if (new Date(invitation.expiresAt) < new Date()) {
    await db.transaction((tx) => tx.updateWorkspaceInvitation({ invitationId: invitation.id, patch: { status: 'expired' } }));
    throw new InvitationError('This invitation has expired.', 410);
  }
  if (!acceptingUserEmail) {
    throw new InvitationError('Authenticated identity is required to accept an invitation.', 401);
  }
  if (invitation.email.toLowerCase() !== acceptingUserEmail.toLowerCase()) {
    throw new InvitationError('This invitation was sent to a different email address.', 403);
  }

  return db.transaction(async (tx) => {
    const existingMembership = await tx.getWorkspaceMember({ workspaceId: invitation.workspaceId, userId: acceptingUserId });
    if (existingMembership && existingMembership.status === 'active') {
      throw new InvitationError('You are already a member of this household.', 409);
    }

    await tx.createWorkspaceMember({
      workspaceId: invitation.workspaceId,
      userId: acceptingUserId,
      role: invitation.role,
      status: 'active',
      invitedBy: invitation.invitedBy,
    });
    await tx.updateWorkspaceInvitation({ invitationId: invitation.id, patch: { status: 'accepted' } });
    await tx.logWorkspaceActivity({
      workspaceId: invitation.workspaceId,
      actorUserId: acceptingUserId,
      action: ACTIONS.MEMBER_ACCEPTED,
      entityType: 'invitation',
      entityId: invitation.id,
      metadata: { email: invitation.email, role: invitation.role },
    });
    return { workspaceId: invitation.workspaceId, role: invitation.role };
  });
}

export async function declineInvitation({ db, token }) {
  const invitation = await db.transaction((tx) => tx.getWorkspaceInvitationByToken({ token: hashToken(token) }));
  if (!invitation) {
    throw new InvitationError('Invitation not found.', 404);
  }
  if (invitation.status !== 'pending') {
    throw new InvitationError(`This invitation has already been ${invitation.status}.`, 410);
  }

  await db.transaction((tx) => tx.updateWorkspaceInvitation({ invitationId: invitation.id, patch: { status: 'declined' } }));
  return true;
}

export async function revokeInvitation({ db, invitationId, workspaceId, requestingUserId, requestingRole }) {
  if (!roleHasPermission(requestingRole, 'members:manage')) {
    throw new InvitationError('Only admins and owners can revoke invitations.', 403);
  }

  const invitation = await db.transaction((tx) => tx.getWorkspaceInvitationById({ invitationId }));
  if (!invitation || invitation.workspaceId !== workspaceId) {
    throw new InvitationError('Invitation not found.', 404);
  }
  if (invitation.status !== 'pending') {
    throw new InvitationError('This invitation is no longer pending.', 409);
  }

  await db.transaction((tx) => tx.updateWorkspaceInvitation({ invitationId, patch: { status: 'revoked' } }));
  return true;
}

export async function listPendingInvitations({ db, workspaceId, requestingRole }) {
  if (!roleHasPermission(requestingRole, 'members:manage')) {
    throw new InvitationError('Only admins and owners can view pending invitations.', 403);
  }

  return db.transaction((tx) => tx.listWorkspaceInvitations({ workspaceId, status: 'pending' }));
}
