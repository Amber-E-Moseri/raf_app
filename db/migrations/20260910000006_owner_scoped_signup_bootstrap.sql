-- Owner-scoped signup bootstrap.
--
-- Earlier bootstrap migrations opened INSERT policies while a workspace had no
-- members. The application now creates signup records in this order:
-- app_user -> workspace -> owner workspace_member -> household/default RAF rows.
-- That lets the bootstrap exception be narrowed to the first owner membership,
-- and lets household/default inserts run through the normal owner/admin role
-- check after membership exists.

CREATE OR REPLACE FUNCTION raf.is_workspace_owner(
  target_workspace_id uuid,
  target_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = raf, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM raf.workspaces w
    WHERE w.id = target_workspace_id
      AND w.owner_user_id = target_user_id
  )
$$;

REVOKE ALL ON FUNCTION raf.is_workspace_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION raf.is_workspace_owner(uuid, uuid) TO PUBLIC;

DROP POLICY IF EXISTS workspaces_insert_policy ON raf.workspaces;
CREATE POLICY workspaces_insert_policy ON raf.workspaces
FOR INSERT
WITH CHECK (owner_user_id = raf.current_app_user_id());

DROP POLICY IF EXISTS workspace_members_insert_policy ON raf.workspace_members;
CREATE POLICY workspace_members_insert_policy ON raf.workspace_members
FOR INSERT
WITH CHECK (
  raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[])
  OR (
    user_id = raf.current_app_user_id()
    AND role = 'owner'
    AND status = 'active'
    AND raf.is_workspace_owner(workspace_id, user_id)
  )
);

DROP POLICY IF EXISTS households_insert_policy ON raf.households;
CREATE POLICY households_insert_policy ON raf.households
FOR INSERT
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[]));

DROP POLICY IF EXISTS allocation_categories_insert_policy ON raf.allocation_categories;
CREATE POLICY allocation_categories_insert_policy ON raf.allocation_categories
FOR INSERT
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[]));

DROP POLICY IF EXISTS surplus_split_rules_insert_policy ON raf.surplus_split_rules;
CREATE POLICY surplus_split_rules_insert_policy ON raf.surplus_split_rules
FOR INSERT
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[]));
