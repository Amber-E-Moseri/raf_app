/**
 * Central activity logger for workspace financial actions.
 * Call from domain services, not route handlers.
 *
 * Metadata guidelines:
 * - Include descriptive labels (e.g. source_name, amount formatted as string)
 * - Never include raw account numbers, tokens, or passwords
 * - Include before/after snapshots for role changes and configuration updates
 */

export const ACTIONS = Object.freeze({
  INCOME_CREATED: 'income.created',
  INCOME_DELETED: 'income.deleted',
  TRANSACTION_CREATED: 'transaction.created',
  TRANSACTION_DELETED: 'transaction.deleted',
  IMPORT_APPROVED: 'import.approved',
  MONTHLY_REVIEW_APPLIED: 'monthly_review.applied',
  MEMBER_INVITED: 'member.invited',
  MEMBER_ACCEPTED: 'member.accepted',
  MEMBER_ROLE_CHANGED: 'member.role_changed',
  MEMBER_REMOVED: 'member.removed',
  MEMBER_LEFT: 'member.left',
  OWNERSHIP_TRANSFERRED: 'workspace.ownership_transferred',
  WORKSPACE_NAME_CHANGED: 'workspace.name_changed',
  WORKSPACE_DELETED: 'workspace.deleted',
});

export async function logActivity(db, { workspaceId, actorUserId, action, entityType = null, entityId = null, metadata = {} }) {
  try {
    await db.transaction((tx) =>
      tx.logWorkspaceActivity({
        workspaceId,
        actorUserId,
        action,
        entityType,
        entityId: entityId ? String(entityId) : null,
        metadata,
      }),
    );
  } catch {
    // Activity logging must never break the primary operation.
  }
}
