-- Signed kiosk update bundles. Public read (kiosks poll it without credentials); writes only
-- via the service role from scripts/publish-update.mjs. Bundles are Ed25519-signed, so a
-- tampered file is rejected by every kiosk even though the bucket itself is readable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('updates', 'updates', true, 209715200,
  array['application/gzip', 'application/json', 'application/octet-stream']::text[])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
