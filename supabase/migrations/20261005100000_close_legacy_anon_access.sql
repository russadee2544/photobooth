-- Close legacy anonymous access found in the RLS review (2026-10-05).
--  * kiosk_sessions: anon could READ every customer's photo URLs and UPDATE any row.
--    The kiosk only needs to INSERT a log row; admin analytics now uses a counts RPC.
--  * redeem_usage / redeem_codes: no client uses these any more (redeem goes through
--    Edge Functions with the service role), so anon/authenticated get nothing.
-- Not touched here: custom_themes (anon select/insert is still used by the admin theme
-- builder) and the public 'photobooth' storage bucket (see docs/RLS_REVIEW.md).
begin;

-- ---- redeem_usage / redeem_codes: deny everything to client roles -------------------
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('redeem_usage', 'redeem_codes')
      and (roles && array['anon', 'authenticated', 'public']::name[])
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;
revoke all on table public.redeem_usage from anon, authenticated;
revoke all on table public.redeem_codes from anon, authenticated;

-- ---- kiosk_sessions: insert-only for clients ----------------------------------------
drop policy if exists "kiosk_sessions_select" on public.kiosk_sessions;
drop policy if exists "kiosk_sessions_update" on public.kiosk_sessions;
drop policy if exists "kiosk_sessions_insert" on public.kiosk_sessions;
revoke select, update, delete, truncate on public.kiosk_sessions from anon, authenticated;

create policy "kiosk_sessions_insert" on public.kiosk_sessions
  for insert to anon, authenticated
  with check (
    kiosk_mode in ('event', 'normal', 'redeem')
    and coalesce(char_length(event_name), 0) <= 100
    and (color_url is null
         or color_url like 'https://zualrdvvlcoexqrbedhl.supabase.co/storage/v1/object/public/photobooth/%')
    and (dithered_url is null
         or dithered_url like 'https://zualrdvvlcoexqrbedhl.supabase.co/storage/v1/object/public/photobooth/%')
  );

-- Aggregate counts only, so the admin dashboard no longer needs to read the rows.
create or replace function public.kiosk_session_counts()
returns table (kiosk_mode text, total bigint)
language sql stable security definer set search_path = '' as $$
  select s.kiosk_mode::text, count(*)::bigint from public.kiosk_sessions s group by s.kiosk_mode;
$$;
revoke all on function public.kiosk_session_counts() from public;
grant execute on function public.kiosk_session_counts() to anon, authenticated, service_role;

commit;
