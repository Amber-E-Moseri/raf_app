import { roleHasPermission, roleMeetsMinimum, normalizeWorkspaceRole, WORKSPACE_ROLES } from '../workspaces/permissions.js';
import { logActivity, ACTIONS } from './activityLogger.js';
import { logAuditEvent } from '../audit/auditLog.js';

const ROLE_RANK = Object.freeze({ viewer: 10, member: 20, admin: 30, owner: 40 });

export class MembersError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function listMembers({ db, workspaceId }) {
  return db.transaction((tx) => tx.listWorkspaceMembers({ workspaceId }));
}

export async function updateMemberRole({ db, workspaceId, targetUserId, newRole, requestingUserId, requestingRole }) {
  if (!roleHasPermission(requestingRole, 'members:manage')) {
    throw new MembersError('Insufficient permissions to change roles.', 403);
  }

  const normalizedRole = normalizeWorkspaceRole(newRole);

  // Owner role is only assignable through transferOwnership, not role-change
  if (normalizedRole === 'owner') {
    throw new MembersError('Use transfer ownership to designate a new owner.', 409);
  }

  // Requestor must have STRICTLY HIGHER rank than the target role.
  // Admin (30) cannot assign admin (30); only owner (40) can assign admin (30).
  if ((ROLE_RANK[requestingRole] ?? 0) <= (ROLE_RANK[normalizedRole] ?? 0)) {
    throw new MembersError('You cannot assign a role equal to or higher than your own.', 403);
  }

  return db.transaction(async (tx) => {
    const target = await tx.getWorkspaceMember({ workspaceId, userId: targetUserId });
    if (!target) throw new MembersError('Member not found.', 404);

    // Current owner cannot be changed via this path
    if (target.role === 'owner') {
      throw new MembersError('Use transfer ownership to change the owner\'s role.', 409);
    }

    const before = target.role;
    await tx.updateWorkspaceMember({ workspaceId, userId: targetUserId, patch: { role: normalizedRole } });
    await tx.logWorkspaceActivity({
      workspaceId,
      actorUserId: requestingUserId,
      action: ACTIONS.MEMBER_ROLE_CHANGED,
      entityType: 'member',
      entityId: targetUserId,
      metadata: { before, after: normalizedRole, email: target.email },
    });

    return { userId: targetUserId, role: normalizedRole };
  });
}

export async function removeMember({ db, workspaceId, targetUserId, requestingUserId, requestingRole }) {
  if (!roleHasPermission(requestingRole, 'members:manage')) {
    throw new MembersError('Insufficient permissions to remove members.', 403);
  }
  if (targetUserId === requestingUserId) {
    throw new MembersError('Use "leave household" to remove yourself.', 400);
  }

  return db.transaction(async (tx) => {
    const target = await tx.getWorkspaceMember({ workspaceId, userId: targetUserId });
    if (!target) throw new MembersError('Member not found.', 404);
    if (target.role === 'owner') throw new MembersError('The owner cannot be removed. Transfer ownership first.', 409);

    await tx.removeWorkspaceMember({ workspaceId, userId: targetUserId });
    await tx.logWorkspaceActivity({
      workspaceId,
      actorUserId: requestingUserId,
      action: ACTIONS.MEMBER_REMOVED,
      entityType: 'member',
      entityId: targetUserId,
      metadata: { removedEmail: target.email, removedRole: target.role },
    });
    return true;
  });
}

export async function leaveWorkspace({ db, workspaceId, userId }) {
  return db.transaction(async (tx) => {
    const membership = await tx.getWorkspaceMember({ workspaceId, userId });
    if (!membership) throw new MembersError('You are not a member of this household.', 404);
    if (membership.role === 'owner') {
      throw new MembersError('Transfer ownership to someone else before leaving the household.', 409);
    }

    const workspace = await tx.getWorkspace({ workspaceId });
    if (workspace?.type === 'personal') {
      throw new MembersError('You cannot leave your personal household.', 409);
    }

    await tx.removeWorkspaceMember({ workspaceId, userId });
    await tx.logWorkspaceActivity({
      workspaceId,
      actorUserId: userId,
      action: ACTIONS.MEMBER_LEFT,
      entityType: 'member',
      entityId: userId,
      metadata: { role: membership.role },
    });
    return true;
  });
}

export async function deleteWorkspace({ db, workspaceId, requestingUserId }) {
  return db.transaction(async (tx) => {
    const membership = await tx.getWorkspaceMember({ workspaceId, userId: requestingUserId });
    if (!membership || membership.role !== 'owner') {
      throw new MembersError('Only the workspace owner can delete a workspace.', 403);
    }

    const workspace = await tx.getWorkspace({ workspaceId });
    if (!workspace) throw new MembersError('Workspace not found.', 404);

    await logAuditEvent({
      tx,
      workspaceId,
      userId: requestingUserId,
      event: ACTIONS.WORKSPACE_DELETED ?? 'workspace.deleted',
      entityId: workspaceId,
      metadata: { entityType: 'workspace' },
    });

    if (typeof tx.deleteWorkspaceById !== 'function') {
      throw new MembersError('Workspace deletion is not supported by this persistence adapter.', 500);
    }

    await tx.deleteWorkspaceById({ workspaceId, requestingUserId });
    return true;
  });
}

export async function transferOwnership({ db, workspaceId, toUserId, fromUserId }) {
  return db.transaction(async (tx) => {
    const fromMember = await tx.getWorkspaceMember({ workspaceId, userId: fromUserId });
    if (!fromMember || fromMember.role !== 'owner') {
      throw new MembersError('Only the current owner can transfer ownership.', 403);
    }

    const toMember = await tx.getWorkspaceMember({ workspaceId, userId: toUserId });
    if (!toMember || toMember.status !== 'active') {
      throw new MembersError('The recipient must be an active member of the household.', 400);
    }
    if (toUserId === fromUserId) {
      throw new MembersError('You are already the owner.', 400);
    }

    await tx.updateWorkspaceMember({ workspaceId, userId: toUserId, patch: { role: 'owner' } });
    await tx.updateWorkspaceMember({ workspaceId, userId: fromUserId, patch: { role: 'admin' } });
    await tx.updateWorkspaceOwner({ workspaceId, newOwnerUserId: toUserId });

    await tx.logWorkspaceActivity({
      workspaceId,
      actorUserId: fromUserId,
      action: ACTIONS.OWNERSHIP_TRANSFERRED,
      entityType: 'workspace',
      entityId: workspaceId,
      metadata: { fromUserId, toUserId, toEmail: toMember.email },
    });
    return true;
  });
}
