-- Lets the event-photos Edge Function confirm a kiosk admin capability (PIN session)
-- without exposing the app_private tables. Service role only.
create or replace function public.verify_kiosk_admin_capability(p_kiosk_id uuid, p_capability_token text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.kiosks kiosk
    join app_private.kiosk_admin_credentials credential on credential.kiosk_id = kiosk.id
    join app_private.kiosk_admin_capabilities capability
      on capability.kiosk_id = kiosk.id and capability.pin_revision = credential.revision
    where kiosk.id = p_kiosk_id
      and kiosk.status <> 'revoked'
      and capability.token_digest = extensions.digest(
        pg_catalog.convert_to(coalesce(p_capability_token, ''), 'UTF8'), 'sha256')
      and capability.revoked_at is null
      and capability.expires_at > now()
  );
$$;
revoke all on function public.verify_kiosk_admin_capability(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_kiosk_admin_capability(uuid, text) to service_role;
