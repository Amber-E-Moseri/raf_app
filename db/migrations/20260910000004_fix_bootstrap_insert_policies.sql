-- Fix signup bootstrap: add FOR INSERT WITH CHECK (true) policies for tables that
-- are written during workspace creation before the owner workspace_member row exists.
--
-- createWorkspace() inserts households, allocation_categories, and surplus_split_rules
-- in the same transaction that inserts the workspace and before inserting the
-- workspace_member row. The existing FOR ALL policies on these tables derive their
-- WITH CHECK from the USING clause (has_workspace_membership), which returns FALSE
-- at insert time because no member row exists yet — circular by construction.
--
-- Pattern: same approach used for workspaces, workspace_members, and app_users in
-- migrations 20260910000000–000003. The FOR ALL USING restriction (workspace scoping
-- and membership checks) still applies to SELECT / UPDATE / DELETE; only INSERT is
-- opened for bootstrap.

-- households
DROP POLICY IF EXISTS households_insert_policy ON raf.households;
CREATE POLICY households_insert_policy ON raf.households
FOR INSERT
WITH CHECK (true);

-- allocation_categories
DROP POLICY IF EXISTS allocation_categories_insert_policy ON raf.allocation_categories;
CREATE POLICY allocation_categories_insert_policy ON raf.allocation_categories
FOR INSERT
WITH CHECK (true);

-- surplus_split_rules
DROP POLICY IF EXISTS surplus_split_rules_insert_policy ON raf.surplus_split_rules;
CREATE POLICY surplus_split_rules_insert_policy ON raf.surplus_split_rules
FOR INSERT
WITH CHECK (true);
