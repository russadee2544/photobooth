-- Daily cleanup at 04:00 Bangkok (21:00 UTC): customer photos past their expiry and
-- expired GIFs. Event photos are exempt (see functions/photo-retention).
-- Needs the Vault secret 'purge_secret' (same value as the PHOTO_PURGE_SECRET /
-- GIF_PURGE_SECRET function secrets); create it once with:
--   select vault.create_secret('<value>', 'purge_secret');
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-retention') then
    perform cron.unschedule('daily-retention');
  end if;
end $$;

select cron.schedule('daily-retention', '0 21 * * *', $job$
  select net.http_post(
    url := 'https://zualrdvvlcoexqrbedhl.supabase.co/functions/v1/photo-retention',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-purge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'purge_secret')),
    body := '{}'::jsonb);
  select net.http_post(
    url := 'https://zualrdvvlcoexqrbedhl.supabase.co/functions/v1/session-gif',
    headers := jsonb_build_object('content-type', 'application/json',
      'x-purge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'purge_secret')),
    body := '{"operation":"purge"}'::jsonb);
$job$);
