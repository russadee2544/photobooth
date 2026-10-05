-- provision_kiosk_device failed with "column reference kiosk_id is ambiguous": its
-- RETURNS TABLE (kiosk_id ...) output variable clashes with ON CONFLICT (kiosk_id).
-- Same body, with column names winning over the output variable.
create or replace function public.provision_kiosk_device(p_kiosk_id uuid)
returns table (kiosk_id uuid, credential_token text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_workspace_id uuid;
  v_credential_id uuid := gen_random_uuid();
  v_secret text := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
begin
  select kiosk.workspace_id into v_workspace_id
  from public.kiosks as kiosk
  where kiosk.id = p_kiosk_id and kiosk.status <> 'revoked'
  for update;

  if not found then
    raise exception 'kiosk_not_found' using errcode = 'P0001';
  end if;

  insert into app_private.kiosk_device_credentials (
    kiosk_id, credential_id, secret_digest, issued_at, rotated_at, revoked_at
  ) values (
    p_kiosk_id, v_credential_id, extensions.digest(v_secret, 'sha256'), now(), now(), null
  )
  on conflict (kiosk_id) do update
  set credential_id = excluded.credential_id,
      secret_digest = excluded.secret_digest,
      rotated_at = now(),
      revoked_at = null;

  insert into public.audit_log (
    workspace_id, kiosk_id, actor_type, actor_id, action, target_type, target_id
  ) values (
    v_workspace_id, p_kiosk_id, 'system', null,
    'kiosk.credential_rotated', 'kiosk', p_kiosk_id::text
  );

  return query select p_kiosk_id, v_credential_id::text || '.' || v_secret;
end;
$$;

revoke all on function public.provision_kiosk_device(uuid) from public, anon, authenticated;
grant execute on function public.provision_kiosk_device(uuid) to service_role;
