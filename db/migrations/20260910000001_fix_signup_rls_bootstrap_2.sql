-- Extend signup bootstrap fix to tables written inside createWorkspace().
--
-- createWorkspace() inserts into workspaces, households, allocation_categories,
-- and surplus_split_rules in sequence before workspace_members is populated.
-- The existing WITH CHECK policies on all three tables call has_workspace_membership()
-- which returns false (no members yet), blocking every INSERT.
--
-- Same pattern as 20260910000000: add permissive FOR INSERT policies.
-- SELECT / UPDATE / DELETE remain restricted to workspace members.

DROP POLICY IF EXISTS households_insert_policy ON raf.households;
CREATE POLICY households_insert_policy ON raf.households
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS allocation_categories_insert_policy ON raf.allocation_categories;
CREATE POLICY allocation_categories_insert_policy ON raf.allocation_categories
FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS surplus_split_rules_insert_policy ON raf.surplus_split_rules;
CREATE POLICY surplus_split_rules_insert_policy ON raf.surplus_split_rules
FOR INSERT
WITH CHECK (true);
