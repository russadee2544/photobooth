-- Only the main kiosk may publish the official theme library. Which kiosk that is lives here
-- (set by the owner); the theme-sync Edge Function checks it before accepting a publish.
alter table public.kiosks add column if not exists theme_publisher boolean not null default false;
