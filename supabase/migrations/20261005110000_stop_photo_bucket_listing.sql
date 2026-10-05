-- The 'photobooth' bucket is public, so photo URLs keep working without any policy.
-- The SELECT policy only added the ability to LIST every object in the bucket through
-- the Storage API, which exposes all customers' photo file names. Drop it.
-- (The anon INSERT policy stays until uploads move to an Edge Function; see docs/RLS_REVIEW.md.)
drop policy if exists "Allow public reads" on storage.objects;
