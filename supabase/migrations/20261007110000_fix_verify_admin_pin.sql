-- verify_kiosk_admin_pin failed on every CORRECT PIN: its RETURNS TABLE column "expires_at" collided with the
-- table column of the same name in the capability cleanup UPDATE ("column reference expires_at is ambiguous"),
-- so the Edge Function answered admin_pin_failed. Wrong PINs never reached that statement, which hid the bug.
-- Same function, plus "#variable_conflict use_column" so column names win over the output-column variables.
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
#variable_conflict use_column
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
