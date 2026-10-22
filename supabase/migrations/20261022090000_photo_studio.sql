-- Phone photo studio: the photo QR opens a page where the customer picks a colour look and saves.
-- The kiosk uploads the shots and the frame layers with the same one-session photo ticket.
begin;

alter table public.photo_upload_tickets
  add column if not exists studio_id text,
  add column if not exists studio_files jsonb not null default '[]'::jsonb,
  add column if not exists studio_done boolean not null default false;

alter table public.kiosk_sessions
  add column if not exists studio_id text;

commit;
