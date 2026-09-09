-- Tighten RLS USING clauses for all financial/tenant-data tables.
--
-- The existing has_workspace_membership() helper permits access when
-- raf.current_workspace_id() IS NULL (only raf.user_id is set), meaning a user
-- with multi-workspace membership could theoretically access all their workspaces'
-- data in a single transaction. For financial tables, we require BOTH user identity
-- AND a matching workspace_id to be explicitly set.
--
-- Workspace / membership lookup tables (workspaces, workspace_members,
-- workspace_invitations, workspace_activity) are left unchanged — they legitimately
-- need to be readable with only raf.user_id during the membership-verification step
-- that happens before raf.workspace_id is known.
--
-- Each policy is dropped and recreated.  The WITH CHECK clause (already absent on
-- most financial tables — insert/update scope is enforced by the application layer)
-- is intentionally omitted where the original had none.

-- households
DROP POLICY IF EXISTS households_workspace_policy ON raf.households;
CREATE POLICY households_workspace_policy ON raf.households
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- allocation_categories
DROP POLICY IF EXISTS allocation_categories_workspace_policy ON raf.allocation_categories;
CREATE POLICY allocation_categories_workspace_policy ON raf.allocation_categories
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- surplus_split_rules
DROP POLICY IF EXISTS surplus_split_rules_workspace_policy ON raf.surplus_split_rules;
CREATE POLICY surplus_split_rules_workspace_policy ON raf.surplus_split_rules
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- income_entries
DROP POLICY IF EXISTS income_entries_workspace_policy ON raf.income_entries;
CREATE POLICY income_entries_workspace_policy ON raf.income_entries
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- income_allocations
DROP POLICY IF EXISTS income_allocations_workspace_policy ON raf.income_allocations;
CREATE POLICY income_allocations_workspace_policy ON raf.income_allocations
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- transactions
DROP POLICY IF EXISTS transactions_workspace_policy ON raf.transactions;
CREATE POLICY transactions_workspace_policy ON raf.transactions
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- debts
DROP POLICY IF EXISTS debts_workspace_policy ON raf.debts;
CREATE POLICY debts_workspace_policy ON raf.debts
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- debt_payments
DROP POLICY IF EXISTS debt_payments_workspace_policy ON raf.debt_payments;
CREATE POLICY debt_payments_workspace_policy ON raf.debt_payments
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- debt_adjustments
DROP POLICY IF EXISTS debt_adjustments_workspace_policy ON raf.debt_adjustments;
CREATE POLICY debt_adjustments_workspace_policy ON raf.debt_adjustments
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- fixed_bills
DROP POLICY IF EXISTS fixed_bills_workspace_policy ON raf.fixed_bills;
CREATE POLICY fixed_bills_workspace_policy ON raf.fixed_bills
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- goals
DROP POLICY IF EXISTS goals_workspace_policy ON raf.goals;
CREATE POLICY goals_workspace_policy ON raf.goals
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- import_batches
DROP POLICY IF EXISTS import_batches_workspace_policy ON raf.import_batches;
CREATE POLICY import_batches_workspace_policy ON raf.import_batches
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- imported_transaction_rows
DROP POLICY IF EXISTS imported_transaction_rows_workspace_policy ON raf.imported_transaction_rows;
CREATE POLICY imported_transaction_rows_workspace_policy ON raf.imported_transaction_rows
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- imported_transactions
DROP POLICY IF EXISTS imported_transactions_workspace_policy ON raf.imported_transactions;
CREATE POLICY imported_transactions_workspace_policy ON raf.imported_transactions
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- merchant_rules
DROP POLICY IF EXISTS merchant_rules_workspace_policy ON raf.merchant_rules;
CREATE POLICY merchant_rules_workspace_policy ON raf.merchant_rules
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- import_review_rules
DROP POLICY IF EXISTS import_review_rules_workspace_policy ON raf.import_review_rules;
CREATE POLICY import_review_rules_workspace_policy ON raf.import_review_rules
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- monthly_reviews
DROP POLICY IF EXISTS monthly_reviews_workspace_policy ON raf.monthly_reviews;
CREATE POLICY monthly_reviews_workspace_policy ON raf.monthly_reviews
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- pdf_import_quotas
DROP POLICY IF EXISTS pdf_import_quotas_workspace_policy ON raf.pdf_import_quotas;
CREATE POLICY pdf_import_quotas_workspace_policy ON raf.pdf_import_quotas
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- remi_conversations
DROP POLICY IF EXISTS remi_conversations_workspace_policy ON raf.remi_conversations;
CREATE POLICY remi_conversations_workspace_policy ON raf.remi_conversations
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- remi_messages
DROP POLICY IF EXISTS remi_messages_workspace_policy ON raf.remi_messages;
CREATE POLICY remi_messages_workspace_policy ON raf.remi_messages
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- email_preferences
DROP POLICY IF EXISTS email_preferences_workspace_policy ON raf.email_preferences;
CREATE POLICY email_preferences_workspace_policy ON raf.email_preferences
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);

-- email_send_log
DROP POLICY IF EXISTS email_send_log_workspace_policy ON raf.email_send_log;
CREATE POLICY email_send_log_workspace_policy ON raf.email_send_log
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
);
