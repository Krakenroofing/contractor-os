-- Owner-only sign-in activity tracking: one row per login session,
-- heartbeat-updated last_seen_at as the user navigates. Deny-all RLS
-- (service role only) like the rest of the schema.
CREATE TABLE user_login_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  user_agent text
);
CREATE INDEX user_login_sessions_user_idx ON user_login_sessions (user_id, started_at DESC);
CREATE INDEX user_login_sessions_open_idx ON user_login_sessions (user_id) WHERE ended_at IS NULL;
ALTER TABLE user_login_sessions ENABLE ROW LEVEL SECURITY;
