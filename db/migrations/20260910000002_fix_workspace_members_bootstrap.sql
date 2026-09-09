-- Simplify workspace_members INSERT policy for signup bootstrap.
--
-- The complex NOT EXISTS OR has_workspace_role check from migration
-- 20260910000000 is still blocking the INSERT during signup.
-- The NOT EXISTS subquery itself may be filtered by the existing
-- workspace_members_visible_policy (FOR ALL), causing it to return
-- false even when the table is empty.
--
-- Replace with WITH CHECK (true) — same pattern as all other bootstrap
-- tables (workspaces, households, allocation_categories, surplus_split_rules).
-- SELECT / UPDATE / DELETE on workspace_members remain restricted by the
-- existing workspace_members_visible_policy.

DROP POLICY IF EXISTS workspace_members_insert_policy ON raf.workspace_members;
CREATE POLICY workspace_members_insert_policy ON raf.workspace_members
FOR INSERT
WITH CHECK (true);
