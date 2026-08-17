-- Secure shared-admin PIN enrollment, verification, lockout, and capability
-- issuance for provisioned kiosks. Only service_role may execute these RPCs;
-- the public browser client never receives access to app_private tables.

begin;

alter table app_private.kiosk_admin_credentials
  add column if not exists revision integer not null default 1
  check (revision > 0);

create table if not exists app_private.kiosk_admin_capabilities (
  id uuid primary key default gen_random_uuid(),
  kiosk_id uuid not null references public.kiosks(id) on delete cascade,
  token_digest bytea not null unique check (octet_length(token_digest) = 32),
  pin_revision integer not null check (pin_revision > 0),
  scopes text[] not null default array['admin']::text[],
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > issued_at)
);

create index if not exists kiosk_admin_capabilities_active_idx
  on app_private.kiosk_admin_capabilities(kiosk_id, expires_at)
  where revoked_at is null;

revoke all on table app_private.kiosk_admin_capabilities from public, anon, authenticated;

create or replace function public.kiosk_admin_pin_status(p_kiosk_id uuid)
returns table (
  configured boolean,
  must_change boolean,
  failed_attempts integer,
  locked_until timestamptz,
  revision integer
)
language sql
security definer
set search_path = ''
as $$
  select
    credential.kiosk_id is not null,
    coalesce(credential.must_change, false),
    coalesce(credential.failed_attempts, 0)::integer,
    credential.locked_until,
    coalesce(credential.revision, 0)::integer
  from (select 1) seed
  left join app_private.kiosk_admin_credentials credential
    on credential.kiosk_id = p_kiosk_id;
$$;

revoke all on function public.kiosk_admin_pin_status(uuid) from public, anon, authenticated;
grant execute on function public.kiosk_admin_pin_status(uuid) to service_role;

create or replace function public.enroll_kiosk_admin_pin(
  p_kiosk_id uuid,
  p_pin text
)
returns table (
  success boolean,
  capability_token text,
  expires_at timestamptz,
  revision integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_token text;
  v_expires_at timestamptz := now() + interval '15 minutes';
  v_inserted integer;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception using errcode = '22023', message = 'pin_format';
  end if;

  select kiosk.workspace_id
    into v_workspace_id
  from public.kiosks kiosk
  where kiosk.id = p_kiosk_id and kiosk.status <> 'revoked';

  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'kiosk_not_active';
  end if;

  insert into app_private.kiosk_admin_credentials (
    kiosk_id, pin_hash, must_change, failed_attempts, locked_until, revision, changed_at
  )
  values (
    p_kiosk_id,
    extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
    false,
    0,
    null,
    1,
    now()
  )
  on conflict (kiosk_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    raise exception using errcode = 'P0001', message = 'pin_already_configured';
  end if;

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  insert into app_private.kiosk_admin_capabilities (
    kiosk_id, token_digest, pin_revision, expires_at
  ) values (
    p_kiosk_id,
    extensions.digest(pg_catalog.convert_to(v_token, 'UTF8'), 'sha256'),
    1,
    v_expires_at
  );

  insert into public.audit_log (
    workspace_id, kiosk_id, actor_type, action, target_type, target_id, metadata
  ) values (
    v_workspace_id, p_kiosk_id, 'kiosk', 'admin_pin_enrolled',
    'kiosk', p_kiosk_id::text, jsonb_build_object('revision', 1)
  );

  return query select true, v_token, v_expires_at, 1;
end;
$$;

revoke all on function public.enroll_kiosk_admin_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.enroll_kiosk_admin_pin(uuid, text) to service_role;

create or replace function public.verify_kiosk_admin_pin(
  p_kiosk_id uuid,
  p_pin text
)
returns table (
  valid boolean,
  capability_token text,
  expires_at timestamptz,
  locked_until timestamptz,
  failed_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_hash text;
  v_revision integer;
  v_failed integer;
  v_locked_until timestamptz;
  v_delay_seconds integer;
  v_token text;
  v_expires_at timestamptz;
begin
  select kiosk.workspace_id, credential.pin_hash, credential.revision,
         credential.failed_attempts::integer, credential.locked_until
    into v_workspace_id, v_hash, v_revision, v_failed, v_locked_until
  from public.kiosks kiosk
  join app_private.kiosk_admin_credentials credential on credential.kiosk_id = kiosk.id
  where kiosk.id = p_kiosk_id and kiosk.status <> 'revoked'
  for update of credential;

  if v_hash is null then
    raise exception using errcode = 'P0001', message = 'pin_not_configured';
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    return query select false, null::text, null::timestamptz, v_locked_until, v_failed;
    return;
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$'
     or extensions.crypt(p_pin, v_hash) <> v_hash then
    v_failed := v_failed + 1;
    if v_failed >= 5 then
      v_delay_seconds := least(900, (5 * power(2, least(8, v_failed - 5)))::integer);
      v_locked_until := now() + pg_catalog.make_interval(secs => v_delay_seconds);
    else
      v_locked_until := null;
    end if;

    update app_private.kiosk_admin_credentials
      set failed_attempts = v_failed,
          locked_until = v_locked_until
    where kiosk_id = p_kiosk_id;

    insert into public.audit_log (
      workspace_id, kiosk_id, actor_type, action, target_type, target_id, metadata
    ) values (
      v_workspace_id, p_kiosk_id, 'shared_admin', 'admin_login_failed',
      'kiosk', p_kiosk_id::text,
      jsonb_build_object('failed_attempts', v_failed, 'locked_until', v_locked_until)
    );

    return query select false, null::text, null::timestamptz, v_locked_until, v_failed;
    return;
  end if;

  update app_private.kiosk_admin_credentials
    set failed_attempts = 0,
        locked_until = null
  where kiosk_id = p_kiosk_id;

  update app_private.kiosk_admin_capabilities
    set revoked_at = coalesce(revoked_at, now())
  where kiosk_id = p_kiosk_id and revoked_at is null and expires_at <= now();

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + interval '15 minutes';
  insert into app_private.kiosk_admin_capabilities (
    kiosk_id, token_digest, pin_revision, expires_at
  ) values (
    p_kiosk_id,
    extensions.digest(pg_catalog.convert_to(v_token, 'UTF8'), 'sha256'),
    v_revision,
    v_expires_at
  );

  insert into public.audit_log (
    workspace_id, kiosk_id, actor_type, action, target_type, target_id, metadata
  ) values (
    v_workspace_id, p_kiosk_id, 'shared_admin', 'admin_login_succeeded',
    'kiosk', p_kiosk_id::text, jsonb_build_object('revision', v_revision)
  );

  return query select true, v_token, v_expires_at, null::timestamptz, 0;
end;
$$;

revoke all on function public.verify_kiosk_admin_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_kiosk_admin_pin(uuid, text) to service_role;

create or replace function public.change_kiosk_admin_pin(
  p_kiosk_id uuid,
  p_capability_token text,
  p_new_pin text
)
returns table (success boolean, revision integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_capability_id uuid;
  v_current_revision integer;
  v_next_revision integer;
begin
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    raise exception using errcode = '22023', message = 'pin_format';
  end if;

  select kiosk.workspace_id, credential.revision, capability.id
    into v_workspace_id, v_current_revision, v_capability_id
  from public.kiosks kiosk
  join app_private.kiosk_admin_credentials credential on credential.kiosk_id = kiosk.id
  join app_private.kiosk_admin_capabilities capability
    on capability.kiosk_id = kiosk.id
   and capability.pin_revision = credential.revision
  where kiosk.id = p_kiosk_id
    and kiosk.status <> 'revoked'
    and capability.token_digest = extensions.digest(
      pg_catalog.convert_to(coalesce(p_capability_token, ''), 'UTF8'), 'sha256'
    )
    and capability.revoked_at is null
    and capability.expires_at > now()
  for update of credential, capability;

  if v_capability_id is null then
    raise exception using errcode = 'P0001', message = 'admin_capability_invalid';
  end if;

  v_next_revision := v_current_revision + 1;
  update app_private.kiosk_admin_credentials
    set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)),
        must_change = false,
        failed_attempts = 0,
        locked_until = null,
        revision = v_next_revision,
        changed_at = now()
  where kiosk_id = p_kiosk_id;

  update app_private.kiosk_admin_capabilities
    set revoked_at = coalesce(revoked_at, now())
  where kiosk_id = p_kiosk_id and revoked_at is null;

  insert into public.audit_log (
    workspace_id, kiosk_id, actor_type, action, target_type, target_id, metadata
  ) values (
    v_workspace_id, p_kiosk_id, 'shared_admin', 'admin_pin_changed',
    'kiosk', p_kiosk_id::text,
    jsonb_build_object('previous_revision', v_current_revision, 'revision', v_next_revision)
  );

  return query select true, v_next_revision;
end;
$$;

revoke all on function public.change_kiosk_admin_pin(uuid, text, text) from public, anon, authenticated;
grant execute on function public.change_kiosk_admin_pin(uuid, text, text) to service_role;

commit;
