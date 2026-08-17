-- Admin-authorized redeem batches. Raw codes are returned exactly once and are
-- expected to be held by encrypted native print storage; Postgres keeps hashes.

begin;

alter table public.redeem_entitlements
  add column if not exists printed_at timestamptz,
  add column if not exists print_job_id uuid;

create index if not exists redeem_entitlements_unprinted_idx
  on public.redeem_entitlements(kiosk_id, created_at)
  where printed_at is null and state = 'active';

create or replace function public.generate_kiosk_redeem_batch(
  p_kiosk_id uuid,
  p_package_id uuid,
  p_capability_token text,
  p_count integer default 50,
  p_expires_days integer default 30
)
returns table (
  entitlement_id uuid,
  batch_id uuid,
  code text,
  code_hint text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_pin_revision integer;
  v_batch_id uuid;
  v_entitlement_id uuid;
  v_code text;
  v_hint text;
  v_expires_at timestamptz;
  v_letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_number integer;
  v_inserted boolean;
begin
  if p_count is null or p_count < 1 or p_count > 500
     or p_expires_days is null or p_expires_days < 1 or p_expires_days > 365 then
    raise exception using errcode = '22023', message = 'invalid_batch_parameters';
  end if;

  select kiosk.workspace_id, credential.revision
    into v_workspace_id, v_pin_revision
  from public.kiosks kiosk
  join public.booth_packages package
    on package.id = p_package_id
   and package.workspace_id = kiosk.workspace_id
   and package.enabled
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
    and capability.expires_at > now();

  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'admin_capability_invalid';
  end if;

  v_expires_at := now() + pg_catalog.make_interval(days => p_expires_days);
  insert into public.redeem_batches (
    workspace_id, kiosk_id, package_id, state, expires_at, activated_at
  ) values (
    v_workspace_id, p_kiosk_id, p_package_id, 'active', v_expires_at, now()
  ) returning id into v_batch_id;

  for index_counter in 1..p_count loop
    v_inserted := false;
    while not v_inserted loop
      v_bytes := extensions.gen_random_bytes(4);
      v_number := ((get_byte(v_bytes, 2) * 256) + get_byte(v_bytes, 3)) % 10000;
      v_code := substr(v_letters, (get_byte(v_bytes, 0) % length(v_letters)) + 1, 1)
             || substr(v_letters, (get_byte(v_bytes, 1) % length(v_letters)) + 1, 1)
             || lpad(v_number::text, 4, '0');
      v_hint := left(v_code, 2) || '••' || right(v_code, 2);
      v_entitlement_id := gen_random_uuid();
      begin
        insert into public.redeem_entitlements (
          id, batch_id, workspace_id, kiosk_id, package_id,
          code_digest, code_hint, state, expires_at
        ) values (
          v_entitlement_id, v_batch_id, v_workspace_id, p_kiosk_id, p_package_id,
          extensions.digest(pg_catalog.convert_to(v_code, 'UTF8'), 'sha256'),
          v_hint, 'active', v_expires_at
        );
        v_inserted := true;
      exception when unique_violation then
        v_inserted := false;
      end;
    end loop;

    entitlement_id := v_entitlement_id;
    batch_id := v_batch_id;
    code := v_code;
    code_hint := v_hint;
    expires_at := v_expires_at;
    return next;
  end loop;

  insert into public.audit_log (
    workspace_id, kiosk_id, actor_type, action, target_type, target_id, metadata
  ) values (
    v_workspace_id, p_kiosk_id, 'shared_admin', 'redeem_batch_generated',
    'redeem_batch', v_batch_id::text,
    jsonb_build_object('count', p_count, 'expires_at', v_expires_at, 'pin_revision', v_pin_revision)
  );
end;
$$;

revoke all on function public.generate_kiosk_redeem_batch(uuid, uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.generate_kiosk_redeem_batch(uuid, uuid, text, integer, integer)
  to service_role;

create or replace function public.list_kiosk_redeem_entitlements(
  p_kiosk_id uuid,
  p_capability_token text
)
returns table (
  entitlement_id uuid,
  batch_id uuid,
  code_hint text,
  state text,
  expires_at timestamptz,
  printed_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select entitlement.id, entitlement.batch_id, entitlement.code_hint,
         entitlement.state, entitlement.expires_at, entitlement.printed_at,
         entitlement.claimed_at, entitlement.created_at
  from public.redeem_entitlements entitlement
  join app_private.kiosk_admin_credentials credential
    on credential.kiosk_id = entitlement.kiosk_id
  join app_private.kiosk_admin_capabilities capability
    on capability.kiosk_id = entitlement.kiosk_id
   and capability.pin_revision = credential.revision
  where entitlement.kiosk_id = p_kiosk_id
    and capability.token_digest = extensions.digest(
      pg_catalog.convert_to(coalesce(p_capability_token, ''), 'UTF8'), 'sha256'
    )
    and capability.revoked_at is null
    and capability.expires_at > now()
  order by entitlement.created_at desc
  limit 2000;
$$;

revoke all on function public.list_kiosk_redeem_entitlements(uuid, text)
  from public, anon, authenticated;
grant execute on function public.list_kiosk_redeem_entitlements(uuid, text)
  to service_role;

create or replace function public.mark_kiosk_redeem_codes_printed(
  p_kiosk_id uuid,
  p_capability_token text,
  p_entitlement_ids uuid[],
  p_print_job_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_updated integer;
begin
  if coalesce(array_length(p_entitlement_ids, 1), 0) < 1
     or array_length(p_entitlement_ids, 1) > 100 then
    raise exception using errcode = '22023', message = 'invalid_print_batch';
  end if;

  select kiosk.workspace_id
    into v_workspace_id
  from public.kiosks kiosk
  join app_private.kiosk_admin_credentials credential on credential.kiosk_id = kiosk.id
  join app_private.kiosk_admin_capabilities capability
    on capability.kiosk_id = kiosk.id
   and capability.pin_revision = credential.revision
  where kiosk.id = p_kiosk_id
    and capability.token_digest = extensions.digest(
      pg_catalog.convert_to(coalesce(p_capability_token, ''), 'UTF8'), 'sha256'
    )
    and capability.revoked_at is null
    and capability.expires_at > now();

  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'admin_capability_invalid';
  end if;

  update public.redeem_entitlements
    set printed_at = now(), print_job_id = p_print_job_id
  where kiosk_id = p_kiosk_id
    and id = any(p_entitlement_ids)
    and state = 'active'
    and printed_at is null;
  get diagnostics v_updated = row_count;

  insert into public.audit_log (
    workspace_id, kiosk_id, actor_type, action, target_type, target_id, metadata
  ) values (
    v_workspace_id, p_kiosk_id, 'shared_admin', 'redeem_codes_printed',
    'print_job', p_print_job_id::text,
    jsonb_build_object('requested', array_length(p_entitlement_ids, 1), 'updated', v_updated)
  );

  return v_updated;
end;
$$;

revoke all on function public.mark_kiosk_redeem_codes_printed(uuid, text, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.mark_kiosk_redeem_codes_printed(uuid, text, uuid[], uuid)
  to service_role;

create or replace function public.issue_kiosk_replacement_entitlement(
  p_kiosk_id uuid,
  p_capability_token text,
  p_original_code text,
  p_reason text
)
returns table (
  original_entitlement_id uuid,
  replacement_entitlement_id uuid,
  code text,
  code_hint text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_original public.redeem_entitlements%rowtype;
  v_batch_id uuid;
  v_replacement_id uuid;
  v_code text;
  v_hint text;
  v_expires_at timestamptz := now() + interval '7 days';
  v_letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_number integer;
  v_inserted boolean := false;
begin
  p_original_code := upper(trim(coalesce(p_original_code, '')));
  p_reason := trim(coalesce(p_reason, ''));
  if p_original_code !~ '^[A-Z]{2}[0-9]{4}$' then
    raise exception using errcode = '22023', message = 'invalid_original_code';
  end if;
  if char_length(p_reason) < 5 or char_length(p_reason) > 500 then
    raise exception using errcode = '22023', message = 'replacement_reason_required';
  end if;

  select kiosk.workspace_id
    into v_workspace_id
  from public.kiosks kiosk
  join app_private.kiosk_admin_credentials credential on credential.kiosk_id = kiosk.id
  join app_private.kiosk_admin_capabilities capability
    on capability.kiosk_id = kiosk.id
   and capability.pin_revision = credential.revision
  where kiosk.id = p_kiosk_id
    and capability.token_digest = extensions.digest(
      pg_catalog.convert_to(coalesce(p_capability_token, ''), 'UTF8'), 'sha256'
    )
    and capability.revoked_at is null
    and capability.expires_at > now();
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'admin_capability_invalid';
  end if;

  select entitlement.*
    into v_original
  from public.redeem_entitlements entitlement
  where entitlement.kiosk_id = p_kiosk_id
    and entitlement.code_digest = extensions.digest(
      pg_catalog.convert_to(p_original_code, 'UTF8'), 'sha256'
    )
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'original_code_not_found';
  end if;
  if v_original.state <> 'claimed' then
    raise exception using errcode = 'P0001', message = 'replacement_not_allowed';
  end if;
  if exists (
    select 1 from public.redeem_entitlements replacement
    where replacement.replacement_for = v_original.id
  ) then
    raise exception using errcode = 'P0001', message = 'replacement_already_issued';
  end if;

  insert into public.redeem_batches (
    workspace_id, kiosk_id, package_id, state, expires_at, activated_at
  ) values (
    v_original.workspace_id, p_kiosk_id, v_original.package_id,
    'active', v_expires_at, now()
  ) returning id into v_batch_id;

  while not v_inserted loop
    v_bytes := extensions.gen_random_bytes(4);
    v_number := ((get_byte(v_bytes, 2) * 256) + get_byte(v_bytes, 3)) % 10000;
    v_code := substr(v_letters, (get_byte(v_bytes, 0) % length(v_letters)) + 1, 1)
           || substr(v_letters, (get_byte(v_bytes, 1) % length(v_letters)) + 1, 1)
           || lpad(v_number::text, 4, '0');
    v_hint := left(v_code, 2) || '••' || right(v_code, 2);
    v_replacement_id := gen_random_uuid();
    begin
      insert into public.redeem_entitlements (
        id, batch_id, workspace_id, kiosk_id, package_id, code_digest, code_hint,
        state, expires_at, replacement_for
      ) values (
        v_replacement_id, v_batch_id, v_original.workspace_id, p_kiosk_id,
        v_original.package_id,
        extensions.digest(pg_catalog.convert_to(v_code, 'UTF8'), 'sha256'),
        v_hint, 'active', v_expires_at, v_original.id
      );
      v_inserted := true;
    exception when unique_violation then
      v_inserted := false;
    end;
  end loop;

  update public.redeem_entitlements
    set state = 'replaced'
  where id = v_original.id;

  insert into public.audit_log (
    workspace_id, kiosk_id, actor_type, action, target_type, target_id, metadata
  ) values (
    v_original.workspace_id, p_kiosk_id, 'shared_admin', 'replacement_entitlement_issued',
    'entitlement', v_replacement_id::text,
    jsonb_build_object('original_entitlement_id', v_original.id, 'reason', p_reason, 'expires_at', v_expires_at)
  );

  original_entitlement_id := v_original.id;
  replacement_entitlement_id := v_replacement_id;
  code := v_code;
  code_hint := v_hint;
  expires_at := v_expires_at;
  return next;
end;
$$;

revoke all on function public.issue_kiosk_replacement_entitlement(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.issue_kiosk_replacement_entitlement(uuid, text, text, text)
  to service_role;

commit;
