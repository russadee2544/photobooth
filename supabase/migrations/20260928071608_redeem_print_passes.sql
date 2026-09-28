-- Five-character prepaid print passes. Legacy six-character entitlements remain unchanged.
begin;

create table app_private.redeem_code_key (
  id boolean primary key default true check (id),
  secret bytea not null
);
insert into app_private.redeem_code_key (id, secret)
values (true, extensions.gen_random_bytes(32));
revoke all on app_private.redeem_code_key from public, anon, authenticated;

create table public.redeem_print_passes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  kiosk_id uuid not null references public.kiosks(id),
  package_id uuid not null references public.booth_packages(id),
  code_digest bytea not null unique,
  code_hint text not null check (code_hint ~ '^[0-9A-Z]••••$'),
  quota_kind text not null check (quota_kind in ('limited', 'unlimited')),
  print_limit integer check (print_limit in (2, 5)),
  used_prints integer not null default 0 check (used_prints >= 0),
  reserved_prints integer not null default 0 check (reserved_prints >= 0),
  copies_per_print smallint not null check (copies_per_print > 0),
  state text not null default 'active' check (state in ('active', 'revoked')),
  code_expires_at timestamptz not null,
  printed_at timestamptz,
  code_print_job_id uuid,
  activated_at timestamptz,
  valid_until timestamptz,
  session_digest bytea,
  session_until timestamptz,
  session_generation integer not null default 0,
  created_at timestamptz not null default now(),
  check ((quota_kind = 'limited' and print_limit is not null)
     or (quota_kind = 'unlimited' and print_limit is null)),
  check (print_limit is null or used_prints + reserved_prints <= print_limit),
  check ((activated_at is null and valid_until is null)
     or (activated_at is not null and valid_until is not null)),
  check ((session_digest is null and session_until is null)
     or (session_digest is not null and session_until is not null))
);
create index redeem_print_passes_kiosk_id_idx on public.redeem_print_passes(kiosk_id);
create index redeem_print_passes_workspace_id_idx on public.redeem_print_passes(workspace_id);

create table public.redeem_print_jobs (
  id uuid primary key,
  pass_id uuid not null references public.redeem_print_passes(id),
  kiosk_id uuid not null references public.kiosks(id),
  session_generation integer not null,
  asset_sha256 text not null check (asset_sha256 ~ '^[0-9a-f]{64}$'),
  copies smallint not null check (copies > 0),
  status text not null check (status in ('reserved', 'printing', 'completed', 'failed', 'ambiguous', 'cancelled')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index redeem_print_jobs_pass_id_idx on public.redeem_print_jobs(pass_id);
create unique index redeem_print_jobs_one_open_idx on public.redeem_print_jobs(pass_id)
  where status in ('reserved', 'printing', 'ambiguous');

create table public.redeem_print_ledger (
  id bigint generated always as identity primary key,
  pass_id uuid not null references public.redeem_print_passes(id),
  job_id uuid not null references public.redeem_print_jobs(id),
  action text not null check (action in ('reserve', 'consume', 'release')),
  created_at timestamptz not null default now(),
  unique (job_id, action)
);
create index redeem_print_ledger_pass_id_idx on public.redeem_print_ledger(pass_id);

create table public.redeem_print_attempts (
  kiosk_id uuid primary key references public.kiosks(id),
  window_started_at timestamptz not null,
  failures integer not null default 0,
  locked_until timestamptz
);

alter table public.redeem_print_passes enable row level security;
alter table public.redeem_print_jobs enable row level security;
alter table public.redeem_print_ledger enable row level security;
alter table public.redeem_print_attempts enable row level security;
alter table public.redeem_print_passes force row level security;
alter table public.redeem_print_jobs force row level security;
alter table public.redeem_print_ledger force row level security;
alter table public.redeem_print_attempts force row level security;
revoke all on public.redeem_print_passes, public.redeem_print_jobs,
  public.redeem_print_ledger, public.redeem_print_attempts from public, anon, authenticated;

-- Raw codes are returned once to the registered admin device for physical card printing.
create function public.generate_kiosk_print_passes(
  p_kiosk_id uuid, p_package_id uuid, p_capability_token text,
  p_count integer, p_expires_days integer, p_quota_kind text
)
returns table (pass_id uuid, code text, code_hint text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_copies smallint;
  v_key bytea;
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_code text;
  v_id uuid;
  v_attempt integer;
  v_expires_at timestamptz;
begin
  if p_count is null or p_count not between 1 and 500
     or p_expires_days is null or p_expires_days not between 1 and 365
     or p_quota_kind is null or p_quota_kind not in ('2', '5', 'unlimited') then
    raise exception using errcode = '22023', message = 'invalid_batch_parameters';
  end if;
  select kiosk.workspace_id, package.prints_per_set
    into v_workspace_id, v_copies
  from public.kiosks kiosk
  join public.booth_packages package on package.id = p_package_id
    and package.workspace_id = kiosk.workspace_id and package.enabled
  join app_private.kiosk_admin_credentials credential on credential.kiosk_id = kiosk.id
  join app_private.kiosk_admin_capabilities capability on capability.kiosk_id = kiosk.id
    and capability.pin_revision = credential.revision
  where kiosk.id = p_kiosk_id and kiosk.status <> 'revoked'
    and capability.token_digest = extensions.digest(
      pg_catalog.convert_to(coalesce(p_capability_token, ''), 'UTF8'), 'sha256')
    and capability.revoked_at is null and capability.expires_at > now();
  if v_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'admin_capability_invalid';
  end if;
  select secret into v_key from app_private.redeem_code_key where id;
  v_expires_at := now() + pg_catalog.make_interval(days => p_expires_days);
  for code_index in 1..p_count loop
    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      if v_attempt > 100 then
        raise exception using errcode = 'P0001', message = 'code_space_exhausted';
      end if;
      v_bytes := extensions.gen_random_bytes(5);
      v_code := '';
      for digit_index in 0..4 loop
        v_code := v_code || substr(v_alphabet, get_byte(v_bytes, digit_index) % 32 + 1, 1);
      end loop;
      if v_code !~ '[0-9]' or v_code !~ '[A-Z]' then continue; end if;
      v_id := gen_random_uuid();
      begin
        insert into public.redeem_print_passes (
          id, workspace_id, kiosk_id, package_id, code_digest, code_hint,
          quota_kind, print_limit, copies_per_print, code_expires_at
        ) values (
          v_id, v_workspace_id, p_kiosk_id, p_package_id,
          extensions.hmac(pg_catalog.convert_to(v_code, 'UTF8'), v_key, 'sha256'),
          left(v_code, 1) || '••••',
          case when p_quota_kind = 'unlimited' then 'unlimited' else 'limited' end,
          case when p_quota_kind = 'unlimited' then null else p_quota_kind::integer end,
          v_copies, v_expires_at
        );
        exit;
      exception when unique_violation then
        -- Keep old codes reserved, even after expiry.
        null;
      end;
    end loop;
    pass_id := v_id;
    code := v_code;
    code_hint := left(v_code, 1) || '••••';
    expires_at := v_expires_at;
    return next;
  end loop;
end;
$$;
revoke all on function public.generate_kiosk_print_passes(uuid, uuid, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.generate_kiosk_print_passes(uuid, uuid, text, integer, integer, text)
  to service_role;

create function public.list_kiosk_print_passes(
  p_kiosk_id uuid, p_capability_token text
)
returns table (
  pass_id uuid, code_hint text, quota_kind text, print_limit integer,
  used_prints integer, reserved_prints integer, state text,
  expires_at timestamptz, valid_until timestamptz, printed_at timestamptz,
  created_at timestamptz
)
language sql security definer set search_path = '' as $$
  select pass.id, pass.code_hint, pass.quota_kind, pass.print_limit,
    pass.used_prints, pass.reserved_prints, pass.state,
    pass.code_expires_at, pass.valid_until, pass.printed_at, pass.created_at
  from public.redeem_print_passes pass
  join app_private.kiosk_admin_credentials credential on credential.kiosk_id = pass.kiosk_id
  join app_private.kiosk_admin_capabilities capability on capability.kiosk_id = pass.kiosk_id
    and capability.pin_revision = credential.revision
  where pass.kiosk_id = p_kiosk_id
    and capability.token_digest = extensions.digest(
      pg_catalog.convert_to(coalesce(p_capability_token, ''), 'UTF8'), 'sha256')
    and capability.revoked_at is null and capability.expires_at > now()
  order by pass.created_at desc limit 2000;
$$;
revoke all on function public.list_kiosk_print_passes(uuid, text) from public, anon, authenticated;
grant execute on function public.list_kiosk_print_passes(uuid, text) to service_role;

create function public.mark_kiosk_print_passes_printed(
  p_kiosk_id uuid, p_capability_token text, p_pass_ids uuid[], p_print_job_id uuid
)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_print_job_id is null or coalesce(pg_catalog.array_length(p_pass_ids, 1), 0) not between 1 and 100
     or not exists (
       select 1 from public.kiosks kiosk
       join app_private.kiosk_admin_credentials credential on credential.kiosk_id = kiosk.id
       join app_private.kiosk_admin_capabilities capability on capability.kiosk_id = kiosk.id
         and capability.pin_revision = credential.revision
       where kiosk.id = p_kiosk_id
         and capability.token_digest = extensions.digest(
           pg_catalog.convert_to(coalesce(p_capability_token, ''), 'UTF8'), 'sha256')
         and capability.revoked_at is null and capability.expires_at > now()
     ) then
    raise exception using errcode = 'P0001', message = 'admin_capability_invalid';
  end if;
  update public.redeem_print_passes set printed_at = now(), code_print_job_id = p_print_job_id
    where kiosk_id = p_kiosk_id and id = any(p_pass_ids)
      and printed_at is null and state = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_kiosk_print_passes_printed(uuid, text, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.mark_kiosk_print_passes_printed(uuid, text, uuid[], uuid)
  to service_role;

-- A five-character code can resume its own pass. A live session cannot be stolen by re-entry.
-- Errors are returned as data so failed-attempt counters commit instead of rolling back.
create function public.claim_kiosk_print_pass(
  p_kiosk_id uuid, p_code text, p_previous_token text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_key bytea;
  v_pass public.redeem_print_passes%rowtype;
  v_attempt public.redeem_print_attempts%rowtype;
  v_token text;
  v_now timestamptz;
  v_reserved_job uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('redeem-pass:' || p_kiosk_id::text));
  insert into public.redeem_print_attempts (kiosk_id, window_started_at)
  values (p_kiosk_id, clock_timestamp()) on conflict (kiosk_id) do nothing;
  select * into v_attempt from public.redeem_print_attempts
    where kiosk_id = p_kiosk_id for update;
  v_now := clock_timestamp();
  if v_attempt.locked_until > v_now then
    return pg_catalog.jsonb_build_object('error', 'too_many_attempts');
  end if;
  if v_code !~ '^[0-9A-HJKMNP-TV-Z]{5}$' or v_code !~ '[0-9]' or v_code !~ '[A-Z]' then
    return pg_catalog.jsonb_build_object('error', 'invalid_format');
  end if;
  select secret into v_key from app_private.redeem_code_key where id;
  select * into v_pass from public.redeem_print_passes
    where code_digest = extensions.hmac(pg_catalog.convert_to(v_code, 'UTF8'), v_key, 'sha256')
    and kiosk_id = p_kiosk_id for update;
  if not found then
    update public.redeem_print_attempts set
      window_started_at = case when v_now - window_started_at >= interval '60 seconds' then v_now else window_started_at end,
      failures = case when v_now - window_started_at >= interval '60 seconds' then 1 else failures + 1 end
      where kiosk_id = p_kiosk_id;
    update public.redeem_print_attempts set locked_until = v_now + interval '30 seconds'
      where kiosk_id = p_kiosk_id and failures >= 5;
    return pg_catalog.jsonb_build_object('error', 'invalid_code');
  end if;
  if v_pass.state <> 'active' or v_pass.code_expires_at <= v_now
     or (v_pass.valid_until is not null and v_pass.valid_until <= v_now)
     or (v_pass.print_limit is not null and v_pass.used_prints >= v_pass.print_limit) then
    return pg_catalog.jsonb_build_object('error', 'code_unavailable');
  end if;
  if exists (select 1 from public.redeem_print_passes other
    where other.kiosk_id = p_kiosk_id and other.id <> v_pass.id
      and other.session_digest is not null and other.session_until > v_now) then
    return pg_catalog.jsonb_build_object('error', 'kiosk_in_use');
  end if;
  if v_pass.session_digest is not null and v_pass.session_until > v_now then
    if p_previous_token is null or v_pass.session_digest <>
      extensions.digest(pg_catalog.convert_to(p_previous_token, 'UTF8'), 'sha256') then
      return pg_catalog.jsonb_build_object('error', 'already_in_use');
    end if;
    v_token := p_previous_token;
  else
    -- A reservation that never reached the printer may be released when its
    -- old session expires. A printing or ambiguous job remains reserved.
    select id into v_reserved_job from public.redeem_print_jobs
      where pass_id = v_pass.id and status = 'reserved' for update;
    if found then
      update public.redeem_print_jobs set status = 'cancelled', finished_at = v_now
        where id = v_reserved_job;
      update public.redeem_print_passes set reserved_prints = reserved_prints - 1
        where id = v_pass.id;
      insert into public.redeem_print_ledger(pass_id, job_id, action)
        values (v_pass.id, v_reserved_job, 'release');
    end if;
    v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
    update public.redeem_print_passes set
      activated_at = coalesce(activated_at, v_now),
      valid_until = coalesce(valid_until, case when quota_kind = 'unlimited'
        then least(code_expires_at,
          ((v_now at time zone 'Asia/Bangkok')::date + 1)::timestamp at time zone 'Asia/Bangkok')
        else code_expires_at end),
      session_digest = extensions.digest(pg_catalog.convert_to(v_token, 'UTF8'), 'sha256'),
      session_generation = session_generation + 1,
      session_until = v_now + interval '5 minutes'
      where id = v_pass.id returning * into v_pass;
  end if;
  update public.redeem_print_attempts set failures = 0, locked_until = null,
    window_started_at = v_now where kiosk_id = p_kiosk_id;
  return pg_catalog.jsonb_build_object(
    'passId', v_pass.id, 'sessionToken', v_token, 'sessionGeneration', v_pass.session_generation,
    'quotaKind', v_pass.quota_kind, 'printLimit', v_pass.print_limit,
    'usedPrints', v_pass.used_prints, 'remaining', case when v_pass.print_limit is null then null
      else v_pass.print_limit - v_pass.used_prints - v_pass.reserved_prints end,
    'copiesPerPrint', v_pass.copies_per_print, 'validUntil', v_pass.valid_until,
    'codeHint', v_pass.code_hint
  );
end;
$$;
revoke all on function public.claim_kiosk_print_pass(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_kiosk_print_pass(uuid, text, text) to service_role;

create function public.touch_kiosk_print_pass(
  p_kiosk_id uuid, p_pass_id uuid, p_session_token text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pass public.redeem_print_passes%rowtype;
  v_now timestamptz;
begin
  select * into v_pass from public.redeem_print_passes
    where id = p_pass_id and kiosk_id = p_kiosk_id for update;
  v_now := clock_timestamp();
  if not found or v_pass.state <> 'active' or v_pass.valid_until <= v_now
     or v_pass.session_until <= v_now or v_pass.session_digest is null
     or v_pass.session_digest <> extensions.digest(
       pg_catalog.convert_to(coalesce(p_session_token, ''), 'UTF8'), 'sha256') then
    return pg_catalog.jsonb_build_object('error', 'session_unavailable');
  end if;
  update public.redeem_print_passes set session_until = v_now + interval '5 minutes'
    where id = p_pass_id;
  return pg_catalog.jsonb_build_object('active', true, 'sessionUntil', v_now + interval '5 minutes');
end;
$$;
revoke all on function public.touch_kiosk_print_pass(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.touch_kiosk_print_pass(uuid, uuid, text) to service_role;

create function public.reserve_kiosk_print(
  p_kiosk_id uuid, p_pass_id uuid, p_session_token text,
  p_job_id uuid, p_asset_sha256 text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pass public.redeem_print_passes%rowtype;
  v_job public.redeem_print_jobs%rowtype;
  v_now timestamptz;
begin
  select * into v_pass from public.redeem_print_passes
    where id = p_pass_id and kiosk_id = p_kiosk_id for update;
  if not found then return pg_catalog.jsonb_build_object('error', 'pass_not_found'); end if;
  v_now := clock_timestamp();
  if v_pass.state <> 'active' or v_pass.valid_until is null or v_pass.valid_until <= v_now
     or v_pass.session_until <= v_now or v_pass.session_digest is null
     or v_pass.session_digest <> extensions.digest(
       pg_catalog.convert_to(coalesce(p_session_token, ''), 'UTF8'), 'sha256') then
    return pg_catalog.jsonb_build_object('error', 'pass_unavailable');
  end if;
  select * into v_job from public.redeem_print_jobs where id = p_job_id;
  if found then
    if v_job.pass_id <> p_pass_id or v_job.asset_sha256 <> p_asset_sha256
       or v_job.session_generation <> v_pass.session_generation then
      return pg_catalog.jsonb_build_object('error', 'request_conflict');
    end if;
    return pg_catalog.jsonb_build_object('jobId', v_job.id, 'status', v_job.status,
      'copies', v_job.copies, 'remaining', case when v_pass.print_limit is null then null
      else v_pass.print_limit - v_pass.used_prints - v_pass.reserved_prints end);
  end if;
  if p_asset_sha256 !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('error', 'invalid_asset');
  end if;
  if v_pass.print_limit is not null
     and v_pass.used_prints + v_pass.reserved_prints >= v_pass.print_limit then
    return pg_catalog.jsonb_build_object('error', 'quota_exhausted');
  end if;
  if exists (select 1 from public.redeem_print_jobs
    where pass_id = p_pass_id and status in ('reserved', 'printing', 'ambiguous')) then
    return pg_catalog.jsonb_build_object('error', 'print_pending');
  end if;
  insert into public.redeem_print_jobs (
    id, pass_id, kiosk_id, session_generation, asset_sha256, copies, status
  ) values (
    p_job_id, p_pass_id, p_kiosk_id, v_pass.session_generation,
    p_asset_sha256, v_pass.copies_per_print, 'reserved'
  );
  update public.redeem_print_passes set reserved_prints = reserved_prints + 1,
    session_until = v_now + interval '5 minutes' where id = p_pass_id;
  insert into public.redeem_print_ledger(pass_id, job_id, action)
    values (p_pass_id, p_job_id, 'reserve');
  return pg_catalog.jsonb_build_object('jobId', p_job_id, 'status', 'reserved',
    'copies', v_pass.copies_per_print, 'remaining', case when v_pass.print_limit is null
      then null else v_pass.print_limit - v_pass.used_prints - v_pass.reserved_prints - 1 end);
end;
$$;
revoke all on function public.reserve_kiosk_print(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_kiosk_print(uuid, uuid, text, uuid, text)
  to service_role;

create function public.start_kiosk_print(
  p_kiosk_id uuid, p_job_id uuid, p_session_token text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pass public.redeem_print_passes%rowtype;
  v_job public.redeem_print_jobs%rowtype;
  v_pass_id uuid;
  v_now timestamptz;
begin
  select pass_id into v_pass_id from public.redeem_print_jobs
    where id = p_job_id and kiosk_id = p_kiosk_id;
  if not found then return pg_catalog.jsonb_build_object('error', 'job_not_found'); end if;
  select * into v_pass from public.redeem_print_passes where id = v_pass_id for update;
  select * into v_job from public.redeem_print_jobs where id = p_job_id for update;
  v_now := clock_timestamp();
  if v_job.status <> 'reserved' or v_pass.state <> 'active'
     or v_pass.valid_until <= v_now or v_pass.session_until <= v_now
     or v_job.session_generation <> v_pass.session_generation
     or v_pass.session_digest <> extensions.digest(
       pg_catalog.convert_to(coalesce(p_session_token, ''), 'UTF8'), 'sha256') then
    return pg_catalog.jsonb_build_object('error', 'print_not_authorized');
  end if;
  update public.redeem_print_jobs set status = 'printing', started_at = v_now where id = p_job_id;
  return pg_catalog.jsonb_build_object('jobId', p_job_id, 'status', 'printing',
    'copies', v_job.copies, 'assetSha256', v_job.asset_sha256);
end;
$$;
revoke all on function public.start_kiosk_print(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.start_kiosk_print(uuid, uuid, text) to service_role;

-- Only the trusted device agent may report printer results; never expose this as a browser method.
create function public.report_kiosk_print(
  p_kiosk_id uuid, p_job_id uuid, p_result text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pass public.redeem_print_passes%rowtype;
  v_job public.redeem_print_jobs%rowtype;
  v_pass_id uuid;
begin
  select pass_id into v_pass_id from public.redeem_print_jobs
    where id = p_job_id and kiosk_id = p_kiosk_id;
  if not found then return pg_catalog.jsonb_build_object('error', 'job_not_found'); end if;
  select * into v_pass from public.redeem_print_passes where id = v_pass_id for update;
  select * into v_job from public.redeem_print_jobs where id = p_job_id for update;
  if v_job.status in ('completed', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object('jobId', v_job.id, 'status', v_job.status,
      'remaining', case when v_pass.print_limit is null then null
        else v_pass.print_limit - v_pass.used_prints - v_pass.reserved_prints end);
  end if;
  if p_result = 'completed' and v_job.status in ('printing', 'ambiguous') then
    update public.redeem_print_jobs set status = 'completed', finished_at = clock_timestamp()
      where id = p_job_id;
    update public.redeem_print_passes set reserved_prints = reserved_prints - 1,
      used_prints = used_prints + 1 where id = v_pass_id;
    insert into public.redeem_print_ledger(pass_id, job_id, action)
      values (v_pass_id, p_job_id, 'consume');
  elsif p_result = 'failed' and v_job.status in ('reserved', 'printing', 'ambiguous') then
    -- A trusted agent must use this only after proving no paper was produced.
    update public.redeem_print_jobs set status = 'failed', finished_at = clock_timestamp()
      where id = p_job_id;
    update public.redeem_print_passes set reserved_prints = reserved_prints - 1 where id = v_pass_id;
    insert into public.redeem_print_ledger(pass_id, job_id, action)
      values (v_pass_id, p_job_id, 'release');
  elsif p_result = 'ambiguous' and v_job.status = 'printing' then
    update public.redeem_print_jobs set status = 'ambiguous' where id = p_job_id;
  else
    return pg_catalog.jsonb_build_object('error', 'invalid_transition');
  end if;
  select * into v_pass from public.redeem_print_passes where id = v_pass_id;
  select * into v_job from public.redeem_print_jobs where id = p_job_id;
  return pg_catalog.jsonb_build_object('jobId', v_job.id, 'status', v_job.status,
    'usedPrints', v_pass.used_prints, 'remaining', case when v_pass.print_limit is null
      then null else v_pass.print_limit - v_pass.used_prints - v_pass.reserved_prints end);
end;
$$;
revoke all on function public.report_kiosk_print(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.report_kiosk_print(uuid, uuid, text) to service_role;

create function public.pause_kiosk_print_pass(
  p_kiosk_id uuid, p_pass_id uuid, p_session_token text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pass public.redeem_print_passes%rowtype;
  v_reserved_job uuid;
begin
  select * into v_pass from public.redeem_print_passes
    where id = p_pass_id and kiosk_id = p_kiosk_id for update;
  if not found or v_pass.session_digest is null or v_pass.session_digest <>
    extensions.digest(pg_catalog.convert_to(coalesce(p_session_token, ''), 'UTF8'), 'sha256') then
    return pg_catalog.jsonb_build_object('error', 'session_unavailable');
  end if;
  select id into v_reserved_job from public.redeem_print_jobs
    where pass_id = p_pass_id and status = 'reserved' for update;
  if found then
    update public.redeem_print_jobs set status = 'cancelled', finished_at = clock_timestamp()
      where id = v_reserved_job;
    update public.redeem_print_passes set reserved_prints = reserved_prints - 1
      where id = p_pass_id;
    insert into public.redeem_print_ledger(pass_id, job_id, action)
      values (p_pass_id, v_reserved_job, 'release');
  end if;
  update public.redeem_print_passes set session_digest = null, session_until = null,
    session_generation = session_generation + 1 where id = p_pass_id;
  return pg_catalog.jsonb_build_object('paused', true);
end;
$$;
revoke all on function public.pause_kiosk_print_pass(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.pause_kiosk_print_pass(uuid, uuid, text) to service_role;

commit;
