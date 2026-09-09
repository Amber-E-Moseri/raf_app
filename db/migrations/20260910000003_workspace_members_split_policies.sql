-- Replace workspace_members FOR ALL policy with explicit per-command policies.
--
-- The FOR ALL policy has a WITH CHECK clause that PostgreSQL evaluates for
-- INSERT even though a separate FOR INSERT WITH CHECK (true) policy exists.
-- Splitting into per-command policies makes the INSERT path unambiguous:
-- only the FOR INSERT policy WITH CHECK (true) applies to INSERT.
--
-- SELECT / UPDATE / DELETE retain the existing membership/role checks.

-- Drop both the old FOR ALL policy and the existing FOR INSERT policy.
DROP POLICY IF EXISTS workspace_members_visible_policy ON raf.workspace_members;
DROP POLICY IF EXISTS workspace_members_insert_policy ON raf.workspace_members;

-- INSERT: always allowed (signup bootstrap — no membership exists yet).
CREATE POLICY workspace_members_insert_policy ON raf.workspace_members
FOR INSERT
WITH CHECK (true);

-- SELECT: visible to members of the workspace only.
CREATE POLICY workspace_members_select_policy ON raf.workspace_members
FOR SELECT
USING (raf.has_workspace_membership(workspace_id));

-- UPDATE: only owner/admin may update membership records.
CREATE POLICY workspace_members_update_policy ON raf.workspace_members
FOR UPDATE
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[]));

-- DELETE: only owner/admin may remove members.
CREATE POLICY workspace_members_delete_policy ON raf.workspace_members
FOR DELETE
USING (raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[]));
