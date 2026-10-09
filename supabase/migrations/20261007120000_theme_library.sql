-- Theme library shared by every kiosk of a workspace, with per-kiosk choices.
--
--   themes          one row per Universal Theme (owner_kiosk_id set = private to that kiosk, a "fork")
--   theme_versions  immutable published versions (doc = Universal Theme v2 JSON); edits add a version
--   kiosk_themes    what each kiosk does with a theme: enabled, default, sort order, pinned version,
--                   small overrides (text, colour, hidden layers). A missing row = enabled, follows latest.
--
-- Kiosks read and write only through the kiosk-themes Edge Function (device credential, plus the
-- admin PIN capability for writes), which calls the security-definer functions below with the
-- kiosk and workspace it authenticated. Workspace members (owner dashboard) may read.

create table public.themes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_kiosk_id uuid references public.kiosks(id) on delete cascade,
  forked_from uuid references public.themes(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version integer not null default 1 check (current_version > 0),
  created_by_kiosk uuid references public.kiosks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index themes_workspace_idx on public.themes (workspace_id, status);
create index themes_owner_kiosk_idx on public.themes (owner_kiosk_id) where owner_kiosk_id is not null;
create index themes_forked_from_idx on public.themes (forked_from) where forked_from is not null;
create index themes_created_by_kiosk_idx on public.themes (created_by_kiosk) where created_by_kiosk is not null;

create table public.theme_versions (
  theme_id uuid not null references public.themes(id) on delete cascade,
  version integer not null check (version > 0),
  doc jsonb not null check (jsonb_typeof(doc) = 'object' and jsonb_typeof(doc -> 'style') = 'object'),
  doc_bytes integer not null check (doc_bytes between 2 and 8388608),
  created_by_kiosk uuid references public.kiosks(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (theme_id, version)
);
create index theme_versions_created_by_kiosk_idx on public.theme_versions (created_by_kiosk) where created_by_kiosk is not null;

create table public.kiosk_themes (
  kiosk_id uuid not null references public.kiosks(id) on delete cascade,
  theme_id uuid not null references public.themes(id) on delete cascade,
  enabled boolean not null default true,
  is_default boolean not null default false,
  sort_order integer not null default 0 check (sort_order between -10000 and 10000),
  pinned_version integer check (pinned_version > 0),
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object' and octet_length(overrides::text) <= 262144),
  updated_at timestamptz not null default now(),
  primary key (kiosk_id, theme_id)
);
create index kiosk_themes_theme_idx on public.kiosk_themes (theme_id);
create unique index kiosk_themes_one_default_idx on public.kiosk_themes (kiosk_id) where is_default;

alter table public.themes enable row level security;
alter table public.themes force row level security;
alter table public.theme_versions enable row level security;
alter table public.theme_versions force row level security;
alter table public.kiosk_themes enable row level security;
alter table public.kiosk_themes force row level security;
revoke all on table public.themes, public.theme_versions, public.kiosk_themes from public, anon, authenticated;
grant select on table public.themes, public.theme_versions, public.kiosk_themes to authenticated;

create policy themes_member_read on public.themes for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = themes.workspace_id and m.user_id = (select auth.uid())));
create policy theme_versions_member_read on public.theme_versions for select to authenticated
  using (exists (
    select 1 from public.themes t join public.workspace_members m on m.workspace_id = t.workspace_id
    where t.id = theme_versions.theme_id and m.user_id = (select auth.uid())));
create policy kiosk_themes_member_read on public.kiosk_themes for select to authenticated
  using (exists (
    select 1 from public.kiosks k join public.workspace_members m on m.workspace_id = k.workspace_id
    where k.id = kiosk_themes.kiosk_id and m.user_id = (select auth.uid())));

-- A theme is visible to a kiosk when it is active, in the kiosk's workspace, and shared or its own.
create function app_private.kiosk_can_see_theme(p_kiosk_id uuid, p_workspace_id uuid, p_theme_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.themes t
    where t.id = p_theme_id and t.workspace_id = p_workspace_id and t.status = 'active'
      and (t.owner_kiosk_id is null or t.owner_kiosk_id = p_kiosk_id)
  );
$$;
revoke all on function app_private.kiosk_can_see_theme(uuid, uuid, uuid) from public, anon, authenticated;

-- Everything a kiosk needs to decide what to download. `rev` changes whenever anything in it does.
create function public.kiosk_theme_manifest(p_kiosk_id uuid, p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_themes jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'themeId', t.id,
      'name', t.name,
      'private', t.owner_kiosk_id is not null,
      'forkedFrom', t.forked_from,
      'currentVersion', t.current_version,
      'versions', (select coalesce(jsonb_agg(v.version order by v.version desc), '[]'::jsonb)
                   from (select version from public.theme_versions where theme_id = t.id order by version desc limit 20) v),
      'updatedAt', t.updated_at,
      'setting', jsonb_build_object(
        'enabled', coalesce(s.enabled, true),
        'isDefault', coalesce(s.is_default, false),
        'sortOrder', coalesce(s.sort_order, 0),
        'pinnedVersion', s.pinned_version,
        'overrides', coalesce(s.overrides, '{}'::jsonb),
        'updatedAt', s.updated_at
      ),
      'version', coalesce(s.pinned_version, t.current_version)
    ) order by coalesce(s.sort_order, 0), t.created_at), '[]'::jsonb)
  into v_themes
  from public.themes t
  left join public.kiosk_themes s on s.theme_id = t.id and s.kiosk_id = p_kiosk_id
  where t.workspace_id = p_workspace_id and t.status = 'active'
    and (t.owner_kiosk_id is null or t.owner_kiosk_id = p_kiosk_id);

  return jsonb_build_object('rev', md5(v_themes::text), 'themes', v_themes);
end;
$$;

create function public.kiosk_theme_version(p_kiosk_id uuid, p_workspace_id uuid, p_theme_id uuid, p_version integer)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_doc jsonb;
begin
  if not app_private.kiosk_can_see_theme(p_kiosk_id, p_workspace_id, p_theme_id) then
    raise exception 'theme_not_found' using errcode = 'P0002';
  end if;
  select doc into v_doc from public.theme_versions where theme_id = p_theme_id and version = p_version;
  if v_doc is null then
    raise exception 'theme_not_found' using errcode = 'P0002';
  end if;
  return v_doc;
end;
$$;

-- New theme (p_theme_id null) or a new version of an existing one. Returns {themeId, version}.
create function public.publish_kiosk_theme(
  p_kiosk_id uuid, p_workspace_id uuid, p_theme_id uuid, p_name text, p_doc jsonb, p_private boolean
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_theme_id uuid := p_theme_id;
  v_version integer;
  v_name text := left(btrim(coalesce(p_name, '')), 80);
begin
  if v_name = '' then raise exception 'invalid_name' using errcode = '22023'; end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' or jsonb_typeof(p_doc -> 'style') <> 'object' then
    raise exception 'invalid_theme' using errcode = '22023';
  end if;
  if octet_length(p_doc::text) > 8388608 then raise exception 'theme_too_large' using errcode = '22023'; end if;

  if v_theme_id is null then
    insert into public.themes (workspace_id, owner_kiosk_id, name, created_by_kiosk)
    values (p_workspace_id, case when p_private then p_kiosk_id end, v_name, p_kiosk_id)
    returning id, current_version into v_theme_id, v_version;
  else
    if not app_private.kiosk_can_see_theme(p_kiosk_id, p_workspace_id, v_theme_id) then
      raise exception 'theme_not_found' using errcode = 'P0002';
    end if;
    update public.themes set current_version = current_version + 1, name = v_name, updated_at = now()
    where id = v_theme_id
    returning current_version into v_version;
  end if;

  insert into public.theme_versions (theme_id, version, doc, doc_bytes, created_by_kiosk)
  values (v_theme_id, v_version, p_doc, octet_length(p_doc::text), p_kiosk_id);
  return jsonb_build_object('themeId', v_theme_id, 'version', v_version);
end;
$$;

-- Change this kiosk's choices for one theme. p_patch keys: enabled, isDefault, sortOrder,
-- pinnedVersion (null = follow latest), overrides. p_expected_updated_at guards against two admins
-- (kiosk and dashboard) overwriting each other: a stale value raises 'stale_setting'.
create function public.set_kiosk_theme(
  p_kiosk_id uuid, p_workspace_id uuid, p_theme_id uuid, p_patch jsonb, p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.kiosk_themes;
  v_pinned integer;
begin
  if not app_private.kiosk_can_see_theme(p_kiosk_id, p_workspace_id, p_theme_id) then
    raise exception 'theme_not_found' using errcode = 'P0002';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid_request' using errcode = '22023'; end if;

  insert into public.kiosk_themes (kiosk_id, theme_id) values (p_kiosk_id, p_theme_id)
  on conflict (kiosk_id, theme_id) do nothing;
  select * into v_row from public.kiosk_themes where kiosk_id = p_kiosk_id and theme_id = p_theme_id for update;

  if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at
     and v_row.updated_at > p_expected_updated_at then
    raise exception 'stale_setting' using errcode = '40001';
  end if;

  if p_patch ? 'pinnedVersion' then
    if jsonb_typeof(p_patch -> 'pinnedVersion') = 'null' then
      v_pinned := null;
    else
      v_pinned := (p_patch ->> 'pinnedVersion')::integer;
      if not exists (select 1 from public.theme_versions where theme_id = p_theme_id and version = v_pinned) then
        raise exception 'version_not_found' using errcode = 'P0002';
      end if;
    end if;
  else
    v_pinned := v_row.pinned_version;
  end if;

  if coalesce((p_patch ->> 'isDefault')::boolean, false) then
    update public.kiosk_themes set is_default = false, updated_at = now()
    where kiosk_id = p_kiosk_id and theme_id <> p_theme_id and is_default;
  end if;

  update public.kiosk_themes set
    enabled = coalesce((p_patch ->> 'enabled')::boolean, enabled),
    is_default = coalesce((p_patch ->> 'isDefault')::boolean, is_default),
    -- greatest/least skip nulls, so a patch without sortOrder must not reach them.
    sort_order = case when p_patch ? 'sortOrder' and jsonb_typeof(p_patch -> 'sortOrder') = 'number'
      then greatest(-10000, least(10000, (p_patch ->> 'sortOrder')::integer)) else sort_order end,
    pinned_version = v_pinned,
    overrides = case when jsonb_typeof(p_patch -> 'overrides') = 'object' then p_patch -> 'overrides' else overrides end,
    updated_at = now()
  where kiosk_id = p_kiosk_id and theme_id = p_theme_id
  returning * into v_row;

  return jsonb_build_object('themeId', v_row.theme_id, 'enabled', v_row.enabled, 'isDefault', v_row.is_default,
    'sortOrder', v_row.sort_order, 'pinnedVersion', v_row.pinned_version, 'overrides', v_row.overrides, 'updatedAt', v_row.updated_at);
end;
$$;

-- Copy the version this kiosk uses into a theme only this kiosk sees. The copy no longer follows
-- the original; the original is switched off here and the copy takes over its default flag.
create function public.fork_kiosk_theme(p_kiosk_id uuid, p_workspace_id uuid, p_theme_id uuid, p_name text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_source public.themes;
  v_setting public.kiosk_themes;
  v_version integer;
  v_doc jsonb;
  v_new uuid;
begin
  if not app_private.kiosk_can_see_theme(p_kiosk_id, p_workspace_id, p_theme_id) then
    raise exception 'theme_not_found' using errcode = 'P0002';
  end if;
  select * into v_source from public.themes where id = p_theme_id;
  select * into v_setting from public.kiosk_themes where kiosk_id = p_kiosk_id and theme_id = p_theme_id;
  v_version := coalesce(v_setting.pinned_version, v_source.current_version);
  select doc into v_doc from public.theme_versions where theme_id = p_theme_id and version = v_version;

  insert into public.themes (workspace_id, owner_kiosk_id, forked_from, name, created_by_kiosk)
  values (p_workspace_id, p_kiosk_id, p_theme_id,
          left(coalesce(nullif(btrim(p_name), ''), v_source.name || ' (ตู้นี้)'), 80), p_kiosk_id)
  returning id into v_new;
  insert into public.theme_versions (theme_id, version, doc, doc_bytes, created_by_kiosk)
  values (v_new, 1, v_doc, octet_length(v_doc::text), p_kiosk_id);

  insert into public.kiosk_themes (kiosk_id, theme_id, enabled, is_default, sort_order, overrides)
  values (p_kiosk_id, v_new, true, false, coalesce(v_setting.sort_order, 0), coalesce(v_setting.overrides, '{}'::jsonb));
  insert into public.kiosk_themes (kiosk_id, theme_id, enabled) values (p_kiosk_id, p_theme_id, false)
  on conflict (kiosk_id, theme_id) do update set enabled = false, is_default = false, updated_at = now();
  if coalesce(v_setting.is_default, false) then
    update public.kiosk_themes set is_default = true where kiosk_id = p_kiosk_id and theme_id = v_new;
  end if;
  return jsonb_build_object('themeId', v_new, 'version', 1);
end;
$$;

create function public.archive_kiosk_theme(p_kiosk_id uuid, p_workspace_id uuid, p_theme_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.kiosk_can_see_theme(p_kiosk_id, p_workspace_id, p_theme_id) then
    raise exception 'theme_not_found' using errcode = 'P0002';
  end if;
  update public.themes set status = 'archived', updated_at = now() where id = p_theme_id;
end;
$$;

revoke all on function public.kiosk_theme_manifest(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kiosk_theme_version(uuid, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.publish_kiosk_theme(uuid, uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.set_kiosk_theme(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fork_kiosk_theme(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.archive_kiosk_theme(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.kiosk_theme_manifest(uuid, uuid) to service_role;
grant execute on function public.kiosk_theme_version(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.publish_kiosk_theme(uuid, uuid, uuid, text, jsonb, boolean) to service_role;
grant execute on function public.set_kiosk_theme(uuid, uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.fork_kiosk_theme(uuid, uuid, uuid, text) to service_role;
grant execute on function public.archive_kiosk_theme(uuid, uuid, uuid) to service_role;
