-- ============================================================
-- A. Finance tables: enable RLS and lock to service_role only
-- ============================================================
alter table public.transactions enable row level security;
alter table public.debts enable row level security;

revoke all on public.transactions from anon;
revoke all on public.transactions from authenticated;
revoke all on public.debts from anon;
revoke all on public.debts from authenticated;

-- ============================================================
-- B. custom_themes: SELECT + INSERT only, drop duplicates
-- ============================================================
drop policy if exists "Allow public custom_themes delete" on public.custom_themes;
drop policy if exists "Allow public custom_themes insert" on public.custom_themes;
drop policy if exists "Allow public custom_themes select" on public.custom_themes;
drop policy if exists "Allow public delete for custom_themes" on public.custom_themes;
drop policy if exists "Allow public insert for custom_themes" on public.custom_themes;
drop policy if exists "Allow public read access for custom_themes" on public.custom_themes;

create policy "custom_themes_select" on public.custom_themes
  for select to anon, authenticated
  using (true);

create policy "custom_themes_insert" on public.custom_themes
  for insert to anon, authenticated
  with check (true);

revoke delete, truncate, references, trigger on public.custom_themes from anon;

-- ============================================================
-- C. kiosk_sessions: SELECT/INSERT/UPDATE, drop duplicates
-- ============================================================
drop policy if exists "Allow public insert access" on public.kiosk_sessions;
drop policy if exists "Allow public read access" on public.kiosk_sessions;
drop policy if exists "allow_insert_sessions" on public.kiosk_sessions;
drop policy if exists "allow_read_sessions" on public.kiosk_sessions;
drop policy if exists "allow_update_sessions" on public.kiosk_sessions;

create policy "kiosk_sessions_insert" on public.kiosk_sessions
  for insert to anon, authenticated
  with check (true);

create policy "kiosk_sessions_select" on public.kiosk_sessions
  for select to anon, authenticated
  using (true);

create policy "kiosk_sessions_update" on public.kiosk_sessions
  for update to anon, authenticated
  using (true)
  with check (true);

revoke delete, truncate, references, trigger on public.kiosk_sessions from anon;

-- ============================================================
-- D. layout_sizes: config data, SELECT only for public
-- ============================================================
drop policy if exists "Allow public insert for layout_sizes" on public.layout_sizes;
drop policy if exists "Allow public update for layout_sizes" on public.layout_sizes;
drop policy if exists "Allow public read access for layout_sizes" on public.layout_sizes;

create policy "layout_sizes_select" on public.layout_sizes
  for select to anon, authenticated
  using (true);

revoke insert, update, delete, truncate, references, trigger on public.layout_sizes from anon;

-- ============================================================
-- E. redeem_codes: SELECT + UPDATE only, no anon INSERT minting
-- ============================================================
drop policy if exists "Allow anon insert redeem_codes" on public.redeem_codes;
drop policy if exists "Allow anon read redeem_codes" on public.redeem_codes;
drop policy if exists "Allow public redeem_codes insert" on public.redeem_codes;
drop policy if exists "Allow public redeem_codes select" on public.redeem_codes;
drop policy if exists "Allow public redeem_codes update" on public.redeem_codes;
drop policy if exists "allow_insert" on public.redeem_codes;
drop policy if exists "allow_read" on public.redeem_codes;
drop policy if exists "allow_update" on public.redeem_codes;

create policy "redeem_codes_select" on public.redeem_codes
  for select to anon, authenticated
  using (true);

create policy "redeem_codes_update" on public.redeem_codes
  for update to anon, authenticated
  using (true)
  with check (true);

revoke insert, delete, truncate, references, trigger on public.redeem_codes from anon;

-- ============================================================
-- F. redeem_usage: clean duplicate anon policies
-- ============================================================
drop policy if exists "Allow anon insert redeem_usage" on public.redeem_usage;
drop policy if exists "Allow anon read redeem_usage" on public.redeem_usage;

create policy "redeem_usage_insert" on public.redeem_usage
  for insert to anon, authenticated
  with check (true);

create policy "redeem_usage_select" on public.redeem_usage
  for select to anon, authenticated
  using (true);

revoke delete, truncate, references, trigger on public.redeem_usage from anon;;
