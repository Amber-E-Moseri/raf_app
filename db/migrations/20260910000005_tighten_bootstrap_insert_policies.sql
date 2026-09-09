-- Tighten bootstrap INSERT policies introduced in migrations 000003 and 000004.
--
-- The WITH CHECK (true) approach is overly broad: it allows any authenticated
-- raf_app session to INSERT into these tables regardless of workspace membership.
-- The NOT EXISTS alternative is equally broad because the inner SELECT is filtered
-- by the table's own USING policy (which returns no rows when raf.workspace_id is
-- unset), making NOT EXISTS always TRUE — same as WITH CHECK (true).
--
-- Correct fix: a SECURITY DEFINER helper that bypasses RLS to see whether any
-- active member row already exists for the workspace. The bootstrap window is
-- open only while the workspace has no members; the instant createWorkspaceMember
-- commits, the guard closes for all subsequent inserts.
--
-- Tables fixed:
--   workspace_members  (migration 000003: was WITH CHECK (true))
--   households         (migration 000004: was WITH CHECK (true))
--   allocation_categories (migration 000004: was WITH CHECK (true))
--   surplus_split_rules   (migration 000004: was WITH CHECK (true))
--
-- workspaces and app_users are intentionally left with WITH CHECK (true):
--   workspaces   — any user must be able to create a new workspace on signup
--   app_users    — any session must be able to register a new account

-- Helper: returns TRUE if the workspace has no active owner/admin members yet.
-- SECURITY DEFINER so it reads past the row-level policy on workspace_members.
CREATE OR REPLACE FUNCTION raf.workspace_has_no_members(target_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = raf, pg_catalog
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM raf.workspace_members
    WHERE workspace_id = target_workspace_id
      AND status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION raf.workspace_has_no_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION raf.workspace_has_no_members(uuid) TO PUBLIC;

-- workspace_members: replace WITH CHECK (true) from migration 000003.
DROP POLICY IF EXISTS workspace_members_insert_policy ON raf.workspace_members;
CREATE POLICY workspace_members_insert_policy ON raf.workspace_members
FOR INSERT
WITH CHECK (
  raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[])
  OR raf.workspace_has_no_members(workspace_id)
);

-- households: replace WITH CHECK (true) from migration 000004.
DROP POLICY IF EXISTS households_insert_policy ON raf.households;
CREATE POLICY households_insert_policy ON raf.households
FOR INSERT
WITH CHECK (
  raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[])
  OR raf.workspace_has_no_members(workspace_id)
);

-- allocation_categories: replace WITH CHECK (true) from migration 000004.
DROP POLICY IF EXISTS allocation_categories_insert_policy ON raf.allocation_categories;
CREATE POLICY allocation_categories_insert_policy ON raf.allocation_categories
FOR INSERT
WITH CHECK (
  raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[])
  OR raf.workspace_has_no_members(workspace_id)
);

-- surplus_split_rules: replace WITH CHECK (true) from migration 000004.
DROP POLICY IF EXISTS surplus_split_rules_insert_policy ON raf.surplus_split_rules;
CREATE POLICY surplus_split_rules_insert_policy ON raf.surplus_split_rules
FOR INSERT
WITH CHECK (
  raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[])
  OR raf.workspace_has_no_members(workspace_id)
);
