-- Add single-use fields to redeem_codes table
ALTER TABLE redeem_codes
  ADD COLUMN IF NOT EXISTS is_used BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days');

-- Index for fast validation queries
CREATE INDEX IF NOT EXISTS idx_redeem_codes_code_status ON redeem_codes(code, is_used, expires_at);

-- RLS: allow anon to PATCH (mark as used)
DROP POLICY IF EXISTS "allow_update" ON redeem_codes;
CREATE POLICY "allow_update" ON redeem_codes FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_read" ON redeem_codes;
CREATE POLICY "allow_read" ON redeem_codes FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_insert" ON redeem_codes;
CREATE POLICY "allow_insert" ON redeem_codes FOR INSERT WITH CHECK (true);;
