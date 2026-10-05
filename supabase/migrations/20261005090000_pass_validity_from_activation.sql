-- Pass lifetime counts from first use (activation), not from creation.
-- * code_expires_at now only limits how long an UNACTIVATED code may wait to be first used.
-- * limited passes: valid_until = activated_at + 30 days.
-- * unlimited passes: valid until the next Bangkok midnight after activation.
-- * A pass is bound to one kiosk (redeem_print_passes.kiosk_id), enforced by claim.
begin;

create or replace function public.claim_kiosk_print_pass(
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
  if v_pass.state <> 'active'
     or (v_pass.activated_at is null and v_pass.code_expires_at <= v_now)
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
        then ((v_now at time zone 'Asia/Bangkok')::date + 1)::timestamp at time zone 'Asia/Bangkok'
        else v_now + interval '30 days' end),
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

commit;
