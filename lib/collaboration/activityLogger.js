/**
 * Central activity logger for workspace financial actions.
 * Call from domain services, not route handlers.
 *
 * Metadata guidelines:
 * - Include entity identifiers, type labels, slugs, and role names
 * - Include before/after snapshots for role changes and configuration updates
 * - NEVER include amounts, balances, transaction descriptions, or any value that
 *   reveals the magnitude or nature of a financial event — log entity IDs only
 * - Never include raw account numbers, tokens, passwords, or PII beyond what
 *   is already visible to all workspace members via normal access
 * - Set event_category correctly: 'financial_audit', 'security_audit', or 'collaboration'
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
