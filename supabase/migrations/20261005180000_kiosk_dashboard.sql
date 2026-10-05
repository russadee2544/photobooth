-- Owner dashboard: live kiosk status (heartbeats) + one read-only summary function.
-- Dashboard users sign in with Supabase Auth; the summary only returns kiosks of workspaces
-- the signed-in user is a member of (workspace_members). Nothing here is readable with the anon key.

-- 1. Latest status reported by each kiosk's agent (written only by the kiosk-heartbeat Edge Function).
create table public.kiosk_status (
  kiosk_id uuid primary key references public.kiosks(id) on delete cascade,
  last_seen timestamptz not null default now(),
  started_at timestamptz,
  agent_version text check (char_length(agent_version) <= 64),
  update_channel text check (update_channel in ('canary', 'stable')),
  mode text check (mode in ('event', 'redeem')),
  page text check (char_length(page) <= 120),
  printer_name text check (char_length(printer_name) <= 200),
  printer_state text check (printer_state in ('ready', 'busy', 'offline', 'error', 'unknown')),
  printer_detail text check (char_length(printer_detail) <= 200),
  paper_remaining integer check (paper_remaining between 0 and 100000),
  last_error text check (char_length(last_error) <= 300),
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.kiosk_status enable row level security;
alter table public.kiosk_status force row level security;
revoke all on table public.kiosk_status from public, anon, authenticated;

-- 2. Which kiosk took each photo session (older rows stay NULL).
alter table public.kiosk_sessions add column kiosk_id uuid references public.kiosks(id) on delete set null;
create index kiosk_sessions_kiosk_created_idx on public.kiosk_sessions (kiosk_id, created_at);

-- 3. Everything the dashboard shows, in one call. Days are Bangkok days.
create or replace function public.dashboard_overview(p_days integer default 14)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 14), 90));
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_from timestamptz;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  v_from := ((v_today - (v_days - 1))::timestamp) at time zone 'Asia/Bangkok';

  with mine as (
    select k.id, k.name, k.status, k.operating_mode
    from public.kiosks k
    join public.workspace_members m on m.workspace_id = k.workspace_id and m.user_id = auth.uid()
    where k.status <> 'revoked'
  ),
  days as (
    select (v_today - g)::date as day from generate_series(0, v_days - 1) g
  ),
  sess as (
    select s.kiosk_id, (s.created_at at time zone 'Asia/Bangkok')::date as day, count(*) as n
    from public.kiosk_sessions s
    where s.kiosk_id in (select id from mine) and s.created_at >= v_from
    group by 1, 2
  ),
  prints as (
    select j.kiosk_id, (j.created_at at time zone 'Asia/Bangkok')::date as day,
      count(*) filter (where j.status = 'completed') as done,
      count(*) filter (where j.status = 'failed') as failed,
      count(*) filter (where j.status = 'ambiguous') as ambiguous,
      coalesce(sum(j.copies) filter (where j.status = 'completed'), 0) as copies
    from public.redeem_print_jobs j
    where j.kiosk_id in (select id from mine) and j.created_at >= v_from
    group by 1, 2
  ),
  pay as (
    select o.kiosk_id, (o.paid_at at time zone 'Asia/Bangkok')::date as day,
      count(*) as n, coalesce(sum(o.amount_minor), 0) as amount
    from public.payment_orders o
    where o.kiosk_id in (select id from mine) and o.status = 'paid' and o.paid_at >= v_from
    group by 1, 2
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'days', v_days,
    'kiosks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'status', m.status, 'mode', m.operating_mode,
        'live', (select to_jsonb(s) - 'kiosk_id' from public.kiosk_status s where s.kiosk_id = m.id),
        'series', (
          select jsonb_agg(jsonb_build_object(
            'day', d.day,
            'sessions', coalesce(sess.n, 0),
            'prints', coalesce(prints.done, 0),
            'copies', coalesce(prints.copies, 0),
            'failed', coalesce(prints.failed, 0),
            'ambiguous', coalesce(prints.ambiguous, 0),
            'orders', coalesce(pay.n, 0),
            'revenueMinor', coalesce(pay.amount, 0)
          ) order by d.day)
          from days d
          left join sess on sess.kiosk_id = m.id and sess.day = d.day
          left join prints on prints.kiosk_id = m.id and prints.day = d.day
          left join pay on pay.kiosk_id = m.id and pay.day = d.day
        ),
        'open', jsonb_build_object(
          'ambiguousJobs', (select count(*) from public.redeem_print_jobs j where j.kiosk_id = m.id and j.status = 'ambiguous'),
          'refundsNeeded', (select count(*) from public.payment_orders o where o.kiosk_id = m.id and o.status = 'refund_required')
        )
      ) order by m.name)
      from mine m
    ), '[]'::jsonb),
    'recentJobs', coalesce((
      select jsonb_agg(x) from (
        select j.id, j.kiosk_id, j.status, j.copies, j.created_at, j.finished_at
        from public.redeem_print_jobs j where j.kiosk_id in (select id from mine)
        order by j.created_at desc limit 15
      ) x
    ), '[]'::jsonb),
    'recentOrders', coalesce((
      select jsonb_agg(x) from (
        select o.id, o.kiosk_id, o.status, o.quota_kind, o.amount_minor, o.created_at, o.paid_at
        from public.payment_orders o where o.kiosk_id in (select id from mine)
        order by o.created_at desc limit 15
      ) x
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.dashboard_overview(integer) from public, anon;
grant execute on function public.dashboard_overview(integer) to authenticated;
