CREATE TABLE IF NOT EXISTS redeem_codes (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  batch_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS redeem_usage (
  id serial PRIMARY KEY,
  code text NOT NULL REFERENCES redeem_codes(code),
  used_date date NOT NULL DEFAULT CURRENT_DATE,
  used_at timestamptz DEFAULT now(),
  UNIQUE(code, used_date)
);

ALTER TABLE redeem_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE redeem_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read redeem_codes" ON redeem_codes FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert redeem_codes" ON redeem_codes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon read redeem_usage" ON redeem_usage FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert redeem_usage" ON redeem_usage FOR INSERT TO anon WITH CHECK (true);;
