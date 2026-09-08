BEGIN;

CREATE SCHEMA IF NOT EXISTS raf;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE raf.workspace_type AS ENUM ('personal', 'household');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE raf.workspace_role AS ENUM ('owner', 'admin', 'member', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE raf.workspace_member_status AS ENUM ('active', 'invited', 'suspended');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION raf.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS raf.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text,
  remi_tier text NOT NULL DEFAULT 'free' CHECK (remi_tier IN ('free', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS raf.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type raf.workspace_type NOT NULL DEFAULT 'household',
  owner_user_id uuid NOT NULL REFERENCES raf.app_users(id) ON DELETE RESTRICT,
  default_currency char(3) NOT NULL DEFAULT 'CAD',
  timezone text NOT NULL DEFAULT 'America/Toronto',
  country char(2) NOT NULL DEFAULT 'CA',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id ON raf.workspaces (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_type ON raf.workspaces (type);

CREATE TABLE IF NOT EXISTS raf.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES raf.app_users(id) ON DELETE CASCADE,
  role raf.workspace_role NOT NULL DEFAULT 'member',
  status raf.workspace_member_status NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(),
  invited_by uuid REFERENCES raf.app_users(id) ON DELETE SET NULL,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON raf.workspace_members (user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON raf.workspace_members (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_active_user ON raf.workspace_members (user_id, workspace_id) WHERE status = 'active';

-- Household remains a consumer-facing settings record. In Phase 2 it maps 1:1 to a workspace.
CREATE TABLE IF NOT EXISTS raf.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES raf.app_users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Toronto',
  active_month date NOT NULL,
  period_start_day int NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 28),
  savings_floor numeric(12,2) NOT NULL DEFAULT 0 CHECK (savings_floor >= 0),
  savings_floor_enabled boolean NOT NULL DEFAULT false,
  monthly_essentials_baseline numeric(12,2) NOT NULL DEFAULT 0 CHECK (monthly_essentials_baseline >= 0),
  pdf_import_quota_tier text NOT NULL DEFAULT 'free' CHECK (pdf_import_quota_tier IN ('free', 'paid')),
  pdf_import_quota_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_households_id_workspace_unique ON raf.households (id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_households_workspace_id ON raf.households (workspace_id);

CREATE TABLE IF NOT EXISTS raf.allocation_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL,
  slug text NOT NULL,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  allocation_percent numeric(6,4) NOT NULL CHECK (allocation_percent >= 0 AND allocation_percent <= 1),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_buffer boolean NOT NULL DEFAULT false,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  superseded_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_allocation_categories_workspace_snapshot_slug
ON raf.allocation_categories (workspace_id, snapshot_id, slug);
CREATE INDEX IF NOT EXISTS idx_allocation_categories_workspace_active
ON raf.allocation_categories (workspace_id, is_active, effective_from);

CREATE TABLE IF NOT EXISTS raf.surplus_split_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  split_percent numeric(6,4) NOT NULL CHECK (split_percent >= 0 AND split_percent <= 1),
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  destination_type text NOT NULL DEFAULT 'bucket' CHECK (destination_type IN ('bucket', 'goal', 'debt')),
  destination_bucket_slug text,
  destination_goal_id uuid,
  destination_debt_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (workspace_id, slug),
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_surplus_split_rules_workspace_active
ON raf.surplus_split_rules (workspace_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS raf.income_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  received_date date NOT NULL,
  notes text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_income_entries_workspace_received_date
ON raf.income_entries (workspace_id, received_date);

CREATE TABLE IF NOT EXISTS raf.debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  starting_balance numeric(12,2) NOT NULL CHECK (starting_balance > 0),
  apr numeric(5,2) NOT NULL DEFAULT 0 CHECK (apr >= 0),
  minimum_payment numeric(12,2) NOT NULL DEFAULT 0 CHECK (minimum_payment >= 0),
  monthly_payment numeric(12,2) NOT NULL DEFAULT 0 CHECK (monthly_payment >= 0),
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_debts_workspace_active ON raf.debts (workspace_id, is_active);

CREATE TABLE IF NOT EXISTS raf.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  bucket_id uuid NOT NULL,
  name text NOT NULL,
  target_amount numeric(12,2) NOT NULL CHECK (target_amount > 0),
  target_date date,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id),
  CONSTRAINT goals_bucket_fk FOREIGN KEY (bucket_id, workspace_id)
    REFERENCES raf.allocation_categories(id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_goals_workspace_active ON raf.goals (workspace_id, active);

CREATE TABLE IF NOT EXISTS raf.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  filename text,
  source text,
  status text NOT NULL DEFAULT 'pending',
  row_count int NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_import_batches_workspace_status ON raf.import_batches (workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS raf.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  description text NOT NULL,
  merchant text,
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  category_id uuid,
  linked_debt_id uuid,
  linked_goal_id uuid,
  import_batch_id uuid,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id),
  CONSTRAINT transactions_amount_direction_chk CHECK (amount > 0 OR (amount < 0 AND direction = 'credit')),
  CONSTRAINT transactions_category_fk FOREIGN KEY (category_id, workspace_id)
    REFERENCES raf.allocation_categories(id, workspace_id),
  CONSTRAINT transactions_linked_debt_fk FOREIGN KEY (linked_debt_id, workspace_id)
    REFERENCES raf.debts(id, workspace_id),
  CONSTRAINT transactions_linked_goal_fk FOREIGN KEY (linked_goal_id, workspace_id)
    REFERENCES raf.goals(id, workspace_id),
  CONSTRAINT transactions_import_batch_fk FOREIGN KEY (import_batch_id, workspace_id)
    REFERENCES raf.import_batches(id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_workspace_transaction_date
ON raf.transactions (workspace_id, transaction_date, id);
CREATE INDEX IF NOT EXISTS idx_transactions_workspace_dedup
ON raf.transactions (workspace_id, transaction_date, amount, merchant);

CREATE TABLE IF NOT EXISTS raf.income_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  income_entry_id uuid NOT NULL,
  allocation_category_id uuid NOT NULL,
  allocated_amount numeric(12,2) NOT NULL CHECK (allocated_amount >= 0),
  allocation_percent numeric(6,4) NOT NULL CHECK (allocation_percent >= 0 AND allocation_percent <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT income_allocations_income_entry_fk FOREIGN KEY (income_entry_id, workspace_id)
    REFERENCES raf.income_entries(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT income_allocations_category_fk FOREIGN KEY (allocation_category_id, workspace_id)
    REFERENCES raf.allocation_categories(id, workspace_id),
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_income_allocations_workspace_income
ON raf.income_allocations (workspace_id, income_entry_id);

CREATE TABLE IF NOT EXISTS raf.debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL,
  transaction_id uuid,
  payment_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT debt_payments_debt_fk FOREIGN KEY (debt_id, workspace_id)
    REFERENCES raf.debts(id, workspace_id),
  CONSTRAINT debt_payments_transaction_fk FOREIGN KEY (transaction_id, workspace_id)
    REFERENCES raf.transactions(id, workspace_id) ON DELETE SET NULL,
  UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_payments_workspace_transaction_unique
ON raf.debt_payments (workspace_id, transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debt_payments_workspace_payment_date
ON raf.debt_payments (workspace_id, payment_date);

CREATE TABLE IF NOT EXISTS raf.debt_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('interest', 'fee', 'correction')),
  effective_date date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT debt_adjustments_debt_fk FOREIGN KEY (debt_id, workspace_id)
    REFERENCES raf.debts(id, workspace_id),
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_debt_adjustments_workspace_debt
ON raf.debt_adjustments (workspace_id, debt_id, effective_date);

CREATE TABLE IF NOT EXISTS raf.fixed_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  category_slug text NOT NULL,
  expected_amount numeric(12,2) NOT NULL CHECK (expected_amount >= 0),
  due_day_of_month int NOT NULL CHECK (due_day_of_month BETWEEN 1 AND 28),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_fixed_bills_workspace_active
ON raf.fixed_bills (workspace_id, active, due_day_of_month);

CREATE TABLE IF NOT EXISTS raf.imported_transaction_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'unreviewed',
  parsed_date date,
  parsed_amount numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT imported_rows_batch_fk FOREIGN KEY (batch_id, workspace_id)
    REFERENCES raf.import_batches(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_imported_rows_workspace_batch
ON raf.imported_transaction_rows (workspace_id, batch_id);

CREATE TABLE IF NOT EXISTS raf.imported_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'unreviewed',
  classification_type text,
  linked_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT imported_transactions_linked_transaction_fk FOREIGN KEY (linked_transaction_id, workspace_id)
    REFERENCES raf.transactions(id, workspace_id) ON DELETE SET NULL,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_imported_transactions_workspace_status
ON raf.imported_transactions (workspace_id, status, date);

CREATE TABLE IF NOT EXISTS raf.merchant_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  match_type text NOT NULL DEFAULT 'contains',
  match_value text NOT NULL,
  category_id uuid,
  priority int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT merchant_rules_category_fk FOREIGN KEY (category_id, workspace_id)
    REFERENCES raf.allocation_categories(id, workspace_id),
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_rules_workspace_priority
ON raf.merchant_rules (workspace_id, priority DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS raf.import_review_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  rule_type text NOT NULL DEFAULT 'suggestion',
  match_value text NOT NULL,
  auto_apply boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_import_review_rules_workspace_auto
ON raf.import_review_rules (workspace_id, auto_apply, updated_at DESC);

CREATE TABLE IF NOT EXISTS raf.monthly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  review_month date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  net_surplus numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (workspace_id, review_month),
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_reviews_workspace_month
ON raf.monthly_reviews (workspace_id, review_month);

CREATE TABLE IF NOT EXISTS raf.pdf_import_quotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  year_month text NOT NULL CHECK (year_month ~ '^\d{4}-\d{2}$'),
  count int NOT NULL DEFAULT 0 CHECK (count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (workspace_id, year_month)
);

CREATE TABLE IF NOT EXISTS raf.remi_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES raf.app_users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_remi_conversations_workspace_user
ON raf.remi_conversations (workspace_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS raf.remi_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  tokens_used int NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT remi_messages_conversation_fk FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES raf.remi_conversations(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_remi_messages_workspace_conversation
ON raf.remi_messages (workspace_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS raf.email_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  reminders_enabled boolean NOT NULL DEFAULT true,
  preferred_day text NOT NULL DEFAULT 'monday',
  preferred_hour int NOT NULL DEFAULT 9 CHECK (preferred_hour BETWEEN 0 AND 23),
  timezone text NOT NULL DEFAULT 'America/Toronto',
  contact_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS raf.email_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  reminder_type text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_email_send_log_workspace_sent
ON raf.email_send_log (workspace_id, sent_at DESC);

CREATE OR REPLACE FUNCTION raf.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = raf, pg_catalog
AS $$
  SELECT NULLIF(current_setting('raf.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION raf.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = raf, pg_catalog
AS $$
  SELECT NULLIF(current_setting('raf.workspace_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION raf.has_workspace_membership(target_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = raf, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM raf.workspace_members wm
    WHERE wm.workspace_id = target_workspace_id
      AND (raf.current_workspace_id() IS NULL OR target_workspace_id = raf.current_workspace_id())
      AND wm.user_id = raf.current_app_user_id()
      AND wm.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION raf.has_workspace_role(target_workspace_id uuid, allowed_roles raf.workspace_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = raf, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM raf.workspace_members wm
    WHERE wm.workspace_id = target_workspace_id
      AND (raf.current_workspace_id() IS NULL OR target_workspace_id = raf.current_workspace_id())
      AND wm.user_id = raf.current_app_user_id()
      AND wm.status = 'active'
      AND wm.role = ANY(allowed_roles)
  )
$$;

REVOKE ALL ON FUNCTION raf.current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION raf.current_workspace_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION raf.has_workspace_membership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION raf.has_workspace_role(uuid, raf.workspace_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION raf.current_app_user_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION raf.current_workspace_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION raf.has_workspace_membership(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION raf.has_workspace_role(uuid, raf.workspace_role[]) TO PUBLIC;

CREATE OR REPLACE FUNCTION raf.enforce_active_allocation_percent_sum()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_workspace uuid;
  active_count int;
  pct_sum numeric(10,4);
BEGIN
  target_workspace := COALESCE(NEW.workspace_id, OLD.workspace_id);

  SELECT COUNT(*), COALESCE(SUM(allocation_percent), 0)
    INTO active_count, pct_sum
  FROM raf.allocation_categories
  WHERE workspace_id = target_workspace AND is_active = true AND superseded_at IS NULL;

  IF active_count > 0 AND ABS(pct_sum - 1.0000) > 0.0001 THEN
    RAISE EXCEPTION 'Active allocation percentages must sum to 1.0000 +/- 0.0001 for workspace % (found %)',
      target_workspace, pct_sum;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION raf.enforce_active_surplus_split_percent_sum()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_workspace uuid;
  active_count int;
  pct_sum numeric(10,4);
BEGIN
  target_workspace := COALESCE(NEW.workspace_id, OLD.workspace_id);

  SELECT COUNT(*), COALESCE(SUM(split_percent), 0)
    INTO active_count, pct_sum
  FROM raf.surplus_split_rules
  WHERE workspace_id = target_workspace AND is_active = true;

  IF active_count > 0 AND ABS(pct_sum - 1.0000) > 0.0001 THEN
    RAISE EXCEPTION 'Active surplus split percentages must sum to 1.0000 +/- 0.0001 for workspace % (found %)',
      target_workspace, pct_sum;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION raf.enforce_income_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_income_entry_id uuid;
  income_amount numeric(12,2);
  allocated_total numeric(12,2);
BEGIN
  target_income_entry_id := COALESCE(NEW.income_entry_id, OLD.income_entry_id, NEW.id, OLD.id);

  SELECT amount INTO income_amount
  FROM raf.income_entries
  WHERE id = target_income_entry_id;

  IF income_amount IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0.00) INTO allocated_total
  FROM raf.income_allocations
  WHERE income_entry_id = target_income_entry_id;

  IF allocated_total <> income_amount THEN
    RAISE EXCEPTION 'Income allocation total must equal deposit amount for income_entry % (expected %, found %)',
      target_income_entry_id, income_amount, allocated_total;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION raf.prevent_debt_delete_with_payments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM raf.debt_payments WHERE workspace_id = OLD.workspace_id AND debt_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete debt % with payments; set is_active = false instead.', OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_allocation_categories_percent_sum
AFTER INSERT OR UPDATE OR DELETE ON raf.allocation_categories
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION raf.enforce_active_allocation_percent_sum();

CREATE CONSTRAINT TRIGGER trg_surplus_split_rules_percent_sum
AFTER INSERT OR UPDATE OR DELETE ON raf.surplus_split_rules
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION raf.enforce_active_surplus_split_percent_sum();

CREATE CONSTRAINT TRIGGER trg_income_entries_allocation_total
AFTER INSERT OR UPDATE ON raf.income_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION raf.enforce_income_allocation_total();

CREATE CONSTRAINT TRIGGER trg_income_allocations_total
AFTER INSERT OR UPDATE OR DELETE ON raf.income_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION raf.enforce_income_allocation_total();

CREATE TRIGGER trg_prevent_debt_delete_with_payments
BEFORE DELETE ON raf.debts
FOR EACH ROW EXECUTE FUNCTION raf.prevent_debt_delete_with_payments();

CREATE TRIGGER trg_app_users_set_updated_at BEFORE UPDATE ON raf.app_users
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_workspaces_set_updated_at BEFORE UPDATE ON raf.workspaces
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_households_set_updated_at BEFORE UPDATE ON raf.households
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_allocation_categories_set_updated_at BEFORE UPDATE ON raf.allocation_categories
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_surplus_split_rules_set_updated_at BEFORE UPDATE ON raf.surplus_split_rules
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_income_entries_set_updated_at BEFORE UPDATE ON raf.income_entries
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_transactions_set_updated_at BEFORE UPDATE ON raf.transactions
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_debts_set_updated_at BEFORE UPDATE ON raf.debts
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_goals_set_updated_at BEFORE UPDATE ON raf.goals
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_import_batches_set_updated_at BEFORE UPDATE ON raf.import_batches
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_imported_transaction_rows_set_updated_at BEFORE UPDATE ON raf.imported_transaction_rows
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_imported_transactions_set_updated_at BEFORE UPDATE ON raf.imported_transactions
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_merchant_rules_set_updated_at BEFORE UPDATE ON raf.merchant_rules
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_import_review_rules_set_updated_at BEFORE UPDATE ON raf.import_review_rules
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_monthly_reviews_set_updated_at BEFORE UPDATE ON raf.monthly_reviews
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();
CREATE TRIGGER trg_email_preferences_set_updated_at BEFORE UPDATE ON raf.email_preferences
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();

ALTER TABLE raf.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.allocation_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.surplus_split_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.income_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.income_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.debt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.debt_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.fixed_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.imported_transaction_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.imported_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.merchant_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.import_review_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.monthly_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.pdf_import_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.remi_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.remi_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.email_send_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE raf.households FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.allocation_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.surplus_split_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.income_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.income_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.debts FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.debt_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.debt_adjustments FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.fixed_bills FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.goals FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.imported_transaction_rows FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.imported_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.merchant_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.import_review_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.monthly_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.pdf_import_quotas FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.remi_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.remi_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.email_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.email_send_log FORCE ROW LEVEL SECURITY;

CREATE POLICY app_users_self_policy ON raf.app_users
USING (id = raf.current_app_user_id())
WITH CHECK (id = raf.current_app_user_id());

CREATE POLICY workspaces_member_policy ON raf.workspaces
USING (raf.has_workspace_membership(id))
WITH CHECK (raf.has_workspace_role(id, ARRAY['owner','admin']::raf.workspace_role[]));

CREATE POLICY workspace_members_visible_policy ON raf.workspace_members
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin']::raf.workspace_role[]));

CREATE POLICY households_workspace_policy ON raf.households
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin']::raf.workspace_role[]));

CREATE POLICY allocation_categories_workspace_policy ON raf.allocation_categories
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY surplus_split_rules_workspace_policy ON raf.surplus_split_rules
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY income_entries_workspace_policy ON raf.income_entries
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY income_allocations_workspace_policy ON raf.income_allocations
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY transactions_workspace_policy ON raf.transactions
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY debts_workspace_policy ON raf.debts
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY debt_payments_workspace_policy ON raf.debt_payments
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY debt_adjustments_workspace_policy ON raf.debt_adjustments
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY fixed_bills_workspace_policy ON raf.fixed_bills
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY goals_workspace_policy ON raf.goals
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY import_batches_workspace_policy ON raf.import_batches
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY imported_transaction_rows_workspace_policy ON raf.imported_transaction_rows
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY imported_transactions_workspace_policy ON raf.imported_transactions
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY merchant_rules_workspace_policy ON raf.merchant_rules
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY import_review_rules_workspace_policy ON raf.import_review_rules
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY monthly_reviews_workspace_policy ON raf.monthly_reviews
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY pdf_import_quotas_workspace_policy ON raf.pdf_import_quotas
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY remi_conversations_workspace_policy ON raf.remi_conversations
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY remi_messages_workspace_policy ON raf.remi_messages
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

CREATE POLICY email_preferences_workspace_policy ON raf.email_preferences
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin']::raf.workspace_role[]));

CREATE POLICY email_send_log_workspace_policy ON raf.email_send_log
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin']::raf.workspace_role[]));

COMMIT;
