-- Photo QR uploads go through the session-photo Edge Function (one ticket per session,
-- one color + one print image) instead of anonymous writes to Storage / kiosk_sessions.
create table public.photo_upload_tickets (
  ticket_digest text primary key check (ticket_digest ~ '^[0-9a-f]{64}$'),
  kiosk_id uuid not null references public.kiosks(id) on delete cascade,
  session_id uuid not null,
  mode text not null check (mode in ('event', 'redeem')),
  event_name text check (char_length(event_name) <= 100),
  layout text check (char_length(layout) <= 100),
  row_id uuid,
  color_used boolean not null default false,
  dither_used boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index photo_upload_tickets_expires_idx on public.photo_upload_tickets(expires_at);
alter table public.photo_upload_tickets enable row level security;
alter table public.photo_upload_tickets force row level security;
revoke all on table public.photo_upload_tickets from public, anon, authenticated;
