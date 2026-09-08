BEGIN;

-- ── Workspace Invitations ───────────────────────────────────────────────────

DO $$
BEGIN
  CREATE TYPE raf.invitation_status AS ENUM ('pending', 'accepted', 'declined', 'expired', 'revoked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS raf.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES raf.app_users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role raf.workspace_role NOT NULL DEFAULT 'member',
  token text NOT NULL UNIQUE,          -- SHA-256 hash of the raw token; raw token only exists in the invitation URL
  status raf.invitation_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invitations_pending_email
  ON raf.workspace_invitations (workspace_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_token
  ON raf.workspace_invitations (token)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace_status
  ON raf.workspace_invitations (workspace_id, status, created_at DESC);

CREATE TRIGGER trg_workspace_invitations_set_updated_at
  BEFORE UPDATE ON raf.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION raf.set_updated_at();

ALTER TABLE raf.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.workspace_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_invitations_member_policy ON raf.workspace_invitations
  USING (raf.has_workspace_membership(workspace_id))
  WITH CHECK (raf.has_workspace_role(workspace_id, ARRAY['owner', 'admin']::raf.workspace_role[]));

-- ── Workspace Activity Log ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS raf.workspace_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES raf.workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES raf.app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_activity_workspace_created
  ON raf.workspace_activity (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_activity_actor
  ON raf.workspace_activity (workspace_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_activity_entity
  ON raf.workspace_activity (workspace_id, entity_type, entity_id)
  WHERE entity_type IS NOT NULL;

ALTER TABLE raf.workspace_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE raf.workspace_activity FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_activity_read_policy ON raf.workspace_activity
  FOR SELECT USING (raf.has_workspace_membership(workspace_id));

CREATE POLICY workspace_activity_insert_policy ON raf.workspace_activity
  FOR INSERT WITH CHECK (raf.has_workspace_membership(workspace_id));

COMMIT;
