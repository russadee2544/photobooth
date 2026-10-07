-- Recovering a forgotten kiosk admin PIN. Two paths, both only remove the stored PIN (it is
-- never revealed; it is hashed). The kiosk then asks for a new PIN the next time Admin opens.
--   * owner_reset_kiosk_admin_pin : the owner, signed in on the dashboard.
--   * recover_kiosk_admin_pin     : service role only, called by the admin-pin Edge Function when the
--                                    "Reset admin PIN" shortcut on the kiosk's Windows PC runs.
-- Every reset is written to the append-only audit log.

create or replace function public.owner_reset_kiosk_admin_pin(p_kiosk_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_removed integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select k.workspace_id into v_workspace_id
  from public.kiosks k
  join public.workspace_members m
    on m.workspace_id = k.workspace_id and m.user_id = auth.uid() and m.member_role = 'owner'
  where k.id = p_kiosk_id and k.status <> 'revoked';

  if v_workspace_id is null then
    raise exception 'kiosk_not_found' using errcode = '42501';
  end if;

  delete from app_private.kiosk_admin_capabilities where kiosk_id = p_kiosk_id;
  delete from app_private.kiosk_admin_credentials where kiosk_id = p_kiosk_id;
  get diagnostics v_removed = row_count;

  insert into public.audit_log (workspace_id, kiosk_id, actor_type, actor_id, action, target_type, target_id, metadata)
  values (v_workspace_id, p_kiosk_id, 'owner', auth.uid()::text, 'admin_pin_reset_by_owner',
          'kiosk', p_kiosk_id::text, jsonb_build_object('had_pin', v_removed > 0));

  return jsonb_build_object('reset', true, 'hadPin', v_removed > 0);
end;
$$;

revoke all on function public.owner_reset_kiosk_admin_pin(uuid) from public, anon;
grant execute on function public.owner_reset_kiosk_admin_pin(uuid) to authenticated;

create or replace function public.recover_kiosk_admin_pin(p_kiosk_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_removed integer;
begin
  select k.workspace_id into v_workspace_id
  from public.kiosks k
  where k.id = p_kiosk_id and k.status <> 'revoked';

  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'kiosk_not_active';
  end if;

  delete from app_private.kiosk_admin_capabilities where kiosk_id = p_kiosk_id;
  delete from app_private.kiosk_admin_credentials where kiosk_id = p_kiosk_id;
  get diagnostics v_removed = row_count;

  insert into public.audit_log (workspace_id, kiosk_id, actor_type, action, target_type, target_id, metadata)
  values (v_workspace_id, p_kiosk_id, 'kiosk', 'admin_pin_reset_local',
          'kiosk', p_kiosk_id::text, jsonb_build_object('had_pin', v_removed > 0));

  return jsonb_build_object('reset', true, 'hadPin', v_removed > 0);
end;
$$;

revoke all on function public.recover_kiosk_admin_pin(uuid) from public, anon, authenticated;
grant execute on function public.recover_kiosk_admin_pin(uuid) to service_role;
