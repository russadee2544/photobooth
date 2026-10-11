-- Private bucket for theme bundles (JSON). The photo bucket only accepts images.
-- No storage policies: only the theme-sync Edge Function (service role) reads or writes here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('theme-bundles', 'theme-bundles', false, 20971520, array['application/json'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
