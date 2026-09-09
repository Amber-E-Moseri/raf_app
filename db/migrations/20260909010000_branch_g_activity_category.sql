-- Branch G: Activity log event categorisation
--
-- Adds event_category to workspace_activity to separate three distinct concerns:
--   collaboration   — member invitations, role changes, workspace config (all members readable)
--   financial_audit — financial mutation trail (all members readable; NO raw amounts in metadata)
--   security_audit  — high-impact security events (owners + admins only)
--
-- Policy: security_audit rows are readable only by owners and admins.
--         collaboration and financial_audit rows remain readable by all active members.
--
-- Raw financial values (balances, amounts, descriptions of transactions) must not
-- appear in metadata for any event_category. This is enforced by documentation
-- and code review — not by a DB constraint — because the metadata column is JSONB.

BEGIN;

-- 1. Add the category column with a safe default so existing rows remain valid
ALTER TABLE raf.workspace_activity
  ADD COLUMN IF NOT EXISTS event_category TEXT NOT NULL DEFAULT 'collaboration';

-- 2. Backfill existing rows based on the action prefix
UPDATE raf.workspace_activity SET event_category = 'financial_audit'
  WHERE action IN (
    'income.created', 'income.deleted',
    'transaction.created', 'transaction.updated', 'transaction.deleted',
    'debt.created', 'debt.updated', 'debt.deleted',
    'monthly_review.applied', 'monthly_review.deleted',
    'import.approved', 'import.rejected',
    'account.created', 'account.updated', 'account.deleted',
    'account.reconciliation_created', 'account.reconciliation_resolved',
    'remi.chat'
  );

UPDATE raf.workspace_activity SET event_category = 'security_audit'
  WHERE action IN (
    'workspace.deleted',
    'workspace.ownership_transferred',
    'auth.login', 'auth.logout', 'auth.login_failed', 'auth.token_revoked'
  );

-- Everything else stays 'collaboration' (member.invited, member.accepted, etc.)

-- 3. Add a CHECK constraint so future inserts use only the three valid categories
ALTER TABLE raf.workspace_activity
  ADD CONSTRAINT workspace_activity_event_category_check
  CHECK (event_category IN ('collaboration', 'financial_audit', 'security_audit'));

-- 4. Update read policy: security_audit rows require owner or admin role
DROP POLICY IF EXISTS workspace_activity_read_policy ON raf.workspace_activity;

CREATE POLICY workspace_activity_read_policy ON raf.workspace_activity
  FOR SELECT USING (
    CASE event_category
      WHEN 'security_audit' THEN
        raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[])
      ELSE
        raf.has_workspace_membership(workspace_id)
    END
  );

-- Insert policy is unchanged — category is trusted to be set correctly by app code
-- (the CHECK constraint above rejects any invalid value at the DB level)

COMMIT;
