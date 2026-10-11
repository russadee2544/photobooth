-- "Publish themes to every kiosk": the main kiosk uploads its whole theme set (Template Editor catalog,
-- legacy custom themes, universal themes) as one JSON bundle; every kiosk in the workspace pulls the newest.
-- The bundle file lives in the private bucket; this table only records which bundle is current.
-- Only the theme-sync Edge Function (service role) touches it.
create table if not exists public.theme_bundles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_path text not null,
  size_bytes integer not null check (size_bytes > 0),
  template_count integer not null default 0,
  published_by_kiosk uuid references public.kiosks(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists theme_bundles_workspace_created_idx on public.theme_bundles(workspace_id, created_at desc);

alter table public.theme_bundles enable row level security;
alter table public.theme_bundles force row level security;
revoke all on table public.theme_bundles from public, anon, authenticated;
