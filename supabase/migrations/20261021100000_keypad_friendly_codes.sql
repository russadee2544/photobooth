-- Redeem codes easy to type on the booth's own keypad: 4 digits and 1 letter, the letter in a
-- random position, and only 6 letters ever used (A C H K P X: none of them looks like a digit).
-- Codes made before keep working: the claim check accepts any 5-character code as before.
begin;

create or replace function app_private.new_print_pass_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_letters constant text := 'ACHKPX';
  v_bytes bytea := extensions.gen_random_bytes(5);
  v_digits text;
  v_pos integer;
begin
  v_digits := pg_catalog.lpad(((((get_byte(v_bytes, 0) * 256) + get_byte(v_bytes, 1)) * 256 + get_byte(v_bytes, 2)) % 10000)::text, 4, '0');
  v_pos := get_byte(v_bytes, 3) % 5;
  return substr(v_digits, 1, v_pos)
    || substr(v_letters, get_byte(v_bytes, 4) % 6 + 1, 1)
    || substr(v_digits, v_pos + 1);
end;
$$;
revoke all on function app_private.new_print_pass_code() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fulfill_payment_order(p_intent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.payment_orders%rowtype;
  v_copies smallint;
  v_key bytea;
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_code text;
  v_id uuid;
  v_attempt integer := 0;
begin
  select * into v_order from public.payment_orders
    where stripe_payment_intent_id = p_intent for update;
  if not found then return pg_catalog.jsonb_build_object('status', 'unknown_intent'); end if;
  if v_order.status in ('paid', 'refund_required') then
    return pg_catalog.jsonb_build_object('status', v_order.status, 'orderId', v_order.id);
  end if;
  if v_order.status <> 'pending' or v_order.expires_at + interval '2 minutes' <= now() then
    update public.payment_orders set status = 'refund_required', paid_at = now() where id = v_order.id;
    return pg_catalog.jsonb_build_object('status', 'refund_required', 'orderId', v_order.id);
  end if;

  select prints_per_set into v_copies from public.booth_packages where id = v_order.package_id;
  select secret into v_key from app_private.redeem_code_key where id;
  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 100 then raise exception using errcode = 'P0001', message = 'code_space_exhausted'; end if;
    v_code := app_private.new_print_pass_code();
    if v_code !~ '[0-9]' or v_code !~ '[A-Z]' then continue; end if;
    v_id := gen_random_uuid();
    begin
      insert into public.redeem_print_passes (
        id, workspace_id, kiosk_id, package_id, code_digest, code_hint,
        quota_kind, print_limit, copies_per_print, code_expires_at, printed_at
      ) values (
        v_id, v_order.workspace_id, v_order.kiosk_id, v_order.package_id,
        extensions.hmac(pg_catalog.convert_to(v_code, 'UTF8'), v_key, 'sha256'),
        left(v_code, 1) || '••••',
        case when v_order.quota_kind = 'unlimited' then 'unlimited' else 'limited' end,
        case when v_order.quota_kind = 'unlimited' then null else v_order.quota_kind::integer end,
        v_copies, now() + interval '1 day', now()
      );
      exit;
    exception when unique_violation then null;
    end;
  end loop;

  update public.payment_orders set
    status = 'paid', paid_at = now(), pass_id = v_id,
    delivery_code = extensions.pgp_sym_encrypt_bytea(
      pg_catalog.convert_to(v_code, 'UTF8'), pg_catalog.encode(v_key, 'hex'))
  where id = v_order.id;
  return pg_catalog.jsonb_build_object('status', 'paid', 'orderId', v_order.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_kiosk_print_passes(p_kiosk_id uuid, p_package_id uuid, p_capability_token text, p_count integer, p_expires_days integer, p_quota_kind text)
 RETURNS TABLE(pass_id uuid, code text, code_hint text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      v_code := app_private.new_print_pass_code();
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
$function$;

commit;
