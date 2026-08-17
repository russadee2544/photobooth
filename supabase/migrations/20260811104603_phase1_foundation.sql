-- Phase 1 Receipt Booth foundation.
-- This migration is intentionally additive. It does not delete legacy data, but
-- it removes anonymous execution from the legacy privileged RPCs.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$
begin
  if exists (
    select 1 from pg_extension
    where extname = 'pgcrypto' and extnamespace <> 'extensions'::regnamespace
  ) then
    alter extension pgcrypto set schema extensions;
  end if;
end;
$$;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tenant, kiosk, package, and published configuration
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'owner' check (member_role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members(user_id);

create table public.kiosks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  booth_kind text not null default 'receipt' check (booth_kind in ('receipt', 'photo')),
  operating_mode text not null default 'event' check (operating_mode in ('event', 'redeem')),
  status text not null default 'provisioning' check (status in ('provisioning', 'active', 'maintenance', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index kiosks_workspace_id_idx on public.kiosks(workspace_id);

create table public.booth_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  booth_kind text not null default 'receipt' check (booth_kind in ('receipt', 'photo')),
  name text not null check (char_length(name) between 1 and 120),
  price_minor integer not null check (price_minor >= 0),
  currency char(3) not null default 'THB' check (currency = upper(currency)),
  prints_per_set smallint not null check (
    (booth_kind = 'receipt' and prints_per_set = 2)
    or (booth_kind = 'photo' and prints_per_set > 0)
  ),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index booth_packages_workspace_id_idx on public.booth_packages(workspace_id);

create table public.kiosk_config_versions (
  id uuid primary key default gen_random_uuid(),
  kiosk_id uuid not null references public.kiosks(id) on delete cascade,
  package_id uuid not null references public.booth_packages(id) on delete restrict,
  version integer not null check (version > 0),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kiosk_id, version)
);
create index kiosk_config_versions_kiosk_id_idx on public.kiosk_config_versions(kiosk_id);
create index kiosk_config_versions_package_id_idx on public.kiosk_config_versions(package_id);
create index kiosk_config_versions_created_by_idx on public.kiosk_config_versions(created_by) where created_by is not null;
create unique index kiosk_one_published_config_idx
  on public.kiosk_config_versions(kiosk_id)
  where published_at is not null;

-- ---------------------------------------------------------------------------
-- Events, one-time entitlements, sessions, final assets, and print jobs
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kiosk_id uuid not null references public.kiosks(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  status text not null default 'draft' check (status in ('draft', 'active', 'closing', 'exported', 'closed', 'failed')),
  keep_final_assets boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  absolute_delete_at timestamptz,
  export_manifest jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at),
  check (absolute_delete_at is null or ended_at is null or absolute_delete_at <= ended_at + interval '30 days')
);
create index events_workspace_id_idx on public.events(workspace_id);
create index events_kiosk_id_idx on public.events(kiosk_id);
create index events_status_idx on public.events(status);

create table public.redeem_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kiosk_id uuid not null references public.kiosks(id) on delete restrict,
  package_id uuid not null references public.booth_packages(id) on delete restrict,
  state text not null default 'draft' check (state in ('draft', 'active', 'revoked', 'exhausted')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  activated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((state = 'active' and activated_at is not null) or state <> 'active')
);
create index redeem_batches_workspace_id_idx on public.redeem_batches(workspace_id);
create index redeem_batches_kiosk_id_idx on public.redeem_batches(kiosk_id);
create index redeem_batches_package_id_idx on public.redeem_batches(package_id);
create index redeem_batches_created_by_idx on public.redeem_batches(created_by) where created_by is not null;

create table public.redeem_entitlements (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.redeem_batches(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kiosk_id uuid not null references public.kiosks(id) on delete restrict,
  package_id uuid not null references public.booth_packages(id) on delete restrict,
  code_digest bytea not null unique,
  code_hint text not null check (code_hint ~ '^[A-Z]{2}••[0-9]{2}$'),
  state text not null default 'draft' check (state in ('draft', 'active', 'claimed', 'expired', 'revoked', 'replaced')),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  replacement_for uuid references public.redeem_entitlements(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((state = 'claimed' and claimed_at is not null) or state <> 'claimed')
);
create index redeem_entitlements_batch_id_idx on public.redeem_entitlements(batch_id);
create index redeem_entitlements_workspace_id_idx on public.redeem_entitlements(workspace_id);
create index redeem_entitlements_kiosk_id_idx on public.redeem_entitlements(kiosk_id);
create index redeem_entitlements_package_id_idx on public.redeem_entitlements(package_id);
create index redeem_entitlements_state_expiry_idx on public.redeem_entitlements(state, expires_at);
create unique index redeem_entitlements_one_replacement_idx
  on public.redeem_entitlements(replacement_for)
  where replacement_for is not null;

create table public.booth_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kiosk_id uuid not null references public.kiosks(id) on delete restrict,
  package_id uuid not null references public.booth_packages(id) on delete restrict,
  event_id uuid references public.events(id) on delete restrict,
  entitlement_id uuid unique references public.redeem_entitlements(id) on delete restrict,
  mode text not null check (mode in ('event', 'redeem')),
  status text not null default 'authorized' check (status in ('authorized', 'capturing', 'composing', 'print_queued', 'completed', 'cancelled', 'failed')),
  config_version integer not null check (config_version > 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((mode = 'redeem' and entitlement_id is not null and event_id is null) or (mode = 'event' and event_id is not null and entitlement_id is null)),
  check (completed_at is null or completed_at >= started_at),
  check (mode <> 'redeem' or completed_at is null or purge_after = completed_at + interval '24 hours')
);
create index booth_sessions_workspace_id_idx on public.booth_sessions(workspace_id);
create index booth_sessions_kiosk_id_idx on public.booth_sessions(kiosk_id);
create index booth_sessions_package_id_idx on public.booth_sessions(package_id);
create index booth_sessions_event_id_idx on public.booth_sessions(event_id);
create index booth_sessions_status_idx on public.booth_sessions(status);
create index booth_sessions_purge_after_idx on public.booth_sessions(purge_after) where purge_after is not null;

create table public.final_assets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.booth_sessions(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('final_color', 'final_dither')),
  storage_key text not null unique check (storage_key !~ '(^|/)\.\.(/|$)'),
  sha256_hex char(64) not null check (sha256_hex ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size > 0),
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, asset_kind)
);
create index final_assets_session_id_idx on public.final_assets(session_id);
create index final_assets_workspace_id_idx on public.final_assets(workspace_id);
create index final_assets_purge_after_idx on public.final_assets(purge_after) where purge_after is not null;

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.booth_sessions(id) on delete restrict,
  kiosk_id uuid not null references public.kiosks(id) on delete restrict,
  idempotency_key uuid not null,
  status text not null default 'queued' check (status in ('queued', 'printing', 'completed', 'failed', 'ambiguous', 'cancelled')),
  copies_requested smallint not null default 2 check (copies_requested = 2),
  copies_completed smallint not null default 0 check (copies_completed between 0 and 2),
  last_error text,
  operator_resolution text check (operator_resolution in ('confirmed_printed', 'confirmed_not_printed', 'reprinted', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (kiosk_id, idempotency_key),
  check (status <> 'completed' or copies_completed = 2),
  check (status <> 'ambiguous' or operator_resolution is null)
);
create index print_jobs_session_id_idx on public.print_jobs(session_id);
create index print_jobs_kiosk_id_idx on public.print_jobs(kiosk_id);
create index print_jobs_status_idx on public.print_jobs(kiosk_id, status);

create table public.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  kiosk_id uuid references public.kiosks(id) on delete restrict,
  actor_type text not null check (actor_type in ('owner', 'shared_admin', 'kiosk', 'system')),
  actor_id text,
  action text not null check (char_length(action) between 3 and 100),
  target_type text not null check (char_length(target_type) between 2 and 60),
  target_id text not null check (char_length(target_id) between 1 and 120),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_log_workspace_created_idx on public.audit_log(workspace_id, created_at desc);
create index audit_log_kiosk_created_idx on public.audit_log(kiosk_id, created_at desc) where kiosk_id is not null;

-- PIN hashes and lockout state are never exposed through the Data API.
create table app_private.kiosk_admin_credentials (
  kiosk_id uuid primary key references public.kiosks(id) on delete cascade,
  pin_hash text not null,
  must_change boolean not null default true,
  failed_attempts smallint not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  changed_at timestamptz not null default now()
);

create table app_private.kiosk_device_credentials (
  kiosk_id uuid primary key references public.kiosks(id) on delete cascade,
  credential_id uuid not null unique default gen_random_uuid(),
  secret_digest bytea not null check (octet_length(secret_digest) = 32),
  issued_at timestamptz not null default now(),
  rotated_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Triggers and append-only guarantees
-- ---------------------------------------------------------------------------

create function app_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger kiosks_set_updated_at before update on public.kiosks
for each row execute function app_private.set_updated_at();
create trigger packages_set_updated_at before update on public.booth_packages
for each row execute function app_private.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function app_private.set_updated_at();
create trigger sessions_set_updated_at before update on public.booth_sessions
for each row execute function app_private.set_updated_at();
create trigger print_jobs_set_updated_at before update on public.print_jobs
for each row execute function app_private.set_updated_at();

create function app_private.set_session_retention()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_completed_transition boolean;
begin
  if tg_op = 'INSERT' then
    v_completed_transition := new.status = 'completed';
  else
    v_completed_transition := new.status = 'completed' and old.status is distinct from 'completed';
  end if;

  if v_completed_transition then
    new.completed_at := coalesce(new.completed_at, now());
    if new.mode = 'redeem' then
      new.purge_after := new.completed_at + interval '24 hours';
    end if;
  end if;
  return new;
end;
$$;
create trigger booth_sessions_set_retention
before insert or update on public.booth_sessions
for each row execute function app_private.set_session_retention();

create function app_private.reject_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only' using errcode = '55000';
end;
$$;
create trigger audit_log_reject_update_delete
before update or delete on public.audit_log
for each row execute function app_private.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Atomic claim. Only an authenticated Edge Function using service_role may call.
-- ---------------------------------------------------------------------------

create function public.authenticate_kiosk_device(p_token text)
returns table (kiosk_id uuid, workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential_id uuid;
  v_secret text;
begin
  if p_token is null or p_token !~ '^[0-9a-fA-F-]{36}\.[A-Za-z0-9_-]{32,128}$' then
    return;
  end if;

  begin
    v_credential_id := split_part(p_token, '.', 1)::uuid;
  exception when invalid_text_representation then
    return;
  end;
  v_secret := split_part(p_token, '.', 2);

  return query
  update app_private.kiosk_device_credentials as credential
  set last_seen_at = clock_timestamp()
  from public.kiosks as kiosk
  where credential.credential_id = v_credential_id
    and credential.secret_digest = extensions.digest(v_secret, 'sha256')
    and credential.revoked_at is null
    and kiosk.id = credential.kiosk_id
    and kiosk.status = 'active'
  returning kiosk.id, kiosk.workspace_id;
end;
$$;

revoke all on function public.authenticate_kiosk_device(text) from public, anon, authenticated;
grant execute on function public.authenticate_kiosk_device(text) to service_role;

create function public.provision_kiosk_device(p_kiosk_id uuid)
returns table (kiosk_id uuid, credential_token text)
language plpgsql
security definer
set search_path = ''
as $$
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

create function public.claim_redeem_entitlement(
  p_code text,
  p_kiosk_id uuid,
  p_package_id uuid,
  p_config_version integer
)
returns table (
  claim_id uuid,
  code_hint text,
  kiosk_id uuid,
  package_id uuid,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_entitlement public.redeem_entitlements%rowtype;
  v_session_id uuid;
  v_claimed_at timestamptz := clock_timestamp();
begin
  if v_code !~ '^[A-Z]{2}[0-9]{4}$' then
    raise exception 'invalid_code_format' using errcode = 'P0001';
  end if;

  select entitlement.* into v_entitlement
  from public.redeem_entitlements as entitlement
  join public.redeem_batches as batch on batch.id = entitlement.batch_id
  where entitlement.code_digest = extensions.digest(v_code, 'sha256')
    and batch.state = 'active'
  for update of entitlement;

  if not found then
    raise exception 'code_not_found' using errcode = 'P0001';
  end if;
  if v_entitlement.state <> 'active' then
    raise exception 'code_not_active' using errcode = 'P0001';
  end if;
  if v_entitlement.expires_at <= v_claimed_at then
    raise exception 'code_expired' using errcode = 'P0001';
  end if;
  if v_entitlement.kiosk_id <> p_kiosk_id or v_entitlement.package_id <> p_package_id then
    raise exception 'code_binding_mismatch' using errcode = 'P0001';
  end if;

  insert into public.booth_sessions (
    workspace_id, kiosk_id, package_id, entitlement_id, mode, status, config_version, started_at
  ) values (
    v_entitlement.workspace_id, p_kiosk_id, p_package_id, v_entitlement.id,
    'redeem', 'authorized', p_config_version, v_claimed_at
  ) returning id into v_session_id;

  update public.redeem_entitlements
  set state = 'claimed', claimed_at = v_claimed_at
  where id = v_entitlement.id;

  insert into public.audit_log (
    workspace_id, kiosk_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    v_entitlement.workspace_id, p_kiosk_id, 'kiosk', p_kiosk_id::text,
    'redeem.claimed', 'entitlement', v_entitlement.id::text,
    jsonb_build_object('session_id', v_session_id, 'package_id', p_package_id)
  );

  return query select v_session_id, v_entitlement.code_hint, p_kiosk_id, p_package_id, v_claimed_at;
end;
$$;

revoke all on function public.claim_redeem_entitlement(text, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_redeem_entitlement(text, uuid, uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Data API surface: explicit grants plus RLS. Anon receives no table access.
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.kiosks enable row level security;
alter table public.booth_packages enable row level security;
alter table public.kiosk_config_versions enable row level security;
alter table public.events enable row level security;
alter table public.redeem_batches enable row level security;
alter table public.redeem_entitlements enable row level security;
alter table public.booth_sessions enable row level security;
alter table public.final_assets enable row level security;
alter table public.print_jobs enable row level security;
alter table public.audit_log enable row level security;

alter table public.workspaces force row level security;
alter table public.workspace_members force row level security;
alter table public.kiosks force row level security;
alter table public.booth_packages force row level security;
alter table public.kiosk_config_versions force row level security;
alter table public.events force row level security;
alter table public.redeem_batches force row level security;
alter table public.redeem_entitlements force row level security;
alter table public.booth_sessions force row level security;
alter table public.final_assets force row level security;
alter table public.print_jobs force row level security;
alter table public.audit_log force row level security;

create policy workspace_members_read_self on public.workspace_members
for select to authenticated
using ((select auth.uid()) = user_id);

create policy workspaces_read_member on public.workspaces
for select to authenticated
using (exists (
  select 1 from public.workspace_members member
  where member.workspace_id = workspaces.id and member.user_id = (select auth.uid())
));

create policy kiosks_read_member on public.kiosks
for select to authenticated
using (exists (
  select 1 from public.workspace_members member
  where member.workspace_id = kiosks.workspace_id and member.user_id = (select auth.uid())
));

create policy packages_read_member on public.booth_packages
for select to authenticated
using (exists (
  select 1 from public.workspace_members member
  where member.workspace_id = booth_packages.workspace_id and member.user_id = (select auth.uid())
));

create policy kiosk_config_read_member on public.kiosk_config_versions
for select to authenticated
using (exists (
  select 1
  from public.kiosks kiosk
  join public.workspace_members member on member.workspace_id = kiosk.workspace_id
  where kiosk.id = kiosk_config_versions.kiosk_id and member.user_id = (select auth.uid())
));

revoke all on table public.workspaces, public.workspace_members, public.kiosks,
  public.booth_packages, public.kiosk_config_versions, public.events,
  public.redeem_batches, public.redeem_entitlements, public.booth_sessions,
  public.final_assets, public.print_jobs, public.audit_log,
  public.redeem_codes, public.admin_pins from anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.kiosks,
  public.booth_packages, public.kiosk_config_versions to authenticated;

-- The application uses a private bucket via signed URLs/Edge Functions only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photobooth-private', 'photobooth-private', false, 20971520,
  array['image/png', 'image/jpeg']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Disable the legacy anonymous privileged surface. The new React client calls
-- authenticated Edge Functions instead of these functions.
revoke all on function public.admin_verify(text) from public, anon, authenticated;
revoke all on function public.redeem_validate(text) from public, anon, authenticated;
revoke all on function public.redeem_use(text) from public, anon, authenticated;
revoke all on function public.redeem_generate(integer, integer, text) from public, anon, authenticated;
revoke all on function public.redeem_list(text) from public, anon, authenticated;
