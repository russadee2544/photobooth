-- Add missing columns to kiosk_sessions
ALTER TABLE kiosk_sessions
  ADD COLUMN IF NOT EXISTS color_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dithered_url TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_cafe_mode BOOLEAN DEFAULT FALSE;

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON kiosk_sessions(expires_at) WHERE expires_at IS NOT NULL;

-- RLS Policies
ALTER TABLE kiosk_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_insert_sessions" ON kiosk_sessions;
CREATE POLICY "allow_insert_sessions" ON kiosk_sessions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "allow_read_sessions" ON kiosk_sessions;
CREATE POLICY "allow_read_sessions" ON kiosk_sessions FOR SELECT USING (true);
DROP POLICY IF EXISTS "allow_update_sessions" ON kiosk_sessions;
CREATE POLICY "allow_update_sessions" ON kiosk_sessions FOR UPDATE USING (true) WITH CHECK (true);;
