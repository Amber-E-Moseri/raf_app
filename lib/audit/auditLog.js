/**
 * Audit log for financial mutations.
 *
 * Events are written to raf.workspace_activity_log.
 * Metadata must NOT include raw financial values — log entity IDs and event
 * types only. Do not log balances, amounts, account numbers, or descriptions.
 *
 * Supported events:
 *   income.created, income.deleted
 *   transaction.created, transaction.updated, transaction.deleted
 *   debt.created, debt.updated, debt.deleted
 *   monthly_review.applied, monthly_review.deleted
 *   import.approved, import.rejected
 *   workspace.member_added, workspace.member_removed, workspace.ownership_transferred
 *   workspace.deleted
 *   account.deleted
 *   remi.chat
 */
export async function logAuditEvent({ db, tx = null, workspaceId, userId, event, entityId = null, metadata = {} }) {
  if ((!db && !tx) || !workspaceId || !userId || !event) {
    return;
  }

  try {
    const write = (activityTx) => activityTx?.logWorkspaceActivity?.({
      workspaceId,
      actorUserId: userId,
      action: event,
      entityType: metadata?.entityType ?? null,
      entityId: entityId ?? null,
      metadata,
    });

    if (tx) {
      await write(tx);
      return;
    }

    await db.transaction(write);
  } catch (err) {
    // Audit log failures must never crash the main operation.
    console.error('[RAF audit] failed to write audit event', { event, error: err?.message });
  }
}
