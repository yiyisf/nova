CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  protocol text NOT NULL,
  base_url text,
  model_id text NOT NULL,
  encrypted_api_key text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  persona text NOT NULL DEFAULT '',
  model_config_id uuid REFERENCES model_configs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  pi_conversation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  tool_name text NOT NULL,
  arguments jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX model_configs_user_id_idx ON model_configs (user_id);
CREATE INDEX bots_user_id_idx ON bots (user_id);
CREATE INDEX conversations_user_id_idx ON conversations (user_id);
CREATE INDEX conversations_bot_id_idx ON conversations (bot_id);
CREATE INDEX approvals_user_id_idx ON approvals (user_id);
CREATE UNIQUE INDEX approvals_task_id_idx ON approvals (task_id);

CREATE OR REPLACE FUNCTION nova_current_user_id() RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.user_id', true), '')::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

ALTER TABLE model_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY model_configs_isolation ON model_configs
  USING (user_id = nova_current_user_id())
  WITH CHECK (user_id = nova_current_user_id());

ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots FORCE ROW LEVEL SECURITY;
CREATE POLICY bots_isolation ON bots
  USING (user_id = nova_current_user_id())
  WITH CHECK (user_id = nova_current_user_id());

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY conversations_isolation ON conversations
  USING (user_id = nova_current_user_id())
  WITH CHECK (user_id = nova_current_user_id());

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY approvals_isolation ON approvals
  USING (user_id = nova_current_user_id())
  WITH CHECK (user_id = nova_current_user_id());
