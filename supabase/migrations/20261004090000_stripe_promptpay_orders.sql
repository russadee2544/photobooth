-- Stripe PromptPay checkout for print passes. A paid order issues exactly one
-- redeem_print_passes row (same quota rules as staff-printed cards); the kiosk
-- then claims it through the normal claim_kiosk_print_pass flow.
begin;

create table public.booth_pass_offers (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.booth_packages(id) on delete cascade,
  quota_kind text not null check (quota_kind in ('2', '5', 'unlimited')),
  price_minor integer not null check (price_minor >= 2000),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (package_id, quota_kind)
);

create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  kiosk_id uuid not null references public.kiosks(id),
  package_id uuid not null references public.booth_packages(id),
  quota_kind text not null check (quota_kind in ('2', '5', 'unlimited')),
  amount_minor integer not null check (amount_minor > 0),
  currency char(3) not null default 'THB',
  stripe_payment_intent_id text unique,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'expired', 'cancelled', 'failed', 'refund_required')),
  pass_id uuid references public.redeem_print_passes(id),
  delivery_code bytea,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index payment_orders_kiosk_status_idx on public.payment_orders(kiosk_id, status);

alter table public.booth_pass_offers enable row level security;
alter table public.booth_pass_offers force row level security;
alter table public.payment_orders enable row level security;
alter table public.payment_orders force row level security;
revoke all on table public.booth_pass_offers, public.payment_orders from public, anon, authenticated;

-- Offers for the kiosk's package (device already authenticated by the Edge Function).
create function public.list_kiosk_pass_offers(p_kiosk_id uuid)
returns table (package_id uuid, quota_kind text, price_minor integer, currency char(3), copies smallint)
language sql security definer set search_path = '' as $$
  select package.id, offer.quota_kind, offer.price_minor, package.currency, package.prints_per_set
  from public.kiosks kiosk
  join public.booth_packages package on package.workspace_id = kiosk.workspace_id and package.enabled
  join public.booth_pass_offers offer on offer.package_id = package.id and offer.enabled
  where kiosk.id = p_kiosk_id and kiosk.status = 'active'
  order by case offer.quota_kind when '2' then 1 when '5' then 2 else 3 end;
$$;
revoke all on function public.list_kiosk_pass_offers(uuid) from public, anon, authenticated;
grant execute on function public.list_kiosk_pass_offers(uuid) to service_role;

-- One open order per kiosk: a new checkout supersedes the previous one.
create function public.create_kiosk_payment_order(
  p_kiosk_id uuid, p_package_id uuid, p_quota_kind text
)
returns table (order_id uuid, amount_minor integer, currency char(3), expires_at timestamptz, superseded_intent text)
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_price integer;
  v_currency char(3);
  v_intent text;
  v_id uuid;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('payment-order:' || p_kiosk_id::text));
  select kiosk.workspace_id, offer.price_minor, package.currency
    into v_workspace, v_price, v_currency
  from public.kiosks kiosk
  join public.booth_packages package on package.id = p_package_id
    and package.workspace_id = kiosk.workspace_id and package.enabled
  join public.booth_pass_offers offer on offer.package_id = package.id
    and offer.quota_kind = p_quota_kind and offer.enabled
  where kiosk.id = p_kiosk_id and kiosk.status = 'active';
  if v_workspace is null then
    raise exception using errcode = 'P0001', message = 'offer_unavailable';
  end if;

  update public.payment_orders existing
    set status = case when existing.expires_at <= now() then 'expired' else 'cancelled' end
    where existing.kiosk_id = p_kiosk_id and existing.status = 'pending'
    returning existing.stripe_payment_intent_id into v_intent;

  v_id := gen_random_uuid();
  insert into public.payment_orders (id, workspace_id, kiosk_id, package_id, quota_kind,
    amount_minor, currency, expires_at)
  values (v_id, v_workspace, p_kiosk_id, p_package_id, p_quota_kind, v_price, v_currency, v_expires);
  order_id := v_id; amount_minor := v_price; currency := v_currency;
  expires_at := v_expires; superseded_intent := v_intent;
  return next;
end;
$$;
revoke all on function public.create_kiosk_payment_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_kiosk_payment_order(uuid, uuid, text) to service_role;

create function public.attach_payment_intent(p_order_id uuid, p_intent text)
returns void language sql security definer set search_path = '' as $$
  update public.payment_orders set stripe_payment_intent_id = p_intent
  where id = p_order_id and status = 'pending' and stripe_payment_intent_id is null;
$$;
revoke all on function public.attach_payment_intent(uuid, text) from public, anon, authenticated;
grant execute on function public.attach_payment_intent(uuid, text) to service_role;

-- Returns the Stripe intent to cancel (if any) and marks the order cancelled.
create function public.cancel_kiosk_payment_order(p_kiosk_id uuid, p_order_id uuid)
returns text language sql security definer set search_path = '' as $$
  update public.payment_orders set status = 'cancelled'
  where id = p_order_id and kiosk_id = p_kiosk_id and status = 'pending'
  returning stripe_payment_intent_id;
$$;
revoke all on function public.cancel_kiosk_payment_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_kiosk_payment_order(uuid, uuid) to service_role;

-- Webhook fulfilment. Idempotent: replays return the existing state.
-- A payment that lands after the order expired/cancelled is flagged refund_required.
create function public.fulfill_payment_order(p_intent text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.fulfill_payment_order(text) from public, anon, authenticated;
grant execute on function public.fulfill_payment_order(text) to service_role;

create function public.fail_payment_order(p_intent text)
returns void language sql security definer set search_path = '' as $$
  update public.payment_orders set status = 'failed'
  where stripe_payment_intent_id = p_intent and status = 'pending';
$$;
revoke all on function public.fail_payment_order(text) from public, anon, authenticated;
grant execute on function public.fail_payment_order(text) to service_role;

-- Kiosk polling. The code is re-deliverable until the pass is activated by a
-- claim, so a lost response never strands a paid customer. Raw code is cleared
-- once the pass has been claimed.
create function public.get_kiosk_payment_order(p_kiosk_id uuid, p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.payment_orders%rowtype;
  v_activated timestamptz;
  v_key bytea;
begin
  select * into v_order from public.payment_orders
    where id = p_order_id and kiosk_id = p_kiosk_id for update;
  if not found then return pg_catalog.jsonb_build_object('error', 'order_not_found'); end if;
  if v_order.status = 'pending' and v_order.expires_at <= now() then
    update public.payment_orders set status = 'expired' where id = v_order.id;
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;
  if v_order.status <> 'paid' then
    return pg_catalog.jsonb_build_object('status', v_order.status);
  end if;
  select activated_at into v_activated from public.redeem_print_passes where id = v_order.pass_id;
  if v_activated is not null or v_order.delivery_code is null then
    update public.payment_orders set delivery_code = null where id = v_order.id;
    return pg_catalog.jsonb_build_object('status', 'delivered');
  end if;
  select secret into v_key from app_private.redeem_code_key where id;
  return pg_catalog.jsonb_build_object('status', 'paid', 'code', pg_catalog.convert_from(
    extensions.pgp_sym_decrypt_bytea(v_order.delivery_code, pg_catalog.encode(v_key, 'hex')), 'UTF8'));
end;
$$;
revoke all on function public.get_kiosk_payment_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_kiosk_payment_order(uuid, uuid) to service_role;

commit;
