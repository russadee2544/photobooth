-- Photo uploads and their log rows are now written only by the session-photo Edge Function
-- (service role). Remove the last anonymous write paths.
drop policy if exists "Allow public uploads" on storage.objects;

drop policy if exists "kiosk_sessions_insert" on public.kiosk_sessions;
revoke insert on table public.kiosk_sessions from anon, authenticated;
