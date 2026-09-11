-- Store user acknowledgement of debt payment pace insights without changing plan state.

CREATE TABLE IF NOT EXISTS raf.debt_payment_pace_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL,
  payment_period_month text NOT NULL,
  action text NOT NULL,
  acknowledgement_date timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT debt_payment_pace_ack_period_check CHECK (payment_period_month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT debt_payment_pace_ack_action_check CHECK (action IN ('keep_plan', 'acknowledge_onetime', 'update_plan')),
  CONSTRAINT debt_payment_pace_ack_debt_fk FOREIGN KEY (debt_id, workspace_id)
    REFERENCES raf.debts(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (workspace_id, debt_id, payment_period_month, action)
);

CREATE INDEX IF NOT EXISTS idx_debt_payment_pace_ack_workspace_debt_period
ON raf.debt_payment_pace_acknowledgements (workspace_id, debt_id, payment_period_month);

ALTER TABLE raf.debt_payment_pace_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.debt_payment_pace_acknowledgements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS debt_payment_pace_ack_workspace_policy ON raf.debt_payment_pace_acknowledgements;
CREATE POLICY debt_payment_pace_ack_workspace_policy ON raf.debt_payment_pace_acknowledgements
USING (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_membership(workspace_id)
)
WITH CHECK (
  workspace_id = raf.current_workspace_id()
  AND raf.has_workspace_role(workspace_id, ARRAY['owner','admin','member']::raf.workspace_role[])
);
