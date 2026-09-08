CREATE SCHEMA IF NOT EXISTS raf;

DO $$
BEGIN
  CREATE TYPE raf.financial_account_type AS ENUM (
    'checking',
    'savings',
    'credit_card',
    'line_of_credit',
    'loan',
    'investment',
    'cash',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE raf.financial_account_status AS ENUM ('active', 'archived', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE raf.account_reconciliation_status AS ENUM ('open', 'resolved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE raf.account_reconciliation_action AS ENUM (
    'accept_reported_balance',
    'keep_recorded_balance',
    'mark_reviewed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS raf.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  account_type raf.financial_account_type NOT NULL DEFAULT 'checking',
  institution text,
  currency text NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  available_balance numeric(12,2),
  balance_as_of timestamptz NOT NULL DEFAULT now(),
  is_manual boolean NOT NULL DEFAULT true,
  status raf.financial_account_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_accounts_workspace_status
ON raf.financial_accounts (workspace_id, status, name);

CREATE INDEX IF NOT EXISTS idx_financial_accounts_workspace_type
ON raf.financial_accounts (workspace_id, account_type);

ALTER TABLE raf.transactions
ADD COLUMN IF NOT EXISTS account_id uuid;

ALTER TABLE raf.transactions
DROP CONSTRAINT IF EXISTS transactions_account_fk;

ALTER TABLE raf.transactions
ADD CONSTRAINT transactions_account_fk
FOREIGN KEY (account_id, workspace_id)
REFERENCES raf.financial_accounts(id, workspace_id)
ON DELETE SET NULL (account_id);

CREATE INDEX IF NOT EXISTS idx_transactions_workspace_account_date
ON raf.transactions (workspace_id, account_id, transaction_date, id);

ALTER TABLE raf.import_batches
ADD COLUMN IF NOT EXISTS account_id uuid;

ALTER TABLE raf.import_batches
DROP CONSTRAINT IF EXISTS import_batches_account_fk;

ALTER TABLE raf.import_batches
ADD CONSTRAINT import_batches_account_fk
FOREIGN KEY (account_id, workspace_id)
REFERENCES raf.financial_accounts(id, workspace_id)
ON DELETE SET NULL (account_id);

CREATE INDEX IF NOT EXISTS idx_import_batches_workspace_account_status
ON raf.import_batches (workspace_id, account_id, status, created_at DESC);

ALTER TABLE raf.imported_transaction_rows
ADD COLUMN IF NOT EXISTS account_id uuid;

ALTER TABLE raf.imported_transaction_rows
DROP CONSTRAINT IF EXISTS imported_rows_account_fk;

ALTER TABLE raf.imported_transaction_rows
ADD CONSTRAINT imported_rows_account_fk
FOREIGN KEY (account_id, workspace_id)
REFERENCES raf.financial_accounts(id, workspace_id)
ON DELETE SET NULL (account_id);

ALTER TABLE raf.imported_transactions
ADD COLUMN IF NOT EXISTS account_id uuid;

ALTER TABLE raf.imported_transactions
DROP CONSTRAINT IF EXISTS imported_transactions_account_fk;

ALTER TABLE raf.imported_transactions
ADD CONSTRAINT imported_transactions_account_fk
FOREIGN KEY (account_id, workspace_id)
REFERENCES raf.financial_accounts(id, workspace_id)
ON DELETE SET NULL (account_id);

CREATE TABLE IF NOT EXISTS raf.account_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  recorded_balance numeric(12,2) NOT NULL,
  reported_balance numeric(12,2) NOT NULL,
  discrepancy numeric(12,2) NOT NULL,
  reported_as_of timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  status raf.account_reconciliation_status NOT NULL DEFAULT 'open',
  resolved_action raf.account_reconciliation_action,
  note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT account_reconciliations_account_fk FOREIGN KEY (account_id, workspace_id)
    REFERENCES raf.financial_accounts(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT account_reconciliations_resolution_chk CHECK (
    (status = 'open' AND resolved_action IS NULL AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_action IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_account_reconciliations_workspace_account_status
ON raf.account_reconciliations (workspace_id, account_id, status, reported_as_of DESC);

DROP TRIGGER IF EXISTS trg_financial_accounts_set_updated_at ON raf.financial_accounts;
CREATE TRIGGER trg_financial_accounts_set_updated_at BEFORE UPDATE ON raf.financial_accounts
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();

DROP TRIGGER IF EXISTS trg_account_reconciliations_set_updated_at ON raf.account_reconciliations;
CREATE TRIGGER trg_account_reconciliations_set_updated_at BEFORE UPDATE ON raf.account_reconciliations
FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();

ALTER TABLE raf.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.account_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.financial_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE raf.account_reconciliations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_accounts_workspace_policy ON raf.financial_accounts;
CREATE POLICY financial_accounts_workspace_policy ON raf.financial_accounts
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));

DROP POLICY IF EXISTS account_reconciliations_workspace_policy ON raf.account_reconciliations;
CREATE POLICY account_reconciliations_workspace_policy ON raf.account_reconciliations
USING (raf.has_workspace_membership(workspace_id))
WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[]));
