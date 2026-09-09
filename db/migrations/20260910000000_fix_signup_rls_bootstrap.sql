-- Fix signup bootstrap: INSERT-only permissive policies for account creation.
--
-- Problem: workspaces, workspace_members, and app_users all have RLS policies
-- whose WITH CHECK clauses require existing membership/ownership — creating a
-- circular dependency that blocks the signup transaction.
--
-- Solution: add separate FOR INSERT policies on these three tables that allow
-- creation without pre-existing membership. SELECT / UPDATE / DELETE policies
-- are unchanged — reads and mutations remain fully scoped to workspace membership.

-- Any authenticated raf_app session can create a new workspace (signup / bootstrap).
-- Reads/updates/deletes are still restricted to members by the existing policy.
DROP POLICY IF EXISTS workspaces_insert_policy ON raf.workspaces;
CREATE POLICY workspaces_insert_policy ON raf.workspaces
FOR INSERT
WITH CHECK (true);

-- The first member of a workspace can always be created (signup bootstrap).
-- Subsequent members require the session to already be owner or admin.
DROP POLICY IF EXISTS workspace_members_insert_policy ON raf.workspace_members;
CREATE POLICY workspace_members_insert_policy ON raf.workspace_members
FOR INSERT
WITH CHECK (
  raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[])
  OR NOT EXISTS (
    SELECT 1 FROM raf.workspace_members m
    WHERE m.workspace_id = workspace_members.workspace_id
  )
);

-- Any raf_app session can register a new user account.
-- SELECT / UPDATE / DELETE on app_users are still restricted to self.
DROP POLICY IF EXISTS app_users_insert_policy ON raf.app_users;
CREATE POLICY app_users_insert_policy ON raf.app_users
FOR INSERT
WITH CHECK (true);
