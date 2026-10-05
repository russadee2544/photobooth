-- Animated GIF downloads. Additive: existing rows and assets are untouched.
--  * booth_sessions may now bind to a print pass (redeem) or to a kiosk-verified
--    session without an events row (event), alongside the legacy forms.
--  * final_assets gains the 'animated_gif' kind and a content type.
--  * Upload tickets let the browser upload one GIF for one session without
--    ever holding the device credential or a service key.
begin;

alter table public.booth_sessions
  add column print_pass_id uuid references public.redeem_print_passes(id) on delete restrict;
create index booth_sessions_print_pass_id_idx on public.booth_sessions(print_pass_id);

alter table public.booth_sessions drop constraint booth_sessions_check;
alter table public.booth_sessions add constraint booth_sessions_check check (
  (mode = 'redeem' and event_id is null
    and ((entitlement_id is not null and print_pass_id is null)
      or (entitlement_id is null and print_pass_id is not null)))
  or (mode = 'event' and entitlement_id is null and print_pass_id is null)
);

alter table public.final_assets drop constraint final_assets_asset_kind_check;
alter table public.final_assets add constraint final_assets_asset_kind_check
  check (asset_kind in ('final_color', 'final_dither', 'animated_gif'));
alter table public.final_assets add column content_type text
  check (content_type is null or content_type in ('image/png', 'image/jpeg', 'image/gif'));
alter table public.final_assets add constraint final_assets_gif_expiry_check
  check (asset_kind <> 'animated_gif' or (content_type = 'image/gif' and purge_after is not null));

update storage.buckets
  set allowed_mime_types = array['image/png', 'image/jpeg', 'image/gif']::text[],
      file_size_limit = 20971520
  where id = 'photobooth-private';

create table app_private.gif_upload_tickets (
  ticket_digest bytea primary key,
  kiosk_id uuid not null references public.kiosks(id) on delete cascade,
  session_id uuid not null references public.booth_sessions(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index gif_upload_tickets_session_idx on app_private.gif_upload_tickets(session_id);
revoke all on app_private.gif_upload_tickets from public, anon, authenticated;

-- Called with an already-authenticated kiosk (Edge Function checked the device
-- credential). Redeem tickets require the live print-pass session token.
create function public.issue_gif_upload_ticket(
  p_kiosk_id uuid, p_session_id uuid, p_mode text,
  p_pass_id uuid default null, p_pass_session_token text default null,
  p_package_id uuid default null
)
returns table (ticket text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_package uuid;
  v_existing public.booth_sessions%rowtype;
  v_ticket text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_expires timestamptz := now() + interval '3 hours';
begin
  if p_mode not in ('event', 'redeem') then
    raise exception using errcode = '22023', message = 'invalid_mode';
  end if;
  select kiosk.workspace_id into v_workspace from public.kiosks kiosk
    where kiosk.id = p_kiosk_id and kiosk.status = 'active';
  if v_workspace is null then
    raise exception using errcode = 'P0001', message = 'kiosk_not_active';
  end if;

  if p_mode = 'redeem' then
    select pass.package_id into v_package from public.redeem_print_passes pass
      where pass.id = p_pass_id and pass.kiosk_id = p_kiosk_id and pass.state = 'active'
        and pass.session_digest = extensions.digest(
          pg_catalog.convert_to(coalesce(p_pass_session_token, ''), 'UTF8'), 'sha256')
        and pass.session_until > now();
    if v_package is null then
      raise exception using errcode = 'P0001', message = 'pass_session_invalid';
    end if;
  else
    select package.id into v_package from public.booth_packages package
      where package.workspace_id = v_workspace and package.enabled
        and (p_package_id is null or package.id = p_package_id)
      order by package.created_at limit 1;
    if v_package is null then
      raise exception using errcode = 'P0001', message = 'package_unavailable';
    end if;
  end if;

  insert into public.booth_sessions (id, workspace_id, kiosk_id, package_id, mode,
    print_pass_id, status, config_version)
  values (p_session_id, v_workspace, p_kiosk_id, v_package, p_mode,
    case when p_mode = 'redeem' then p_pass_id end, 'capturing', 1)
  on conflict (id) do nothing;
  select * into v_existing from public.booth_sessions where id = p_session_id;
  if v_existing.kiosk_id <> p_kiosk_id or v_existing.mode <> p_mode
     or v_existing.print_pass_id is distinct from (case when p_mode = 'redeem' then p_pass_id end) then
    raise exception using errcode = 'P0001', message = 'session_conflict';
  end if;

  delete from app_private.gif_upload_tickets
    where app_private.gif_upload_tickets.expires_at < now() - interval '1 day';
  insert into app_private.gif_upload_tickets (ticket_digest, kiosk_id, session_id, expires_at)
  values (extensions.digest(v_ticket, 'sha256'), p_kiosk_id, p_session_id, v_expires);
  ticket := v_ticket;
  expires_at := v_expires;
  return next;
end;
$$;
revoke all on function public.issue_gif_upload_ticket(uuid, uuid, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.issue_gif_upload_ticket(uuid, uuid, text, uuid, text, uuid)
  to service_role;

-- Read-only check before the storage upload.
create function public.check_gif_upload_ticket(p_ticket text)
returns table (session_id uuid, workspace_id uuid, kiosk_id uuid)
language sql security definer set search_path = '' as $$
  select session.id, session.workspace_id, session.kiosk_id
  from app_private.gif_upload_tickets t
  join public.booth_sessions session on session.id = t.session_id
  where t.ticket_digest = extensions.digest(coalesce(p_ticket, ''), 'sha256')
    and t.used_at is null and t.expires_at > now()
    and not exists (select 1 from public.final_assets asset
      where asset.session_id = session.id and asset.asset_kind = 'animated_gif');
$$;
revoke all on function public.check_gif_upload_ticket(text) from public, anon, authenticated;
grant execute on function public.check_gif_upload_ticket(text) to service_role;

-- After the object is stored: burn the ticket and record the asset atomically.
create function public.record_gif_asset(
  p_ticket text, p_storage_key text, p_sha256_hex text, p_byte_size bigint
)
returns table (asset_id uuid, purge_after timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_ticket app_private.gif_upload_tickets%rowtype;
  v_workspace uuid;
  v_id uuid := gen_random_uuid();
  v_purge timestamptz := now() + interval '24 hours';
begin
  select * into v_ticket from app_private.gif_upload_tickets
    where ticket_digest = extensions.digest(coalesce(p_ticket, ''), 'sha256')
      and used_at is null and expires_at > now()
    for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ticket_invalid';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 20971520 then
    raise exception using errcode = '22023', message = 'too_large';
  end if;
  select workspace_id into v_workspace from public.booth_sessions where id = v_ticket.session_id;
  insert into public.final_assets (id, session_id, workspace_id, asset_kind, storage_key,
    sha256_hex, byte_size, purge_after, content_type)
  values (v_id, v_ticket.session_id, v_workspace, 'animated_gif', p_storage_key,
    p_sha256_hex, p_byte_size, v_purge, 'image/gif');
  update app_private.gif_upload_tickets set used_at = now()
    where ticket_digest = v_ticket.ticket_digest;
  asset_id := v_id;
  purge_after := v_purge;
  return next;
end;
$$;
revoke all on function public.record_gif_asset(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_gif_asset(text, text, text, bigint) to service_role;

-- Download lookup for the short QR link. The random asset id is the capability;
-- nothing is returned once the 24-hour window has passed.
create function public.get_gif_asset_for_download(p_asset_id uuid)
returns text language sql security definer set search_path = '' as $$
  select storage_key from public.final_assets
  where id = p_asset_id and asset_kind = 'animated_gif' and purge_after > now();
$$;
revoke all on function public.get_gif_asset_for_download(uuid) from public, anon, authenticated;
grant execute on function public.get_gif_asset_for_download(uuid) to service_role;

-- Expired GIFs, oldest first. The Edge Function removes the storage object,
-- then deletes the metadata with delete_gif_assets.
create function public.list_expired_gif_assets(p_limit integer default 50)
returns table (asset_id uuid, storage_key text)
language sql security definer set search_path = '' as $$
  select id, storage_key from public.final_assets
  where asset_kind = 'animated_gif' and purge_after <= now()
  order by purge_after limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke all on function public.list_expired_gif_assets(integer) from public, anon, authenticated;
grant execute on function public.list_expired_gif_assets(integer) to service_role;

create function public.delete_gif_assets(p_asset_ids uuid[])
returns integer language sql security definer set search_path = '' as $$
  with gone as (
    delete from public.final_assets
    where id = any(p_asset_ids) and asset_kind = 'animated_gif' and purge_after <= now()
    returning 1)
  select count(*)::integer from gone;
$$;
revoke all on function public.delete_gif_assets(uuid[]) from public, anon, authenticated;
grant execute on function public.delete_gif_assets(uuid[]) to service_role;

commit;
